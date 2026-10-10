#!/usr/bin/env python3
"""Robot side of the gate check: read the gate's QR with the Pi camera and present.

Runs on the robot box (bishop). Frames are the latest snapshot that
cam_stream.py serves on :8000 (/snapshot.jpg), fetched one at a time, so the
reader never falls behind the camera. Each frame goes through OpenCV's WeChat
QR detector (python3-opencv 4.10 from apt, models in ~/wechat_qr, see camera.md).

The reader never stops: a presentation runs in a worker thread while frames
keep coming, every network error is logged and retried, and a code that did
not get a verdict is presented again (5, 10, 20 s back-off, up to 6 tries)
while it stays in view. A code with a verdict (allowed or denied) is final:
the gate issues a fresh code after each verdict. State goes to
~/pilot-logs/reader_status.json for the dashboard.

The gate display (gate_display.py on janus) encodes the compact form
"<INVITATION_UUID>/<REQUEST_UUID>" of Paradym's authorization request URI.
This script rebuilds the full URI, posts it to the robot-service (/present on
:4004) and then polls the gate-service (/result/<REQUEST_UUID>) for the verdict.

Usage:
  python3 qr_present.py                 # loop until Ctrl-C
  python3 qr_present.py --once          # stop after the first verdict
  python3 qr_present.py --dry-run       # only print what the camera decodes

Environment (all optional):
  SNAPSHOT_URL default http://127.0.0.1:8000/snapshot.jpg
  STATUS_FILE  default ~/pilot-logs/reader_status.json
  ROBOT_URL    default http://127.0.0.1:4004
  GATE_URL     default http://10.10.1.214:4002 (janus on the LAN); empty = skip
  CLIENT_ID    verifier DID for the local link rebuild, used only when the gate's
               /request/{uuid} lookup fails (the gate copy already carries it)
  MODELS_DIR   default ~/wechat_qr
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import cv2
import numpy as np

SNAPSHOT_URL = os.environ.get("SNAPSHOT_URL", "http://127.0.0.1:8000/snapshot.jpg")
STATUS_FILE = os.path.expanduser(os.environ.get("STATUS_FILE", "~/pilot-logs/reader_status.json"))
BACKOFF = (5, 10, 20, 20, 20, 20)  # seconds before try 2, 3, ...; len = max tries
ROBOT_URL = os.environ.get("ROBOT_URL", "http://127.0.0.1:4004")
GATE_URL = os.environ.get("GATE_URL", "http://10.10.1.214:4002")
CLIENT_ID = os.environ.get(
    "CLIENT_ID",
    "decentralized_identifier:did:web:metadata.paradym.id:4e9573de-5cb8-4f81-b178-de95ff8cb13f",
)
MODELS_DIR = os.path.expanduser(os.environ.get("MODELS_DIR", "~/wechat_qr"))

UUID = r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
COMPACT = re.compile(rf"^({UUID})/({UUID})$")


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def expand(payload: str) -> tuple[str, str | None]:
    """Return (authorizationRequestUri, requestId). Full URLs pass through.

    The gate keeps the exact link it created (client_id included), so a compact
    code is resolved there first. The local rebuild with CLIENT_ID is only the
    fallback for when the gate cannot answer; a wrong CLIENT_ID there means a
    client_id mismatch on Paradym and a DENY.
    """
    m = COMPACT.match(payload.strip())
    if not m:
        return payload.strip(), None
    inv, req = m.group(1).lower(), m.group(2).lower()
    if GATE_URL:
        try:
            code, found = get_json(f"{GATE_URL}/request/{req}", timeout=5)
        except Exception as e:
            code, found = 0, {}
            log(f"gate request lookup error: {e}")
        if code == 200 and found.get("authorizationRequestUri"):
            return found["authorizationRequestUri"], req
        log(f"gate request lookup {code}: rebuilding the link locally")
    request_uri = f"https://paradym.id/invitation/{inv}/authorization-requests/{req}?raw=true"
    query = urllib.parse.urlencode({"request_uri": request_uri, "client_id": CLIENT_ID})
    return f"https://paradym.id/invitation?{query}", req


def post_json(url: str, body: dict, timeout: int) -> tuple[int, dict]:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {"error": e.reason}


def get_json(url: str, timeout: int) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code, {}


def poll_verdict(request_id: str, seconds: int) -> dict | None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            code, result = get_json(f"{GATE_URL}/result/{request_id}", timeout=10)
        except Exception as e:  # gate unreachable: keep polling until the window ends
            log(f"gate poll error: {e}")
            code, result = 0, {}
        if code == 200 and result.get("status") != "pending":
            return result
        time.sleep(1)
    return None


def present(payload: str, poll_seconds: int, tries: int) -> dict:
    """One attempt. Returns {"status": allowed|denied|error, "reason": ...}.

    A second try on a session the gate already judged skips the presentation
    and just reads the verdict, so a slow first poll does not re-present.
    """
    uri, request_id = expand(payload)
    if tries > 1 and GATE_URL and request_id:
        early = poll_verdict(request_id, 2)
        if early:
            log(f"gate verdict: {json.dumps(early)[:300]}")
            return early
    log(f"present -> {ROBOT_URL}/present (try {tries})")
    try:
        status, body = post_json(f"{ROBOT_URL}/present", {"requestUri": uri}, timeout=90)
    except Exception as e:
        log(f"robot-service unreachable: {e}")
        return {"status": "error", "reason": f"robot-service unreachable: {e}"}
    log(f"robot-service {status}: {json.dumps(body)[:300]}")
    if status != 200 or not body.get("ok", True):
        return {"status": "error", "reason": f"robot-service {status}: {body.get('error') or body.get('serverBody') or ''}"[:200]}
    if not GATE_URL or not request_id:
        return {"status": "error", "reason": "no gate to poll"}
    verdict = poll_verdict(request_id, poll_seconds)
    if verdict:
        log(f"gate verdict: {json.dumps(verdict)[:300]}")
        return verdict
    log("gate verdict: still pending after the poll window")
    return {"status": "error", "reason": "no verdict in the poll window"}


class Attempts:
    """Per-code state shared between the frame loop and the worker thread."""

    def __init__(self, poll_seconds: int) -> None:
        self.poll_seconds = poll_seconds
        self.lock = threading.Lock()
        self.state: dict[str, dict] = {}   # payload -> {status, tries, next, reason}
        self.busy = False
        self.current = ""

    def write_status(self, scanning: str) -> None:
        with self.lock:
            cur = self.state.get(self.current, {})
            doc = {
                "updated": time.strftime("%H:%M:%S"),
                "scanning": scanning,                 # code in view right now, or ""
                "code": self.current,                 # last code worked on
                "state": "presenting" if self.busy else cur.get("status", "idle"),
                "tries": cur.get("tries", 0),
                "reason": cur.get("reason", ""),
                "retry_in": max(0, int(cur.get("next", 0) - time.time())) if cur.get("status") == "error" else 0,
            }
        try:
            tmp = STATUS_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(doc, f)
            os.replace(tmp, STATUS_FILE)
        except OSError:
            pass

    def seen(self, payload: str) -> None:
        """A code is in view: start a try if it is due. Never blocks the frame loop."""
        with self.lock:
            if self.busy:
                return
            st = self.state.setdefault(payload, {"status": "new", "tries": 0, "next": 0, "reason": ""})
            if st["status"] in ("allowed", "denied", "gave-up"):
                return
            if time.time() < st["next"]:
                return
            st["tries"] += 1
            self.busy = True
            self.current = payload
            tries = st["tries"]
        threading.Thread(target=self._run, args=(payload, tries), daemon=True).start()

    def _run(self, payload: str, tries: int) -> None:
        try:
            outcome = present(payload, self.poll_seconds, tries)
        except Exception as e:  # last line of defence: the reader must not die
            log(f"present failed: {e!r}")
            outcome = {"status": "error", "reason": repr(e)[:200]}
        with self.lock:
            st = self.state[payload]
            st["status"] = outcome.get("status", "error")
            st["reason"] = str(outcome.get("reason") or outcome.get("determiningPolicies") or "")[:200]
            if st["status"] == "error":
                if tries >= len(BACKOFF):
                    st["status"] = "gave-up"
                    log(f"gave up on this code after {tries} tries; waiting for a new one")
                else:
                    st["next"] = time.time() + BACKOFF[tries - 1]
                    log(f"retry in {BACKOFF[tries - 1]} s if the code is still in view")
            self.busy = False


def fetch_frame(timeout: float = 3.0):
    with urllib.request.urlopen(SNAPSHOT_URL, timeout=timeout) as resp:
        data = np.frombuffer(resp.read(), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="exit after the first presentation")
    ap.add_argument("--dry-run", action="store_true", help="decode only, never present")
    ap.add_argument("--poll", type=int, default=30, help="seconds to wait for the gate verdict")
    ap.add_argument("--rate", type=float, default=8.0, help="max frames per second to decode")
    args = ap.parse_args()

    files = [os.path.join(MODELS_DIR, f) for f in
             ("detect.prototxt", "detect.caffemodel", "sr.prototxt", "sr.caffemodel")]
    missing = [f for f in files if not os.path.isfile(f)]
    if missing:
        log(f"missing WeChat models: {missing}")
        return 2
    detector = cv2.wechat_qrcode_WeChatQRCode(*files)
    log(f"reading {SNAPSHOT_URL}; robot {ROBOT_URL}; gate {GATE_URL or '(skipped)'}")

    attempts = Attempts(args.poll)
    last_seen = ""
    last_status_write = 0.0
    camera_down_since = 0.0
    period = 1.0 / max(args.rate, 0.5)
    while True:
        t0 = time.time()
        try:
            frame = fetch_frame()
            if frame is None:
                raise RuntimeError("snapshot did not decode")
            camera_down_since = 0.0
        except Exception as e:
            if not camera_down_since:
                camera_down_since = t0
                log(f"camera snapshot unavailable ({e}); retrying every 2 s")
            time.sleep(2)
            continue
        try:
            texts, _points = detector.detectAndDecode(frame)
        except Exception as e:
            log(f"detector error: {e!r}")
            texts = []
        in_view = ""
        for text in texts:
            if not text:
                continue
            in_view = text
            if text != last_seen:
                log(f"decoded ({len(text)} chars): {text}")
                last_seen = text
            if args.dry_run:
                continue
            attempts.seen(text)
            if args.once and attempts.state.get(text, {}).get("status") in ("allowed", "denied"):
                return 0
            break
        if t0 - last_status_write >= 1.0:
            attempts.write_status(in_view)
            last_status_write = t0
        time.sleep(max(0.0, period - (time.time() - t0)))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)

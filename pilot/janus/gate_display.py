#!/usr/bin/env python3
"""Gate display: largest readable QR on the Waveshare 4.2" e-paper (V2, 400x300).

The robot camera reads this code. The payload is the compact form of the
Paradym authorization request (two UUIDs, upper case, alphanumeric QR mode),
which keeps the symbol at version 4 and gives 8 px per module on the 300 px
side. If the request URI does not have the expected Paradym shape, the full
URL goes in instead (version 11, 4 px per module).

In loop mode the panel cycles: code on screen, verdict on screen for a few
seconds once the gate has one, then a fresh code. A code that nobody reads is
replaced before the Paradym request expires (measured at about 15 minutes).

Usage:
  gate_display.py [GATE_ID] [--url URL] [--dry PNG] [--gate-service http://127.0.0.1:4002]
  gate_display.py [GATE_ID] --loop [--refresh-after 600] [--hold 8]

  GATE_ID          label in the side strip, default G-1
  --url            use this authorization request URL instead of asking the gate service
  --dry PNG        render to PNG only, do not drive the panel
  --loop           run forever (see above)
  --refresh-after  seconds a code stays up without a verdict before a new one, default 600
  --hold           seconds the verdict stays on the panel, default 8
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

W, H = 400, 300
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
QUIET = 8  # px of white around the code on top of the panel bezel
POLL_SECONDS = 2

UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
PARADYM_REQUEST = re.compile(
    rf"^https://paradym\.id/invitation/({UUID})/authorization-requests/({UUID})\?raw=true$"
)


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def compact_payload(url: str) -> tuple[str, str]:
    """Return (payload, mode). mode is 'compact' or 'full'."""
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    request_uri = (query.get("request_uri") or [""])[0]
    m = PARADYM_REQUEST.match(request_uri)
    if m:
        return f"{m.group(1).upper()}/{m.group(2).upper()}", "compact"
    return url, "full"


def new_session(gate_service: str, gate_id: str) -> tuple[str, str]:
    """Ask the gate service for a session. Returns (session_id, authorization_request_uri)."""
    body = json.dumps({"gate": gate_id}).encode()
    req = urllib.request.Request(
        f"{gate_service}/verify", data=body, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    return data["sessionId"], data["authorizationRequestUri"]


def read_result(gate_service: str, session_id: str) -> dict:
    """Observer read: does not arm the gate's no-presentation timeout."""
    with urllib.request.urlopen(
        f"{gate_service}/result/{session_id}?observer=1", timeout=10
    ) as resp:
        return json.load(resp)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


def fit_font(d: ImageDraw.ImageDraw, text: str, max_w: int, start: int, floor: int) -> ImageFont.FreeTypeFont:
    size = start
    f = font(size)
    while d.textbbox((0, 0), text, font=f)[2] > max_w and size > floor:
        size -= 4
        f = font(size)
    return f


def centered(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, cy: int, box_w: int, fill: int = 0) -> None:
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
    d.text(((box_w - (x1 - x0)) // 2 - x0, cy - (y1 - y0) // 2 - y0), text, font=f, fill=fill)


def render(payload: str, label: str) -> tuple[Image.Image, int, int]:
    img = Image.new("1", (W, H), 255)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=1, border=0)
    qr.add_data(payload)
    qr.make(fit=True)
    modules = qr.modules_count
    box = (H - 2 * QUIET) // modules
    side = box * modules
    qr_img = (
        qr.make_image(fill_color="black", back_color="white")
        .convert("1")
        .resize((side, side), Image.NEAREST)
    )
    img.paste(qr_img, ((H - side) // 2, (H - side) // 2))

    strip_w = W - H
    strip = Image.new("1", (H, strip_w), 255)
    d = ImageDraw.Draw(strip)
    centered(d, label, fit_font(d, label, H - 16, 64, 20), strip_w // 2, H)
    img.paste(strip.rotate(90, expand=True), (H, 0))
    return img, modules, box


def render_verdict(result: dict, label: str) -> Image.Image:
    """Full-panel verdict: ALLOWED black on white, DENIED white on black."""
    allowed = str(result.get("status", "")).lower() == "allowed"
    word = "ALLOWED" if allowed else "DENIED"
    bg, fg = (255, 0) if allowed else (0, 255)
    img = Image.new("1", (W, H), bg)
    d = ImageDraw.Draw(img)
    d.rectangle((6, 6, W - 7, H - 7), outline=fg, width=4)
    centered(d, word, fit_font(d, word, W - 40, 96, 40), 95, W, fg)
    detail = "" if allowed else str(result.get("reason", "")).replace("-", " ")
    if detail:
        centered(d, detail, fit_font(d, detail, W - 40, 30, 16), 190, W, fg)
    centered(d, label, font(28), 255, W, fg)
    return img


def render_notice(line1: str, line2: str, label: str) -> Image.Image:
    img = Image.new("1", (W, H), 255)
    d = ImageDraw.Draw(img)
    d.rectangle((6, 6, W - 7, H - 7), outline=0, width=4)
    centered(d, line1, fit_font(d, line1, W - 40, 56, 24), 100, W)
    centered(d, line2, fit_font(d, line2, W - 40, 28, 16), 170, W)
    centered(d, label, font(28), 255, W)
    return img


class Panel:
    """Waveshare 4.2" V2. init/display/sleep per refresh: the vendor asks for sleep
    between refreshes, and a full refresh takes about four seconds."""

    def __init__(self) -> None:
        sys.path.insert(0, str(Path.home() / "e-Paper/RaspberryPi_JetsonNano/python/lib"))
        from waveshare_epd import epd4in2_V2

        self.epd = epd4in2_V2.EPD()

    def show(self, img: Image.Image) -> None:
        self.epd.init()
        self.epd.display(self.epd.getbuffer(img))
        self.epd.sleep()


def show_once(args: argparse.Namespace) -> int:
    label = f"GATE {args.gate_id}"
    url = args.url or new_session(args.gate_service, args.gate_id)[1]
    payload, mode = compact_payload(url)
    img, modules, box = render(payload, label)
    print(f"payload ({mode}, {len(payload)} chars): {payload}")
    print(f"QR {modules} modules x {box}px = {modules * box}px square")

    if args.dry:
        img.save(args.dry)
        if args.dry.endswith(".png"):
            stem = args.dry[:-4]
            render_verdict({"status": "allowed"}, label).save(stem + "-allowed.png")
            render_verdict({"status": "denied", "reason": "no-presentation"}, label).save(stem + "-denied.png")
            render_notice("GATE OFFLINE", "waiting for the gate service", label).save(stem + "-offline.png")
        print(f"rendered to {args.dry}")
        return 0

    Panel().show(img)
    print(f"shown on panel: {label}")
    return 0


def run_loop(args: argparse.Namespace) -> int:
    label = f"GATE {args.gate_id}"
    panel = Panel()
    offline_shown = False
    log(f"loop: gate {args.gate_service}, refresh after {args.refresh_after}s, hold {args.hold}s")
    while True:
        try:
            session_id, url = new_session(args.gate_service, args.gate_id)
        except Exception as e:  # gate down or Paradym unreachable: say so on the panel, retry
            log(f"new session failed: {e}")
            if not offline_shown:
                panel.show(render_notice("GATE OFFLINE", "waiting for the gate service", label))
                offline_shown = True
            time.sleep(10)
            continue
        offline_shown = False
        payload, mode = compact_payload(url)
        img, modules, box = render(payload, label)
        panel.show(img)
        shown_at = time.time()
        log(f"session {session_id}: code up ({mode}, {modules} modules x {box}px)")

        result = None
        while time.time() - shown_at < args.refresh_after:
            time.sleep(POLL_SECONDS)
            try:
                r = read_result(args.gate_service, session_id)
            except urllib.error.HTTPError as e:
                if e.code == 404:  # gate restarted and forgot the session
                    log(f"session {session_id}: unknown to the gate, new code")
                    break
                log(f"poll error: {e}")
                continue
            except Exception as e:
                log(f"poll error: {e}")
                continue
            if r.get("status") != "pending":
                result = r
                break

        if result is None:
            log(f"session {session_id}: no verdict, refreshing the code")
            continue
        log(f"session {session_id}: {result.get('status')} {result.get('reason', '')}".rstrip())
        panel.show(render_verdict(result, label))
        time.sleep(args.hold)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gate_id", nargs="?", default="G-1")
    ap.add_argument("--url")
    ap.add_argument("--dry", metavar="PNG")
    ap.add_argument("--gate-service", default="http://127.0.0.1:4002")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--refresh-after", type=int, default=600)
    ap.add_argument("--hold", type=int, default=8)
    args = ap.parse_args()
    return run_loop(args) if args.loop else show_once(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)

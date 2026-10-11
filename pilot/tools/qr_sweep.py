#!/usr/bin/env python3
"""QR sweep: which QR version and physical size the bishop camera decodes at a given distance.

Three modes, one file, so the same variant list is used on both boxes.

  show   (janus)  Render each variant on the 4.2" e-paper, hold it, record when it went up.
                  Writes a JSON schedule. Stop the gate display loop first.
  read   (bishop) Fetch snapshot frames for N seconds, decode each with the WeChat detector
                  used by qr_present.py, record every attempt. Stop qr_present.py first.
  table  (laptop) Join the two JSON files and print a markdown table per variant.
  probe  (bishop) One snapshot, one decode: is the code the gate shows now inside the frame?

The payload has the exact shape of the gate's compact code (two upper-case UUIDs joined
by "/", 73 chars) so the qrcode segmentation matches the real code. The first eight
characters carry the variant: VVBB0000, where VV is the QR version and BB the module size
in pixels. Error correction M, as in gate_display.py.

Physical size: the Waveshare 4.2" panel shows 400 x 300 px on 84.8 x 63.6 mm, so one
pixel is 0.212 mm (vendor wiki, "Display size").
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
import urllib.request
from pathlib import Path

MM_PER_PX = 84.8 / 400
W, H = 400, 300
FILLER = "8E7C-4F2A-9B31-D5C6E0A17F42/3A1B5C7D-2E4F-4A6B-8C9D-0E1F2A3B4C5D"
TAG = re.compile(r"^(\d{2})(\d{2})0000-")

# (version, box px). Side px = (17 + 4 * version) * box. Quiet zone is whatever is left,
# at least one module, at most four. The gate today renders V4 at 8 px (264 px, 56 mm).
VARIANTS = [
    (4, 4), (4, 6), (4, 8),
    (5, 4), (5, 5), (5, 6), (5, 7),
    (6, 4), (6, 5), (6, 6),
    (8, 3), (8, 4), (8, 5),
    (10, 3), (10, 4), (10, 5),
]


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def modules(version: int) -> int:
    return 17 + 4 * version


def side_px(version: int, box: int) -> int:
    return modules(version) * box


def payload_for(version: int, box: int) -> str:
    return f"{version:02d}{box:02d}0000-{FILLER}"


def parse_tag(text: str) -> tuple[int, int] | None:
    m = TAG.match(text or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def render(version: int, box: int):
    import qrcode
    from PIL import Image, ImageDraw

    side = side_px(version, box)
    if side > H - 2 * box:
        raise ValueError(f"V{version} at {box}px is {side}px, no quiet zone fits in {H}px")
    qr = qrcode.QRCode(version=version, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=box, border=0)
    qr.add_data(payload_for(version, box))
    qr.make(fit=False)
    code = qr.make_image(fill_color="black", back_color="white").convert("1")
    assert code.size == (side, side), (code.size, side)
    img = Image.new("1", (W, H), 255)
    x = (H - side) // 2  # square area on the left, the strip on the right carries the label
    y = (H - side) // 2
    img.paste(code, (x, y))
    d = ImageDraw.Draw(img)
    label = [f"V{version}", f"{modules(version)} mod", f"{box} px", f"{side * MM_PER_PX:.0f} mm"]
    for i, line in enumerate(label):
        d.text((H + 12, 20 + i * 22), line, fill=0)
    return img


def cmd_show(args: argparse.Namespace) -> int:
    if args.dry:
        out = Path(args.dry)
        out.mkdir(parents=True, exist_ok=True)
        for v, b in VARIANTS:
            render(v, b).save(out / f"v{v:02d}_b{b:02d}.png")
        log(f"{len(VARIANTS)} PNGs in {out}")
        return 0

    sys.path.insert(0, str(Path.home() / "e-Paper/RaspberryPi_JetsonNano/python/lib"))
    from waveshare_epd import epd4in2_V2

    epd = epd4in2_V2.EPD()
    schedule = {"started": time.time(), "hold": args.hold, "variants": []}
    for v, b in VARIANTS:
        img = render(v, b)
        t0 = time.time()
        epd.init()
        epd.display(epd.getbuffer(img))
        epd.sleep()
        shown = time.time()
        log(f"V{v} {b}px ({side_px(v, b)} px, {side_px(v, b) * MM_PER_PX:.0f} mm) up, refresh {shown - t0:.1f}s")
        time.sleep(args.hold)
        schedule["variants"].append({"version": v, "box": b, "side_px": side_px(v, b),
                                     "side_mm": round(side_px(v, b) * MM_PER_PX, 1),
                                     "shown": shown, "until": time.time()})
    epd.init()
    epd.Clear()
    epd.sleep()
    schedule["finished"] = time.time()
    Path(args.out).write_text(json.dumps(schedule, indent=1))
    log(f"schedule in {args.out}")
    return 0


def wechat_detector(models_dir: str):
    """The detector qr_present.py uses, or None (with a log line) when a model file is missing."""
    import cv2

    models = Path(models_dir).expanduser()
    files = [str(models / f) for f in ("detect.prototxt", "detect.caffemodel", "sr.prototxt", "sr.caffemodel")]
    missing = [f for f in files if not os.path.isfile(f)]
    if missing:
        log(f"missing WeChat models: {missing}")
        return None
    return cv2.wechat_qrcode_WeChatQRCode(*files)


def cmd_read(args: argparse.Namespace) -> int:
    import cv2
    import numpy as np

    detector = wechat_detector(args.models)
    if detector is None:
        return 2
    attempts = []
    end = time.time() + args.seconds
    shape = None
    log(f"reading {args.snapshot} for {args.seconds}s")
    while time.time() < end:
        t = time.time()
        try:
            with urllib.request.urlopen(args.snapshot, timeout=3) as resp:
                frame = cv2.imdecode(np.frombuffer(resp.read(), np.uint8), cv2.IMREAD_COLOR)
        except Exception as e:  # noqa: BLE001
            attempts.append({"t": t, "error": str(e)[:80]})
            time.sleep(0.5)
            continue
        if frame is None:
            attempts.append({"t": t, "error": "decode"})
            continue
        shape = shape or list(frame.shape[:2])
        d0 = time.time()
        texts, _ = detector.detectAndDecode(frame)
        ms = (time.time() - d0) * 1000
        text = next((x for x in texts if x), "")
        attempts.append({"t": t, "ms": round(ms), "text": text})
        wait = (1.0 / args.rate) - (time.time() - t)
        if wait > 0:
            time.sleep(wait)
    Path(args.out).write_text(json.dumps({"frame": shape, "attempts": attempts}, indent=0))
    decoded = sum(1 for a in attempts if a.get("text"))
    log(f"{len(attempts)} frames, {decoded} decoded, frame {shape}, in {args.out}")
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    """One frame, one decode. Exit 0 with the code's place in the frame, 3 when nothing decodes."""
    import cv2
    import numpy as np

    detector = wechat_detector(args.models)
    if detector is None:
        return 2
    try:
        with urllib.request.urlopen(args.snapshot, timeout=5) as resp:
            data = resp.read()
    except Exception as e:  # noqa: BLE001
        log(f"snapshot {args.snapshot}: {e}")
        return 2
    if args.save:
        Path(args.save).write_bytes(data)
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        log("snapshot is not an image")
        return 2
    h, w = frame.shape[:2]
    t0 = time.time()
    texts, points = detector.detectAndDecode(frame)
    ms = (time.time() - t0) * 1000
    hit = next((i for i, x in enumerate(texts) if x), None)
    if hit is None:
        log(f"nothing decoded in a {w}x{h} frame ({ms:.0f} ms)" + (f", frame saved to {args.save}" if args.save else ""))
        return 3
    xs = [float(p[0]) for p in points[hit]]
    ys = [float(p[1]) for p in points[hit]]
    log(f"decoded in {ms:.0f} ms: {texts[hit][:24]}... "
        f"code spans x {min(xs) / w:.0%}-{max(xs) / w:.0%}, y {min(ys) / h:.0%}-{max(ys) / h:.0%} "
        f"of {w}x{h}, side {max(max(xs) - min(xs), max(ys) - min(ys)):.0f} px")
    return 0


def cmd_table(args: argparse.Namespace) -> int:
    schedule = json.loads(Path(args.schedule).read_text())
    reads = json.loads(Path(args.reads).read_text())
    attempts = [a for a in reads["attempts"] if "ms" in a]
    skew = args.skew
    rows = []
    for var in schedule["variants"]:
        lo, hi = var["shown"] + skew, var["until"] + skew
        window = [a for a in attempts if lo <= a["t"] < hi]
        hits = [a for a in window if parse_tag(a["text"]) == (var["version"], var["box"])]
        other = [a for a in window if a["text"] and a not in hits]
        first = min((a["t"] for a in hits), default=None)
        rows.append({
            "version": var["version"], "modules": modules(var["version"]), "box": var["box"],
            "side_mm": var["side_mm"], "module_mm": round(var["box"] * MM_PER_PX, 2),
            "frames": len(window), "decoded": len(hits),
            "rate": (len(hits) / len(window)) if window else 0.0,
            "first_s": (first - var["shown"] - skew) if first is not None else None,
            "ms": statistics.median(a["ms"] for a in hits) if hits else None,
            "other": len(other),
        })
    print(f"distance {args.distance}, camera frame {reads.get('frame')}, hold {schedule['hold']}s, "
          f"{len(attempts)} frames read\n")
    print("| version | modules | module px | module mm | side mm | frames | decoded | rate | first decode s | decode ms |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        first = f"{r['first_s']:.1f}" if r["first_s"] is not None else "-"
        ms = f"{r['ms']:.0f}" if r["ms"] is not None else "-"
        print(f"| V{r['version']} | {r['modules']} | {r['box']} | {r['module_mm']} | {r['side_mm']} | "
              f"{r['frames']} | {r['decoded']} | {r['rate']:.0%} | {first} | {ms} |")
    stray = sum(r["other"] for r in rows)
    if stray:
        print(f"\n{stray} frames decoded the previous variant inside a window (e-paper ghosting or clock skew).")
    if args.json:
        Path(args.json).write_text(json.dumps({"distance": args.distance, "frame": reads.get("frame"),
                                               "rows": rows}, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("show", help="janus: cycle the variants on the e-paper")
    s.add_argument("--hold", type=int, default=12, help="seconds each variant stays up after the refresh")
    s.add_argument("--out", default="sweep-schedule.json")
    s.add_argument("--dry", metavar="DIR", help="write PNGs instead of driving the panel")
    s.set_defaults(fn=cmd_show)
    r = sub.add_parser("read", help="bishop: decode snapshot frames for a while")
    r.add_argument("--seconds", type=int, default=360)
    r.add_argument("--rate", type=float, default=6.0, help="max frames per second")
    r.add_argument("--snapshot", default=os.environ.get("SNAPSHOT_URL", "http://127.0.0.1:8000/snapshot.jpg"))
    r.add_argument("--models", default=os.environ.get("MODELS_DIR", "~/wechat_qr"))
    r.add_argument("--out", default="sweep-reads.json")
    r.set_defaults(fn=cmd_read)
    p = sub.add_parser("probe", help="bishop: one snapshot, one decode, is the panel in frame")
    p.add_argument("--snapshot", default=os.environ.get("SNAPSHOT_URL", "http://127.0.0.1:8000/snapshot.jpg"))
    p.add_argument("--models", default=os.environ.get("MODELS_DIR", "~/wechat_qr"))
    p.add_argument("--save", metavar="JPEG", help="keep the frame here, decoded or not")
    p.set_defaults(fn=cmd_probe)

    t = sub.add_parser("table", help="laptop: join schedule and reads")
    t.add_argument("schedule")
    t.add_argument("reads")
    t.add_argument("--distance", default="as placed", help="label for the table, e.g. 200cm")
    t.add_argument("--skew", type=float, default=0.0, help="seconds to add to janus times to match bishop's clock")
    t.add_argument("--json", help="also write the rows as JSON")
    t.set_defaults(fn=cmd_table)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

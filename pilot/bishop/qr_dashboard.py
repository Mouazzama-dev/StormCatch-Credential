#!/usr/bin/env python3
"""Quick test dashboard for the robot camera check: live camera + reader results.

Runs on the robot box next to cam_stream.py (:8000) and qr_present.py.
Serves one page on :8090 with the camera stream (proxied from :8000, so one
ssh port forward is enough) and the last lines of ~/pilot-logs/qr_present.log,
parsed into three cards: last QR decoded, robot-service answer, gate verdict.

From the laptop:
  ssh -N -L 8090:127.0.0.1:8090 bishop
  open http://127.0.0.1:8090/

Environment (optional):
  STREAM_URL  default http://127.0.0.1:8000/stream.mjpg
  LOG_FILE    default ~/pilot-logs/qr_present.log
  STATUS_FILE default ~/pilot-logs/reader_status.json (written by qr_present.py)
  PORT        default 8090
"""
import json
import os
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STREAM_URL = os.environ.get("STREAM_URL", "http://127.0.0.1:8000/stream.mjpg")
SNAPSHOT_URL = os.environ.get("SNAPSHOT_URL", "http://127.0.0.1:8000/snapshot.jpg")
LOG_FILE = os.path.expanduser(os.environ.get("LOG_FILE", "~/pilot-logs/qr_present.log"))
STATUS_FILE = os.path.expanduser(os.environ.get("STATUS_FILE", "~/pilot-logs/reader_status.json"))
PORT = int(os.environ.get("PORT", "8090"))

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Pilot v0: robot camera test</title>
<style>
body{margin:0;font:14px/1.4 -apple-system,Helvetica,Arial,sans-serif;background:#111;color:#eee}
header{padding:10px 16px;background:#222;display:flex;gap:16px;align-items:center}
header b{font-size:16px}
#reader{padding:2px 8px;border-radius:4px;background:#444}
#reader.on{background:#1f6f3f}#reader.off{background:#8a2b2b}
main{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px;padding:12px}
main>div{min-width:0}
img{width:100%;background:#000;border:1px solid #333}
.card{background:#1c1c1c;border:1px solid #333;border-radius:6px;padding:10px;margin-bottom:10px}
.card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#999}
.card .v{font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all}
.allowed{border-color:#2e9e5b}.allowed h3{color:#2e9e5b}
.denied{border-color:#d9534f}.denied h3{color:#d9534f}
.pending{border-color:#c9a227}.pending h3{color:#c9a227}
.presenting{border-color:#3b82f6}.presenting h3{color:#3b82f6}
.error{border-color:#d9534f}.error h3{color:#d9534f}
#state .v{font-size:18px;font-family:inherit}
pre{background:#000;border:1px solid #333;padding:8px;height:38vh;overflow:auto;font-size:12px;margin:0;white-space:pre-wrap;word-break:break-all}
</style></head><body>
<header><b>Pilot v0: robot camera test</b><span>bishop camera, reader, gate verdict</span>
<span id="reader">reader: ?</span><span id="ts"></span></header>
<main>
<div><img id="cam" src="/frame.jpg" alt="camera"></div>
<div>
<div class="card" id="state"><h3>Reader state</h3><div class="v" id="st">(no status yet)</div></div>
<div class="card" id="c-qr"><h3>Last QR decoded</h3><div class="v" id="qr">(none yet)</div></div>
<div class="card" id="c-robot"><h3>robot-service /present</h3><div class="v" id="robot">(waiting)</div></div>
<div class="card" id="c-gate"><h3>Gate verdict</h3><div class="v" id="gate">(waiting)</div></div>
<div class="card" id="c-timing"><h3>Timing (last verdict)</h3><div class="v" id="timing">(no verdict yet)</div></div>
<pre id="log"></pre>
</div></main>
<script>
async function tick(){
  try{
    const r=await fetch('/log',{cache:'no-store'}); const d=await r.json();
    document.getElementById('log').textContent=d.lines.join('\\n');
    document.getElementById('qr').textContent=d.decoded||'(none yet)';
    document.getElementById('robot').textContent=d.robot||'(waiting)';
    document.getElementById('gate').textContent=d.verdict||'(waiting)';
    document.getElementById('timing').textContent=d.timing||'(no verdict yet)';
    const g=document.getElementById('c-gate'); g.className='card '+(d.verdict_class||'');
    const s=d.status||{}; let txt='(no status yet)', cls='';
    if(s.state==='presenting'){ txt='presenting, try '+s.tries+' (waiting for the verdict)'; cls='presenting'; }
    else if(s.state==='allowed'){ txt='allowed'; cls='allowed'; }
    else if(s.state==='denied'){ txt='denied'+(s.reason?': '+s.reason:''); cls='denied'; }
    else if(s.state==='error'){ txt='try '+s.tries+' failed, retry in '+s.retry_in+' s if the code stays in view'+(s.reason?' ('+s.reason+')':''); cls='error'; }
    else if(s.state==='gave-up'){ txt='gave up after '+s.tries+' tries, waiting for a new code'; cls='error'; }
    else if(s.updated){ txt=s.scanning?'code in view':'scanning, no code in view'; cls='pending'; }
    document.getElementById('st').textContent=txt;
    document.getElementById('state').className='card '+cls;
    const rd=document.getElementById('reader');
    rd.textContent='reader: '+(d.reader_alive?'on':'off'); rd.className=d.reader_alive?'on':'off';
    document.getElementById('ts').textContent=new Date().toLocaleTimeString();
    const pre=document.getElementById('log'); pre.scrollTop=pre.scrollHeight;
  }catch(e){ document.getElementById('ts').textContent='fetch error'; }
}
tick(); setInterval(tick,1000);
const cam=document.getElementById('cam');
function nextFrame(){ cam.src='/frame.jpg?t='+Date.now(); }
cam.onload=()=>setTimeout(nextFrame,60); cam.onerror=()=>setTimeout(nextFrame,1000);
</script></body></html>"""


def read_log(max_lines: int = 60) -> dict:
    lines: list[str] = []
    if os.path.isfile(LOG_FILE):
        with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()[-max_lines:]
    decoded = robot = verdict = timing = ""
    for line in lines:
        if "decoded (" in line:
            decoded = line
            robot = verdict = ""
        elif "robot-service " in line:
            robot = line
        elif "gate verdict" in line:
            verdict = line
        elif "timing:" in line:
            timing = line
    vclass = ""
    if '"allowed"' in verdict:
        vclass = "allowed"
    elif '"denied"' in verdict:
        vclass = "denied"
    elif verdict or robot:
        vclass = "pending"
    alive = subprocess.run(["pgrep", "-f", "[q]r_present.py"], capture_output=True).returncode == 0
    status: dict = {}
    try:
        with open(STATUS_FILE, encoding="utf-8") as f:
            status = json.load(f)
    except (OSError, ValueError):
        pass
    return {
        "status": status,
        "lines": lines,
        "decoded": decoded,
        "robot": robot,
        "verdict": verdict,
        "timing": timing,
        "verdict_class": vclass,
        "reader_alive": alive,
    }


def grab_frame(timeout: float = 5.0) -> bytes:
    """Return the latest JPEG from cam_stream.py's snapshot endpoint."""
    with urllib.request.urlopen(SNAPSHOT_URL, timeout=timeout) as resp:
        return resp.read()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # keep the console quiet
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/log":
            body = json.dumps(read_log()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/frame.jpg"):
            try:
                body = grab_frame()
            except Exception as e:
                self.send_error(502, f"camera frame unavailable: {e}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/stream.mjpg":
            try:
                up = urllib.request.urlopen(STREAM_URL, timeout=10)
            except Exception as e:
                self.send_error(502, f"camera stream unavailable: {e}")
                return
            self.send_response(200)
            self.send_header("Content-Type", up.headers.get("Content-Type", "multipart/x-mixed-replace"))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    chunk = up.read1(16384)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                up.close()
        else:
            self.send_error(404)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"dashboard on http://127.0.0.1:{PORT}/ (stream {STREAM_URL}, log {LOG_FILE})", flush=True)
    srv.serve_forever()

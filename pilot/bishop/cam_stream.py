#!/usr/bin/env python3
"""MJPEG stream of the Pi camera in the browser: http://<box>:8000/

  /stream.mjpg   every frame, as a multipart stream (browser, proxies)
  /snapshot.jpg  the latest frame only, returned at once (reader, dashboard):
                 no buffering, so a slow consumer never falls behind the camera
"""
import io, logging, socketserver
from http import server
from threading import Condition
from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

PAGE = """<html><head><title>bishop camera</title></head>
<body style="margin:0;background:#111;display:grid;place-items:center;height:100vh">
<img src="stream.mjpg" style="max-width:100vw;max-height:100vh" /></body></html>"""

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()
    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()

class Handler(server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = PAGE.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", len(body)); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/snapshot.jpg"):
            with output.condition:
                frame = output.frame
            if not frame:
                self.send_error(503, "no frame yet"); self.end_headers(); return
            self.send_response(200)
            self.send_header("Cache-Control", "no-store"); self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", len(frame)); self.end_headers(); self.wfile.write(frame)
        elif self.path == "/stream.mjpg":
            self.send_response(200)
            self.send_header("Age", 0); self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
            self.end_headers()
            try:
                while True:
                    with output.condition:
                        output.condition.wait()
                        frame = output.frame
                    self.wfile.write(b"--FRAME\r\n")
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", len(frame)); self.end_headers()
                    self.wfile.write(frame); self.wfile.write(b"\r\n")
            except Exception as e:
                logging.debug("client %s left: %s", self.client_address, e)
        else:
            self.send_error(404); self.end_headers()

    def log_request(self, code="-", size="-"):
        # The reader and the dashboard poll /snapshot.jpg several times a second; one line
        # per request filled 6 MB in a morning. Errors still go through log_error.
        pass

class StreamingServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (1280, 720)}, buffer_count=2, controls={"FrameRate": 30}))
output = StreamingOutput()
picam2.start_recording(MJPEGEncoder(), FileOutput(output))
try:
    StreamingServer(("0.0.0.0", 8000), Handler).serve_forever()
finally:
    picam2.stop_recording()

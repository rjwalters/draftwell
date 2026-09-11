"""Run with ANVIL_TOKEN set; binds to loopback unless explicitly configured."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import ValidationError
from adapter import CheckRequest, check


def make_handler(token: str):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, body: dict):
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                return self.reply(401, {"error": "Unauthorized"})
            if self.path != "/check":
                return self.reply(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 1_000_000:
                    return self.reply(413, {"error": "Invalid request size"})
                self.connection.settimeout(10)
                request = CheckRequest.model_validate_json(self.rfile.read(length))
            except (ValueError, ValidationError, TimeoutError):
                return self.reply(400, {"error": "Invalid revision snapshot"})
            try:
                return self.reply(200, check(request))
            except Exception:
                # Never include private text, request headers, or validation inputs in logs.
                return self.reply(500, {"error": "Writing checks failed"})

        def log_message(self, *_args):
            pass
    return Handler


if __name__ == "__main__":
    token = os.environ.get("ANVIL_TOKEN")
    if not token:
        raise SystemExit("Set ANVIL_TOKEN before starting the runner")
    server = ThreadingHTTPServer((os.environ.get("ANVIL_HOST", "127.0.0.1"), int(os.environ.get("ANVIL_PORT", "8790"))), make_handler(token))
    print(f"Anvil writing checks listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    server.serve_forever()

"""Auth HTTP del NVR falso con Basic (fake-nvr-basic.yml), solo para el E2E.

    python -I fake_nvr_auth.py <puerto>

MediaMTX le hace POST con {"ip","user","password","action",...} y acepta si
responde 2xx. Autoriza:
- read del visor con una clave con @/#%$ (FALSA). Sin ':': el parser Basic
  del lado servidor de MediaMTX v1.15.2 descarta las credenciales cuya clave
  tiene ':' (llegan aquí como usuario y clave vacíos, verificado);
- publish anónimo desde loopback (ffmpeg testsrc);
- api del admin falso desde loopback (el E2E cuenta lectores).
No loguea nada: el cuerpo trae claves (aunque sean de prueba).
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VIEWER = ("nvr-viewer", "E2e@/#%$G1-fake")
ADMIN = ("nvr-admin", "fake-nvr-admin-e2e")
LOOPBACK = {"127.0.0.1", "::1"}
MAX_BODY = 64 * 1024


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - nombre de http.server
        length = min(int(self.headers.get("Content-Length") or 0), MAX_BODY)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        action, user, password, ip = (str(body.get(key) or "") for key in ("action", "user", "password", "ip"))
        allowed = (
            (action == "read" and (user, password) == VIEWER)
            or (action == "publish" and ip in LOOPBACK and not user)
            or (action == "api" and ip in LOOPBACK and (user, password) == ADMIN)
        )
        self.send_response(200 if allowed else 401)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


def main() -> None:
    port = int(sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

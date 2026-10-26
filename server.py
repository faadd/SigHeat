"""Serve only SigHeat's public UI, never project source or .env files."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parent


class PublicHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        raw = unquote(urlsplit(self.path).path)
        if raw == "/":
            self.path = "/dashboard.html"
            raw = self.path
        try:
            candidate = (ROOT / raw.lstrip("/")).resolve()
        except (ValueError, OSError):
            self.send_error(404)
            return None
        parts = Path(raw).parts
        public = raw in ("/index.html", "/dashboard.html") or (
            raw.startswith("/assets/")
            and candidate.is_relative_to(ROOT / "assets")
            and candidate.suffix.lower() in {".js", ".css", ".png", ".jpg", ".webp", ".svg", ".woff2", ".ico"}
        )
        if (not public or not candidate.is_relative_to(ROOT)
                or any(p.startswith(".") for p in parts if p != "/")
                or not candidate.is_file()):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' wss:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 untuk akses HP pada LAN; 127.0.0.1 untuk lokal saja")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port harus 1–65535")
    with ThreadingHTTPServer((args.host, args.port), PublicHandler) as server:
        print(f"SigHeat: http://localhost:{args.port}/dashboard.html", flush=True)
        print(f"Dashboard di LAN: http://<IP-LAN-laptop>:{args.port}/", flush=True)
        print("Untuk HP pengukur, buka halaman index.html melalui HTTPS (misalnya GitHub Pages).", flush=True)
        print("HTTP pada IP laptop tidak dapat memberi akses sensor/lokasi di browser HP.", flush=True)
        print("Ctrl+C untuk berhenti. Hanya halaman dan aset publik yang disajikan.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

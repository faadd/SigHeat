"""Verify the optional LAN preview server exposes only public app assets."""
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server


class QuietHandler(server.PublicHandler):
    def log_message(self, *_args):
        pass


class PublicServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.base_path = Path(cls.temporary.name)
        cls.public_root = cls.base_path / 'project'
        cls.public_root.mkdir()
        (cls.public_root / 'assets').mkdir()
        (cls.public_root / 'assets' / '.private').mkdir()
        for name, text in {
            'index.html': '<!doctype html><title>Edge</title>',
            'dashboard.html': '<!doctype html><title>Dashboard</title>',
            '.env': 'MQTT_PASSWORD=not-public',
            'private.js': 'private root source',
            '.nojekyll': '',
            'server.py': 'print("private source")',
            'assets/app.js': 'console.log("public");',
            'assets/style.css': 'body { color: black; }',
            'assets/.private/token.js': 'private token',
        }.items():
            (cls.public_root / name).write_text(text, encoding='utf-8')
        (cls.base_path / 'outside.js').write_text('outside project', encoding='utf-8')
        (cls.public_root / 'assets' / 'outside.js').symlink_to(cls.base_path / 'outside.js')
        (cls.public_root / 'assets' / 'source.js').symlink_to(cls.public_root / 'server.py')
        (cls.public_root / 'assets' / 'inside.js').symlink_to(cls.public_root / 'private.js')
        cls.old_root = server.ROOT
        server.ROOT = cls.public_root
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        server.ROOT = cls.old_root
        cls.temporary.cleanup()

    def test_public_pages_and_assets_are_accessible(self):
        for path in ['/', '/index.html', '/dashboard.html', '/assets/app.js', '/assets/style.css']:
            with self.subTest(path=path), urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')

    def test_private_files_directory_lists_and_traversal_are_not_served(self):
        for path in ['/.env', '/.nojekyll', '/server.py', '/assets/', '/docs/',
                     '/assets/../.env', '/assets/%2e%2e/.env',
                     '/assets/%2e%2e/server.py', '/assets/.private/token.js',
                     '/assets/%252e%252e/.env', '/assets/outside.js', '/assets/source.js',
                     '/assets/inside.js', '/assets/%00.js']:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(self.base + path)
            self.assertEqual(cm.exception.code, 404)

    def test_head_and_query_strings_preserve_public_policy(self):
        request = urllib.request.Request(self.base + '/assets/app.js?cache=1', method='HEAD')
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'')
            self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
            self.assertIn('wss:', response.headers['Content-Security-Policy'])

    def test_mutating_methods_have_no_endpoint(self):
        request = urllib.request.Request(self.base + '/index.html', method='POST', data=b'overwrite')
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(request)
        self.assertEqual(cm.exception.code, 501)
        self.assertEqual((self.public_root / 'index.html').read_text(), '<!doctype html><title>Edge</title>')


if __name__ == '__main__':
    unittest.main()

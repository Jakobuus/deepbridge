#!/usr/bin/env python3
"""Expose only the hosted voice app's three interview routes on a local port for the demo tunnel."""
from contextlib import closing
from http.client import HTTPConnection, HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re

HOST = '127.0.0.1'
PORT = 8099
UPSTREAM_PORT = 8000
WEBHOOK = '/interview/transcript'
POST_PATHS = {'/interview/transcript', '/interview/turn'}
BRIEF = re.compile(r'^/interview/brief/[A-Za-z0-9_-]{1,64}$')
MAX_BODY = 64 * 1024


class WebhookProxy(BaseHTTPRequestHandler):
    timeout = 15

    def __getattr__(self, name):
        if name.startswith('do_'):
            return self._not_found
        raise AttributeError(name)

    def _not_found(self):
        self.send_error(404)

    def _path(self):
        parts = self.requestline.split()
        return parts[1] if len(parts) > 1 else ''

    def _is_webhook(self):
        path = self._path()
        return path in POST_PATHS or bool(BRIEF.match(path))

    def end_headers(self):
        if self._is_webhook() and self.command in ('GET', 'POST', 'OPTIONS'):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Expose-Headers', 'X-Interview-Data')
        super().end_headers()

    def do_OPTIONS(self):
        if not self._is_webhook():
            return self._not_found()
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if not BRIEF.match(self._path()):
            return self._not_found()
        self._forward('GET', b'')

    def do_POST(self):
        if self._path() not in POST_PATHS:
            return self._not_found()
        lengths = self.headers.get_all('Content-Length', [])
        if (len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit()
                or self.headers.get('Transfer-Encoding') is not None):
            return self.send_error(400, 'Expected a single numeric Content-Length')
        size = lengths[0].lstrip('0') or '0'
        if len(size) > len(str(MAX_BODY)) or int(size) > MAX_BODY:
            return self.send_error(413, 'Body exceeds 64 KB')
        try:
            body = self.rfile.read(int(size))
        except TimeoutError:
            return self.send_error(408, 'Request body timed out')
        if len(body) != int(size):
            return self.send_error(400, 'Incomplete request body')

        self._forward('POST', body)

    def _forward(self, method, body):
        try:
            with closing(HTTPConnection(HOST, UPSTREAM_PORT, timeout=200)) as upstream:
                upstream.request(method, self._path(), body=body or None, headers={
                    'Content-Type': self.headers.get('Content-Type', 'application/json'),
                })
                response = upstream.getresponse()
                payload = response.read()
        except TimeoutError:
            return self.send_error(504, 'Transcript service timed out')
        except (OSError, HTTPException):
            return self.send_error(502, 'Transcript service unavailable')

        self.send_response(response.status)
        for name in ('Content-Type', 'X-Interview-Data'):
            value = response.getheader(name)
            if value is not None:
                self.send_header(name, value)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    with ThreadingHTTPServer((HOST, PORT), WebhookProxy) as server:
        print(f'Webhook proxy listening on http://{HOST}:{PORT}{WEBHOOK}', flush=True)
        server.serve_forever()

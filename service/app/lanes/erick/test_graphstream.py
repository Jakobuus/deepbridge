"""Tests for /graph/stream + /graph/events. Run: cd service && uv run python -m pytest -q app/lanes/erick/test_graphstream.py
(or: uv run python app/lanes/erick/test_graphstream.py). Real uvicorn on localhost, urllib client."""
import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parents[3]))
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta

import uvicorn
from app import events

_server = None
_base = ''


def _start():
    global _server, _base
    if _server:
        return _base
    from app.main import app
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    _server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
    threading.Thread(target=_server.run, daemon=True).start()
    _base = f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            urllib.request.urlopen(_base + '/health', timeout=1).read()
            return _base
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('server did not start')


def _sid(name):
    return f'gs-{name}-{uuid.uuid4().hex[:8]}'


def _mk(n, gaps=None):
    t0 = datetime(2026, 11, 24, 12, 0, 0, tzinfo=UTC)
    out, t = [], t0
    for i in range(n):
        if i and gaps:
            t += timedelta(seconds=gaps[i - 1])
        out.append({'seq': 99, 'at': t.isoformat(), 'session_id': 'x', 'phase': 'reading', 'kind': 'status',
                    'layer': 'core', 'status': f'e{i + 1}'})
    return out


def _parse(raw):
    msgs = []
    for block in raw.split('\n\n'):
        if not block.strip():
            continue
        m = {}
        for line in block.split('\n'):
            if line.startswith(':'):
                m['comment'] = line
            elif ': ' in line:
                k, v = line.split(': ', 1)
                m[k] = v
        msgs.append(m)
    return msgs


def _read(url, headers=None, until=None, timeout=10):
    """Read SSE until closed or until(msgs) is true. Returns parsed messages."""
    req = urllib.request.Request(_start() + url, headers=headers or {})
    buf, deadline = '', time.time() + timeout
    with urllib.request.urlopen(req, timeout=timeout) as r:
        assert r.headers['Content-Type'].startswith('text/event-stream')
        assert r.headers['Cache-Control'] == 'no-cache'
        assert r.headers['X-Accel-Buffering'] == 'no'
        while time.time() < deadline:
            line = r.readline()
            if not line:
                break
            buf += line.decode()
            if until and buf.endswith('\n\n') and until(_parse(buf)):
                break
    return _parse(buf)


def _graph(msgs):
    return [json.loads(m['data']) for m in msgs if m.get('event') == 'graph']


def test_events_endpoint():
    sid = _sid('ev')
    events.load_log(sid, _mk(3))
    data = json.loads(urllib.request.urlopen(f'{_start()}/graph/events?session_id={sid}').read())
    assert [e['seq'] for e in data] == [1, 2, 3]
    assert all(e['session_id'] == sid for e in data)
    assert json.loads(urllib.request.urlopen(f'{_start()}/graph/events?session_id={_sid("none")}').read()) == []


def test_load_log_keeps_at_and_is_silent():
    sid = _sid('ll')
    q = events.subscribe(sid)
    src = _mk(2, [5])
    assert events.load_log(sid, src) == 2
    assert q.empty()
    events.unsubscribe(sid, q)
    got = events.events(sid)
    assert [e['at'] for e in got] == [e['at'] for e in src]
    assert events.load_log(sid, _mk(1)) == 1 and len(events.events(sid)) == 1


def test_backlog_and_from_seq():
    sid = _sid('bk')
    for i in range(4):
        events.publish(sid, 'reading', 'status', 'core', status=f's{i}')
    # live mode never ends: stop once we have what we expect
    msgs = _read(f'/graph/stream?session_id={sid}', until=lambda m: len(_graph(m)) >= 4)
    assert [e['seq'] for e in _graph(msgs)] == [1, 2, 3, 4]
    assert [m['id'] for m in msgs if m.get('event') == 'graph'] == ['1', '2', '3', '4']
    msgs = _read(f'/graph/stream?session_id={sid}&from_seq=2', until=lambda m: len(_graph(m)) >= 2)
    assert [e['seq'] for e in _graph(msgs)] == [3, 4]


def test_last_event_id():
    sid = _sid('le')
    for i in range(5):
        events.publish(sid, 'reading', 'status', 'core', status=f's{i}')
    msgs = _read(f'/graph/stream?session_id={sid}&from_seq=1', headers={'Last-Event-ID': '3'},
                 until=lambda m: len(_graph(m)) >= 2)
    assert [e['seq'] for e in _graph(msgs)] == [4, 5]
    msgs = _read(f'/graph/stream?session_id={sid}&from_seq=4', headers={'Last-Event-ID': '2'},
                 until=lambda m: len(_graph(m)) >= 1)
    assert [e['seq'] for e in _graph(msgs)] == [5]  # larger from_seq wins


def test_live_event_exactly_once():
    sid = _sid('lv')
    events.publish(sid, 'reading', 'status', 'core', status='old')

    def later():
        time.sleep(0.5)
        events.publish(sid, 'reading', 'status', 'core', status='new1')
        events.publish(sid, 'reading', 'status', 'core', status='new2')

    threading.Thread(target=later).start()
    msgs = _read(f'/graph/stream?session_id={sid}', until=lambda m: len(_graph(m)) >= 3)
    time.sleep(0.3)
    assert [e['seq'] for e in _graph(msgs)] == [1, 2, 3]
    assert [e['status'] for e in _graph(msgs)] == ['old', 'new1', 'new2']
    time.sleep(0.2)  # subscriber removed after disconnect
    assert not events._SUBS.get(sid)


def test_replay_speed_order_end_and_timing():
    sid = _sid('rp')
    gaps = [4.0, 8.0, 0.0, 100.0]  # -> 0.5, 1.0, 0.02(clamp), 2.0(clamp)
    events.load_log(sid, _mk(5, gaps))
    t = time.time()
    msgs = _read(f'/graph/stream?session_id={sid}&speed=8', timeout=15)
    took = time.time() - t
    assert [e['seq'] for e in _graph(msgs)] == [1, 2, 3, 4, 5]
    assert msgs[-1]['event'] == 'end'
    assert json.loads(msgs[-1]['data']) == {'session_id': sid, 'last_seq': 5}
    expected = 0.5 + 1.0 + 0.02 + 2.0
    assert expected - 0.1 <= took <= expected + 1.5, took


def test_replay_empty_session_ends():
    sid = _sid('re')
    msgs = _read(f'/graph/stream?session_id={sid}&speed=4')
    assert len(msgs) == 1 and msgs[0]['event'] == 'end'
    assert json.loads(msgs[0]['data'])['last_seq'] == 0


def test_speed_invalid_is_422():
    for sp in ('0', '-1'):
        try:
            urllib.request.urlopen(f'{_start()}/graph/stream?session_id={_sid("sp")}&speed={sp}')
        except urllib.error.HTTPError as e:
            assert e.code == 422
        else:
            raise AssertionError('expected 422')


def test_ensure_recorded_bad_ids():
    for bad in ('../etc/passwd', 'a/b', '', 'x' * 65, 'a b', 'a.json'):
        assert events.ensure_recorded(bad) is False
    assert events.ensure_recorded(_sid('missing')) is False


def test_ensure_recorded_loads_file(tmp_path=None):
    import tempfile
    from pathlib import Path
    sid = _sid('fx')
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / f'{sid}.json').write_text(json.dumps(_mk(2)))
        old, events._LOG_DIR = events._LOG_DIR, Path(d)
        try:
            assert events.ensure_recorded(sid) is True
            assert [e['seq'] for e in events.events(sid)] == [1, 2]
            assert events.ensure_recorded(sid) is False  # already has events
        finally:
            events._LOG_DIR = old


def _main():
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print('ok  ', name)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print('FAIL', name, repr(exc))
    if _server:
        _server.should_exit = True
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    _main()

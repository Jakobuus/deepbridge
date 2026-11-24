"""Tests for /graph/stream + /graph/events. Run: cd service && uv run python -m pytest -q app/lanes/erick/test_graphstream.py
(or: uv run python app/lanes/erick/test_graphstream.py). Real uvicorn on localhost, urllib client."""
import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parents[3]))
import json  # noqa: I001, RUF100  (isort differs: repo root vs service/)
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
    for bad in ('../etc/passwd', 'a/b', '', 'x' * 65, 'a b', 'a.json', 'abc\n'):
        assert events.ensure_recorded(bad) is False
    assert events.ensure_recorded('abc\n') is False  # trailing newline must not pass
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


def test_ensure_recorded_rejects_invalid_file():
    import tempfile
    from pathlib import Path
    sid = _sid('bad')
    good = _mk(2)
    for tweak in ({'phase': 'nope'}, {'kind': 'x'}, {'layer': 'x'}, {'at': 5}, {'phase': ['reading']}, {'kind': {'a': 1}}, {'at': 'not-a-date'},
                  {'node': 'str'}, {'edge': []}, {'evidence': {}}, {'status': 3}):
        bad = [good[0], {**good[1], **tweak}]
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / f'{sid}.json').write_text(json.dumps(bad))
            old, events._LOG_DIR = events._LOG_DIR, Path(d)
            try:
                assert events.ensure_recorded(sid) is False
                assert events.events(sid) == []
            finally:
                events._LOG_DIR = old
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / f'{sid}.json').write_text(json.dumps([good[0], 'junk']))
        old, events._LOG_DIR = events._LOG_DIR, Path(d)
        try:
            assert events.ensure_recorded(sid) is False
        finally:
            events._LOG_DIR = old


def test_valid_record_accepts_z_and_optionals():
    r = _mk(1)[0]
    assert events._valid_record({**r, 'at': '2026-11-24T12:00:00Z', 'node': {}, 'evidence': [], 'status': 's'})


def test_heartbeat_while_events_flow():
    from app.routers import graphstream
    sid = _sid('hb')
    events.publish(sid, 'reading', 'status', 'core', status='x')
    stop = threading.Event()

    def pump():
        while not stop.is_set():
            events.publish(sid, 'reading', 'status', 'core', status='y')
            time.sleep(0.05)

    old, graphstream.PING_EVERY = graphstream.PING_EVERY, 0.3
    t = threading.Thread(target=pump)
    t.start()
    try:
        msgs = _read(f'/graph/stream?session_id={sid}', until=lambda m: any('comment' in x for x in m))
        assert any('comment' in x for x in msgs) and len(_graph(msgs)) >= 2
    finally:
        stop.set()
        t.join()
        graphstream.PING_EVERY = old


def test_replay_cap_and_batches():
    from app.routers import graphstream
    sid = _sid('cap')
    events.load_log(sid, _mk(120))
    msgs = _read(f'/graph/stream?session_id={sid}&speed=64', timeout=20)
    assert [e['seq'] for e in _graph(msgs)] == list(range(1, 121))
    time.sleep(0.3)  # let the first stream's cleanup finish
    old, graphstream._active = graphstream._active, graphstream.MAX_LIVE
    try:
        urllib.request.urlopen(f'{_start()}/graph/stream?session_id={sid}&speed=4')
    except urllib.error.HTTPError as e:
        assert e.code == 503
    else:
        raise AssertionError('expected 503')
    finally:
        graphstream._active = old
    time.sleep(0.2)
    assert graphstream._active == old


def test_ensure_recorded_does_not_clobber():
    sid = _sid('cl')
    events.publish(sid, 'reading', 'status', 'core', status='live')
    assert events._install_if_empty(sid, _mk(3)) is False
    assert len(events.events(sid)) == 1


def test_unsubscribe_cleans_key_and_bounded_publish():
    sid = _sid('bq')
    q = events._subscribe_bounded(sid, 1)
    for i in range(5):
        events.publish(sid, 'reading', 'status', 'core', status=str(i))  # must not block/raise
    assert q.qsize() == 1
    events.unsubscribe(sid, q)
    assert sid not in events._SUBS


def test_disconnect_unsubscribes():
    base = _start()
    sid = _sid('dc')
    events.publish(sid, 'reading', 'status', 'core', status='a')
    host, port = base.replace('http://', '').split(':')
    s = socket.create_connection((host, int(port)))
    s.sendall(f'GET /graph/stream?session_id={sid} HTTP/1.1\r\nHost: x\r\n\r\n'.encode())
    buf = b''
    while b'event: graph' not in buf:
        buf += s.recv(4096)
    assert events._SUBS.get(sid)
    s.close()
    deadline = time.time() + 3
    while time.time() < deadline and events._SUBS.get(sid):
        time.sleep(0.1)
    assert not events._SUBS.get(sid)


def _post(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method='POST'), timeout=30)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


def test_discover():
    import urllib.parse
    base = _start()
    sid = _sid('disc')
    st, body = _post(f'{base}/graph/discover?session_id={sid}&pace=0.05')
    assert st == 202 and body['queued'] > 10, (st, body)
    assert _post(f'{base}/graph/discover?session_id={sid}&pace=0.05')[0] == 409
    deadline, last, evs = time.time() + 30, -1, []
    while time.time() < deadline:
        evs = json.loads(urllib.request.urlopen(f'{base}/graph/events?session_id={sid}').read())
        if len(evs) == body['queued'] and len(evs) == last:
            break
        last = len(evs)
        time.sleep(0.5)
    assert len(evs) == body['queued'], (len(evs), body)
    assert [e['seq'] for e in evs] == list(range(1, len(evs) + 1))
    scores = [e['path']['score'] for e in evs if e['kind'] == 'path']
    assert scores and scores[-1] == max(scores)
    assert _post(f'{base}/graph/discover?session_id={sid}')[0] == 409  # now has discovery events
    assert _post(f'{base}/graph/discover?session_id={urllib.parse.quote("bad id!")}')[0] == 422
    assert _post(f'{base}/graph/discover?session_id=demo-hopo')[0] == 409
    assert _post(f'{base}/graph/discover?session_id={_sid("x")}&founder_id=nope')[0] == 404


def _post_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


def test_sharpen():
    base = _start()
    sid = _sid('sharp')
    st, body = _post(f'{base}/graph/discover?session_id={sid}&pace=0.05')
    assert st == 202
    deadline, last, evs = time.time() + 30, -1, []
    while time.time() < deadline:
        evs = json.loads(urllib.request.urlopen(f'{base}/graph/events?session_id={sid}').read())
        if len(evs) == body['queued'] and len(evs) == last:
            break
        last = len(evs)
        time.sleep(0.5)
    cats = json.loads(urllib.request.urlopen(f'{base}/graph/categories?session_id={sid}').read())
    assert cats and {'id', 'name', 'keyword'} <= set(cats[0]) and cats[0]['keyword'] == 'radiation', cats
    org = next(e['node']['id'] for e in evs if e['kind'] == 'node' and e['layer'] == 'lead' and e['node']['id'].startswith('org:'))
    core = next(e['node']['id'] for e in evs if e['kind'] == 'node' and e['layer'] == 'core')
    n0 = len(evs)
    url = f'{base}/graph/sharpen?session_id={sid}'
    st, r = _post_json(url, {'confirm': [core, 'nope:1'], 'fade': [org], 'category_weights': {'Radiation': 1.7, 'zzz': 0.5}})
    assert st == 200, st
    assert r['confirmed'] == [core] and r['faded'] == [org] and r['ignored'] == 2, r
    assert r['weights'] == {cats[0]['id']: 1.0} and r['published'] == 4, r
    new = json.loads(urllib.request.urlopen(f'{base}/graph/events?session_id={sid}').read())[n0:]
    assert [(e['kind'], e.get('state'), e['phase']) for e in new[:2]] == [('node', 'confirmed', 'interview'), ('node', 'faded', 'interview')]
    assert new[1]['layer'] == 'lead' and new[0]['layer'] == 'core'
    assert new[2]['kind'] == 'category' and new[2]['weight'] == 1.0 and new[2]['node']['id'] == cats[0]['id']
    assert new[3]['kind'] == 'status' and '1 confirmed, 1 faded' in new[3]['status']
    assert _post_json(f'{base}/graph/sharpen?session_id=bad%20id', {})[0] == 422


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

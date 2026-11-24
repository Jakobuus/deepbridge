#!/usr/bin/env bash
# Mutates memory and spends credits; reset before AND after this rehearsal.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEMO_ROOT="$ROOT" BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
python3 - <<'PY'
import json, os, pathlib, subprocess, time
from urllib.parse import quote
from urllib.request import Request, urlopen

root = pathlib.Path(os.environ['DEMO_ROOT'])
base = os.environ['BASE_URL'].rstrip('/')
failed = False
limit = 1.5

def request(method, path, body=None):
    global failed
    start = time.perf_counter()
    try:
        req = Request(base + path, method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type': 'application/json'})
        with urlopen(req, timeout=limit) as response:
            result = json.load(response)
        elapsed = time.perf_counter() - start
        passed, detail = elapsed < limit, '200'
    except Exception as exc:
        result, passed, detail = None, False, type(exc).__name__
        elapsed = time.perf_counter() - start
    failed |= not passed
    print(f'{"PASS" if passed else "FAIL":<6} {method:<4} {path:<62} {elapsed:>6.3f}s {detail}', flush=True)
    return result

print('RESULT ENDPOINT                                                              TIME    HTTP', flush=True)
warm = subprocess.run(['bash', str(root / 'scripts/warm-cache.sh')],
                      env={**os.environ, 'DEMO_MAX_SECONDS': str(limit)})
failed |= warm.returncode != 0
# Contract writes on the cached first path, matching service/smoke.sh.
# Keep its card at approved or earlier so smoke can verify its transitions.
try:
    def fixture(name):
        data = json.loads((root / f'fixtures/{name}.json').read_text())
        return data.get('items', data) if isinstance(data, dict) else data
    paths, edges = fixture('paths'), fixture('edges')
    path = paths[0]
    templates = [d for d in fixture('drafts') if d['path_id'] == path['id']]
    if not templates:
        raise ValueError('First path has no cached drafts; refusing to launch CLI')
    request('POST', '/intake', {'query': 'Lightmatter'})
    request('POST', '/name-check', {'edge_id': edges[0]['id'], 'decision': 'ok'})
    drafts = request('POST', '/drafts', {'path_id': path['id']})
    if not drafts:
        raise ValueError('No drafts; run demo-reset.sh before demo-check.sh')
    draft = drafts[0]
    edited = request('PUT', '/drafts/' + quote(draft['id'], safe=''),
                     {'subject': draft['subject'], 'body': draft['body']})
    if edited:
        request('POST', '/approve', {'draft_id': edited['id'], 'content_hash': edited['content_hash'],
                                     'decision': 'approve'})
    card = next(c for c in fixture('cards') if c['path_id'] == path['id'])
    request('POST', '/pipeline/' + quote(card['id'], safe='') + '/advance',
            {'stage': 'approved', 'actor': 'Demo check'})
except (KeyError, ValueError, StopIteration, OSError) as exc:
    print(f'FAIL   Write checks: {exc}', flush=True)
    failed = True
print('\nRunning service/smoke.sh (includes expected 409 and 402 checks):', flush=True)
try:
    smoke = subprocess.run(['bash', 'smoke.sh'], cwd=root / 'service', timeout=60)
    passed = smoke.returncode == 0
except subprocess.TimeoutExpired:
    passed = False
print(f'{"PASS" if passed else "FAIL":<6} service/smoke.sh', flush=True)
failed |= not passed
print('\nReset before presenting: bash scripts/demo-reset.sh && bash scripts/warm-cache.sh', flush=True)
print('FAIL demo readiness' if failed else 'PASS demo readiness (all demo endpoints < 1.5s; smoke passed)', flush=True)
raise SystemExit(1 if failed else 0)
PY

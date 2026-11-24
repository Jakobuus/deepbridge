#!/usr/bin/env bash
# Hit each demo GET, all cached contacts, and each available evidence record once.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEMO_ROOT="$ROOT" BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
python3 - <<'PY'
import json, os, pathlib, time
from urllib.parse import quote, urlencode
from urllib.request import urlopen

root = pathlib.Path(os.environ['DEMO_ROOT'])
base = os.environ['BASE_URL'].rstrip('/')
limit = float(os.environ.get('DEMO_MAX_SECONDS', '10'))
founder = json.loads((root / 'fixtures/founder.json').read_text())['id']
query = urlencode({'founder_id': founder})
failed = False

def get(path, scoped=True):
    global failed
    url = path + (('&' if '?' in path else '?') + query if scoped else '')
    start = time.perf_counter()
    try:
        with urlopen(base + url, timeout=limit) as response:
            result = json.load(response)
        elapsed = time.perf_counter() - start
        passed = elapsed < limit
        detail = '200' if passed else 'too slow'
    except Exception as exc:
        result, passed, detail = None, False, type(exc).__name__
        elapsed = time.perf_counter() - start
    failed |= not passed
    print(f'{"PASS" if passed else "FAIL":<6} GET {path:<63} {elapsed:>6.3f}s {detail}', flush=True)
    return result

print(f'Lightmatter GET warm-up: {base} (limit < {limit:g}s)')
health = get('/health', scoped=False)
if not health or health.get('status') != 'ok':
    raise SystemExit(1)
results = {path: get(path) for path in ('/icp', '/buyers', '/graph', '/paths', '/pipeline', '/metrics', '/credits')}
get('/search?' + urlencode({'q': 'Harris'}))
# Only cached contacts: other people may trigger a live Moss job.
contacts = json.loads((root / 'fixtures/contacts.json').read_text())
contacts = contacts.get('items', []) if isinstance(contacts, dict) else contacts
if not contacts:
    print('FAIL   No cached contacts available')
    failed = True
for contact in contacts:
    get('/contacts/' + quote(contact['person_id'], safe=''))
# Contact and buyer reads register their own evidence in the service.
# Merge their fixture evidence with the graph snapshot, without a second graph GET.
evidence = {e['id'] for e in (results.get('/graph') or {}).get('evidence', [])}
for name in ('contacts', 'buyers_computed'):
    data = json.loads((root / f'fixtures/{name}.json').read_text()) if (root / f'fixtures/{name}.json').exists() else {}
    if isinstance(data, dict):
        evidence.update(e['id'] for e in data.get('evidence', []))
if not evidence:
    print('FAIL   No evidence available')
    failed = True
for identifier in sorted(evidence):
    get('/evidence/' + quote(identifier, safe=''))
raise SystemExit(1 if failed else 0)
PY

#!/usr/bin/env bash
# Restore the committed demo, then start a fresh in-memory store.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEMO_ROOT="$ROOT" DEMO_PORT="${DEMO_PORT:-8000}"
# Flexprice live: put the wallets back to DEMO_CREDITS (default 5) so /credits matches below.
if python3 -c "import re,sys;sys.exit(0 if any(re.match(r'FLEXPRICE_API_KEY=.+',l) for l in open('$ROOT/.env')) else 1)" 2>/dev/null; then
  python3 "$ROOT/scripts/flexprice_topup.py" --set "${DEMO_CREDITS:-5}" || echo "WARN: Flexprice wallet reset failed; service falls back to local counter"
fi
python3 - <<'PY'
import json, os, pathlib, shutil, signal, subprocess, tempfile, time
from urllib.request import urlopen

root = pathlib.Path(os.environ['DEMO_ROOT']).resolve()
port = int(os.environ['DEMO_PORT'])
if not 1 <= port <= 65535:
    raise SystemExit('Invalid DEMO_PORT')
service = root / 'service'
if not shutil.which('uv') or not shutil.which('lsof'):
    raise SystemExit('Reset requires uv and lsof on PATH')

def listeners():
    result = subprocess.run(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'],
                            capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise SystemExit('Cannot inspect the service port with lsof')
    return {int(pid) for pid in result.stdout.split()}

# Refuse to kill another app, including DeepBridge running from another checkout.
pids = listeners()
for pid in pids:
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'args='], text=True)
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True)
    directories = [pathlib.Path(line[1:]).resolve() for line in cwd.splitlines() if line.startswith('n')]
    if 'uvicorn' not in command or 'app.main:app' not in command or service not in directories:
        raise SystemExit(f'Refusing to stop PID {pid}: port {port} belongs to another app/checkout')

# Read and validate every committed JSON before touching the service or files.
names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'fixtures/'],
                                cwd=root, text=True).splitlines()
snapshot = {}
for name in names:
    if pathlib.PurePosixPath(name).parent == pathlib.PurePosixPath('fixtures') and name.endswith('.json'):
        raw = subprocess.check_output(['git', 'show', f'HEAD:{name}'], cwd=root)
        json.loads(raw)
        snapshot[name] = raw
if 'fixtures/credits.json' not in snapshot:
    raise SystemExit('Committed credit fixture is missing')
credits = json.loads(snapshot['fixtures/credits.json'])
want = int(os.environ.get('DEMO_CREDITS', '5'))  # DEMO_CREDITS=1 stages the 402 credit-gate beat
if credits['balance'] != want:
    credits['balance'] = want
    snapshot['fixtures/credits.json'] = (json.dumps(credits, indent=2) + '\n').encode()

for pid in pids:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
for _ in range(100):
    if not listeners():
        break
    time.sleep(0.1)
else:
    raise SystemExit('Service did not stop within 10s; no fixtures changed')
for name, raw in snapshot.items():
    target = root / name
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temporary:
        temporary.write(raw)
        temporary_path = pathlib.Path(temporary.name)
    temporary_path.replace(target)
# Untracked JSONs are left alone; no git checkout/reset and no index changes.
log_dir = pathlib.Path(tempfile.gettempdir()) / ('deepbridge-demo-' + str(os.getuid()))
log_dir.mkdir(mode=0o700, exist_ok=True)
log_path = log_dir / f'service-{port}.log'
with log_path.open('ab') as log:
    process = subprocess.Popen(['uv', 'run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1',
                                '--port', str(port)], cwd=service, stdout=log, stderr=log,
                               stdin=subprocess.DEVNULL, start_new_session=True)
base = f'http://127.0.0.1:{port}'
for _ in range(150):
    if process.poll() is not None:
        raise SystemExit(f'Service exited; see {log_path}')
    try:
        with urlopen(base + '/health', timeout=0.5) as response:
            health = json.load(response)
        with urlopen(base + '/credits', timeout=0.5) as response:
            balance = json.load(response)['balance']
        if health.get('status') == 'ok' and balance == want:
            print(f'PASS reset: {len(snapshot)} committed fixtures restored; credits={want}; {base}')
            print(f'Service log: {log_path}')
            break
    except (OSError, ValueError):
        pass
    time.sleep(0.2)
else:
    raise SystemExit(f'Service not ready within 30s; see {log_path}')
PY

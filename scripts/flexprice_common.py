"""Tiny Flexprice REST helper shared by the setup/top-up scripts (stdlib only)."""
import json
import os
import pathlib
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parent.parent
FOUNDERS = {'person:openalex:A5043992375': 'Rebecca J. Abergel',
            'person:openalex:A5102978866': 'Nicholas C. Harris'}
METERS = ['leads_enriched', 'outreach_sent', 'graph_queries']


def load_env():
    for line in (ROOT / '.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))
    return os.environ['FLEXPRICE_API_KEY'], os.environ['FLEXPRICE_BASE_URL'].rstrip('/')


def call(method, path, body=None, timeout=15):
    key, base = load_env()
    req = Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                  headers={'x-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raise SystemExit(f'{method} {path} -> HTTP {exc.code}: {exc.read()[:300].decode(errors="replace")}')


def wallet_for(external_id):
    cust = call('GET', '/customers/external/' + quote(external_id, safe=''))
    wallets = [w for w in call('GET', '/customers/' + cust['id'] + '/wallets')
               if w.get('wallet_status') == 'active']
    return cust, (wallets[0] if wallets else None)


def balance(wallet_id):
    return float(call('GET', f'/wallets/{wallet_id}/balance/real-time')['real_time_credit_balance'])


def set_balance(external_id, target):
    """Top up (or manually debit) the founder wallet to exactly `target` credits."""
    _, w = wallet_for(external_id)
    cur = balance(w['id'])
    diff = target - cur
    if diff > 0:
        call('POST', f'/wallets/{w["id"]}/top-up', {'credits_to_add': str(diff),
             'transaction_reason': 'FREE_CREDIT_GRANT', 'description': 'demo reset/top-up'})
    elif diff < 0:
        drain(external_id, w['id'], int(round(-diff)))
    return cur, balance(w['id'])


def drain(external_id, wallet_id, n, wait=60):
    """Lower the real-time balance by ingesting n real usage events (priced 1 credit each)."""
    import time
    import uuid
    target = balance(wallet_id) - n
    call('POST', '/events/bulk', {'events': [{'event_id': str(uuid.uuid4()), 'event_name': 'outreach_sent',
         'external_customer_id': external_id, 'source': 'deepbridge',
         'properties': {'demo_staging': 'true'}} for _ in range(n)]})
    for _ in range(wait):
        if balance(wallet_id) <= target:
            return
        time.sleep(1)
    print('warn: balance did not settle to', target)

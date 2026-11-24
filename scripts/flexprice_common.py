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
        try:  # HACK: debit endpoint is not in the public spec; reset only tops up if it fails
            call('POST', f'/wallets/{w["id"]}/debit', {'credits': str(-diff),
                 'transaction_reason': 'MANUAL_BALANCE_DEBIT', 'description': 'demo reset'})
        except SystemExit:
            print('note: cannot debit above-target wallet; balance stays', cur)
    return cur, balance(w['id'])

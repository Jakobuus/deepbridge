"""Small synchronous Flexprice client; no SDK or paid API dependencies."""
import json
import math
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import uuid4

from fastapi import HTTPException
from ...models import CreditEvent, Credits
from ...store import now, store


class Flexprice:
    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.customers = {}
        self.feature_ready = False
        self.events = {}

    def request(self, method, path, body=None):
        request = Request(self.base_url + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}

    def customer(self, founder):
        if founder.id not in self.customers:
            try:
                customer = self.request('GET', '/customers/external/' + quote(founder.id, safe=''))
            except HTTPError as exc:
                if exc.code != 404:
                    raise
                customer = self.request('POST', '/customers',
                    {'external_id': founder.id, 'name': founder.name})
            self.customers[founder.id] = customer['id']
        return self.customers[founder.id]

    def ensure_feature(self):
        if self.feature_ready:
            return
        result = self.request('POST', '/features/search', {'lookup_key': 'path_enriched'})
        features = [f for f in result['items'] if f.get('lookup_key') == 'path_enriched']
        if features:
            feature = features[0]
            meter = feature.get('meter') or {}
            if (feature.get('type') != 'metered' or meter.get('event_name') != 'path_enriched'
                    or meter.get('aggregation', {}).get('type') != 'COUNT'):
                raise ValueError('path_enriched must be a metered COUNT feature')
        else:
            self.request('POST', '/features', {'name': 'Path enriched',
                'lookup_key': 'path_enriched', 'type': 'metered',
                'meter': {'name': 'Path enriched', 'event_name': 'path_enriched',
                          'reset_usage': 'BILLING_PERIOD', 'aggregation': {'type': 'COUNT'}}})
        self.feature_ready = True

    def balance(self, founder):
        customer_id = self.customer(founder)
        wallets = self.request('GET', '/customers/' + quote(customer_id, safe='') + '/wallets')
        # Never combine currencies or silently spend from an arbitrary wallet.
        active = [w for w in wallets if w.get('wallet_status') == 'active'
                  and w.get('status', 'published') == 'published']
        if not active:
            return 0.0
        if len(active) != 1:
            raise ValueError('Configure exactly one active credit wallet for this founder')
        result = self.request('GET', '/wallets/' + quote(active[0]['id'], safe='') + '/balance/real-time')
        if result.get('is_cached_fallback') is not False:
            raise ValueError('Fresh Flexprice balance unavailable')
        value = float(result['real_time_credit_balance'])
        if not math.isfinite(value):
            raise ValueError('Invalid Flexprice balance')
        return value

    def usage(self, founder, action):
        self.ensure_feature()
        self.request('POST', '/events', {'event_id': str(uuid4()),
            'event_name': 'path_enriched', 'external_customer_id': founder.id,
            'properties': {'action': action}, 'source': 'deepbridge'})


_client = None


def client():
    global _client
    key, base = os.getenv('FLEXPRICE_API_KEY'), os.getenv('FLEXPRICE_BASE_URL')
    if not key or not base:
        return None
    if _client is None or (_client.base_url, _client.api_key) != (base.rstrip('/'), key):
        _client = Flexprice(base, key)
    return _client


def _billing(operation):
    try:
        return operation()
    except (URLError, OSError, ValueError, KeyError, TypeError) as exc:
        # Don't expose provider bodies or credential-bearing request URLs.
        raise HTTPException(503, 'Billing unavailable; action paused') from exc


def credits():
    with store.lock:
        remote = client()
        if remote is None:
            return store.credits.model_copy(update={'source': 'local'}, deep=True)
        balance = _billing(lambda: remote.balance(store.founder))
        return Credits(balance=balance, unit='credit', events=list(remote.events.get(store.founder.id, [])), source='flexprice')


def gate(action, *, draft=False):
    """Meter an attempted action before it runs. Draft handlers debit local memory themselves."""
    with store.lock:
        remote = client()
        if remote is not None:
            balance = _billing(lambda: remote.balance(store.founder))
            if balance < 1:
                remote.events.setdefault(store.founder.id, []).append(
                    CreditEvent(at=now(), action=action, delta=0, blocked=True))
                store.credit_event(action, 0, True)
                raise HTTPException(402, 'No credits remaining')
            _billing(lambda: remote.usage(store.founder, action))
            remote.events.setdefault(store.founder.id, []).append(
                CreditEvent(at=now(), action=action, delta=-1, blocked=False))
            # Existing draft handlers still enforce and record their one-credit debit.
            store.credits.balance = balance
        elif draft:
            return
        if store.credits.balance < 1:
            store.credit_event(action, 0, True)
            raise HTTPException(402, 'No credits remaining')
        if not draft:
            store.credit_event(action, -1)

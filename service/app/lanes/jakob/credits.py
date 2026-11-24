"""Small synchronous Flexprice client; no SDK or paid API dependencies."""
import json
import math
import os
import threading
import time
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
        self.feature_ready = True  # features/meters are created by scripts/flexprice_setup.py
        self.events = {}
        self.timeout = 3  # never block the demo on Flexprice
        self.cache = {}  # founder id -> (balance, read at)
        self.last_usage = 0.0

    def request(self, method, path, body=None):
        request = Request(self.base_url + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'x-api-key': self.api_key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=self.timeout) as response:
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
        hit = self.cache.get(founder.id)
        if hit and time.monotonic() - hit[1] < 2.5:
            return hit[0]
        value = self._balance(founder)
        # Usage settles asynchronously: right after an event, trust the lower number.
        if time.monotonic() - self.last_usage < 8 and hit:
            value = min(value, hit[0])
        self.cache[founder.id] = (value, time.monotonic())
        return value

    def _balance(self, founder):
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

    def usage(self, founder, event_name, action):
        """Fire-and-forget: a failed send is logged, never raised."""
        def send():
            try:
                self.request('POST', '/events', {'event_id': str(uuid4()),
                    'event_name': event_name, 'external_customer_id': founder.id,
                    'properties': {'action': action}, 'source': 'deepbridge'})
            except Exception as exc:  # HACK: demo never blocks on metering
                print('flexprice usage event failed:', type(exc).__name__)
        self.last_usage = time.monotonic()
        hit = self.cache.get(founder.id)
        if hit:
            self.cache[founder.id] = (hit[0] - 1, time.monotonic())
        threading.Thread(target=send, daemon=True).start()


_client = None
UNREACHABLE = 'local (Flexprice unreachable)'


def client():
    global _client
    key, base = os.getenv('FLEXPRICE_API_KEY'), os.getenv('FLEXPRICE_BASE_URL')
    if not key or not base:
        return None
    if _client is None or (_client.base_url, _client.api_key) != (base.rstrip('/'), key):
        _client = Flexprice(base, key)
    return _client


def event_name(action):
    if action.startswith('contacts:'):
        return 'leads_enriched'
    if action.startswith('drafts:'):
        return 'outreach_sent'
    return 'graph_queries'


def dashboard_url(remote, founder):
    # No documented customer-page URL: only link when FLEXPRICE_DASHBOARD_URL is set in .env.
    base = os.getenv('FLEXPRICE_DASHBOARD_URL')
    return base or None


def credits():
    with store.lock:
        remote = client()
        if remote is None:
            return store.credits.model_copy(update={'source': 'local'}, deep=True)
        try:
            balance = remote.balance(store.founder)
        except (URLError, OSError, ValueError, KeyError, TypeError):
            return store.credits.model_copy(update={'source': UNREACHABLE}, deep=True)
        return Credits(balance=balance, unit='credit', events=list(remote.events.get(store.founder.id, [])),
                       source='flexprice', dashboard_url=dashboard_url(remote, store.founder))


def gate(action, *, draft=False):
    """Meter an attempted action before it runs. Draft handlers debit local memory themselves."""
    with store.lock:
        remote = client()
        if remote is not None:
            try:
                balance = remote.balance(store.founder)
            except (URLError, OSError, ValueError, KeyError, TypeError):
                remote = None  # Flexprice unreachable: fall back to the local counter
        if remote is not None:
            if balance < 1:
                remote.events.setdefault(store.founder.id, []).append(
                    CreditEvent(at=now(), action=action, delta=0, blocked=True))
                store.credit_event(action, 0, True)
                raise HTTPException(402, 'No credits remaining')
            remote.usage(store.founder, event_name(action), action)
            remote.events.setdefault(store.founder.id, []).append(
                CreditEvent(at=now(), action=action, delta=-1, blocked=False))
            # Existing draft handlers still enforce and record their one-credit debit.
            store.credits.balance = balance
            if draft:
                return
            store.credit_event(action, -1)
            return
        if draft:
            return
        if store.credits.balance < 1:
            store.credit_event(action, 0, True)
            raise HTTPException(402, 'No credits remaining')
        store.credit_event(action, -1)

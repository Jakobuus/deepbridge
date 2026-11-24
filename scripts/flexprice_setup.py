#!/usr/bin/env python3
"""Idempotent Flexprice sandbox setup: 3 count meters, 1-credit prices, customers, subscriptions, wallets (5 credits)."""
import datetime
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from flexprice_common import FOUNDERS, METERS, balance, call, load_env

CREDITS = os.environ.get('DEMO_CREDITS', '5')
load_env()


def items(r):
    return r.get('items', r if isinstance(r, list) else [])


# 1. features + meters
features = {}
for name in METERS:
    found = [f for f in items(call('POST', '/features/search', {'lookup_key': name})) if f.get('lookup_key') == name]
    if found:
        f = found[0]
    else:
        f = call('POST', '/features', {'name': name.replace('_', ' ').title(), 'lookup_key': name, 'type': 'metered',
                 'meter': {'name': name, 'event_name': name, 'reset_usage': 'BILLING_PERIOD',
                           'aggregation': {'type': 'COUNT'}}})
    features[name] = f
    print('feature', name, f['id'], 'meter', f.get('meter_id') or (f.get('meter') or {}).get('id'))

# 2. plan
plans = [p for p in items(call('POST', '/plans/search', {'lookup_key': 'deepbridge_credits'}))
         if p.get('lookup_key') == 'deepbridge_credits']
plan = plans[0] if plans else call('POST', '/plans', {'name': 'DeepBridge credits', 'lookup_key': 'deepbridge_credits'})
print('plan', plan['id'])

# 3. 1-credit usage price per meter
for name, f in features.items():
    key = 'deepbridge_' + name
    have = [p for p in items(call('POST', '/prices/search', {'lookup_keys': [key]})) if p.get('lookup_key') == key]
    if have:
        print('price', name, have[0]['id'], 'exists')
        continue
    meter_id = f.get('meter_id') or f['meter']['id']
    p = call('POST', '/prices', {'entity_type': 'PLAN', 'entity_id': plan['id'], 'type': 'USAGE',
             'billing_model': 'FLAT_FEE', 'amount': '1', 'currency': 'usd', 'billing_period': 'MONTHLY', 'billing_period_count': 1,
             'invoice_cadence': 'ARREAR', 'price_unit_type': 'FIAT', 'meter_id': meter_id,
             'lookup_key': key, 'display_name': name})
    print('price', name, p['id'], 'created')

# 4-6. customer, subscription, wallet per founder
from urllib.error import HTTPError
from urllib.parse import quote
for ext, label in FOUNDERS.items():
    try:
        cust = call('GET', '/customers/external/' + quote(ext, safe=''))
    except SystemExit:
        cust = call('POST', '/customers', {'external_id': ext, 'name': label})
    subs = call('POST', '/subscriptions/search', {'customer_id': cust['id']})
    live = [s for s in items(subs) if s.get('plan_id') == plan['id'] and s.get('subscription_status') == 'active']
    if not live:
        call('POST', '/subscriptions', {'customer_id': cust['id'], 'plan_id': plan['id'], 'currency': 'usd',
             'billing_period': 'MONTHLY', 'start_date': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    wallets = [w for w in call('GET', '/customers/' + cust['id'] + '/wallets') if w.get('wallet_status') == 'active']
    if not wallets:
        wallets = [call('POST', '/wallets', {'customer_id': cust['id'], 'currency': 'usd', 'conversion_rate': '1',
                   'initial_credits_to_load': CREDITS, 'wallet_type': 'PRE_PAID'})]
    print('customer', ext, cust['id'], 'sub', 'ok' if live else 'created', 'wallet', wallets[0]['id'],
          'balance', balance(wallets[0]['id']))

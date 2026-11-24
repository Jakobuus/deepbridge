#!/usr/bin/env python3
"""On-camera top-up: python3 scripts/flexprice_topup.py N [founder_id]  (add N credits)
   Reset:             python3 scripts/flexprice_topup.py --set N [founder_id]  (wallet back to exactly N)"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from flexprice_common import FOUNDERS, balance, call, set_balance, wallet_for

args = sys.argv[1:]
if not args:
    raise SystemExit(__doc__)
absolute = args[0] == '--set'
if absolute:
    args = args[1:]
n = float(args[0])
targets = [args[1]] if len(args) > 1 else list(FOUNDERS)
for ext in targets:
    if absolute:
        before, after = set_balance(ext, n)
    else:
        _, w = wallet_for(ext)
        before = balance(w['id'])
        call('POST', f'/wallets/{w["id"]}/top-up', {'credits_to_add': str(n), 'transaction_reason': 'FREE_CREDIT_GRANT',
             'description': 'on-camera top-up'})
        after = balance(w['id'])
    print(f'{ext}: {before:g} -> {after:g} credits')

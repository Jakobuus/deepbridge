#!/usr/bin/env python3
"""Lower Flexprice wallets by real usage events: python3 scripts/flexprice_drain.py --to N [founder_id]"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from flexprice_common import FOUNDERS, set_balance

a = sys.argv[1:]
if len(a) < 2 or a[0] != '--to':
    raise SystemExit(__doc__)
for ext in ([a[2]] if len(a) > 2 else list(FOUNDERS)):
    before, after = set_balance(ext, float(a[1]))
    print(f'{ext}: {before:g} -> {after:g} credits')

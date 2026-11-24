#!/usr/bin/env bash
set -euo pipefail

export BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
python3 - "$@" <<'PY'
import json
import os
import sys
from time import perf_counter
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

if len(sys.argv) > 2:
    raise SystemExit('Usage: kg-check.sh [founder_id]')

url = os.environ['BASE_URL'].rstrip('/') + '/knowledge-graph'
if len(sys.argv) == 2:
    url += '?' + urlencode({'founder_id': sys.argv[1]})

start = perf_counter()
try:
    with urlopen(url, timeout=60) as response:
        graph = json.load(response)
        source = response.headers.get('X-Graph-Data', '')
        notes = response.headers.get('X-Knowledge-Graph-Notes')
except (URLError, ValueError, TimeoutError) as exc:
    raise SystemExit(f'FAIL: GET {url}: {exc}') from None
elapsed_ms = (perf_counter() - start) * 1000

founder = graph['founder']
core = graph['core']
categories = graph['categories']
leads = graph['leads']
evidence = graph['evidence']
edges = core['edges'] + leads['edges']

print(f"GET {url} — {elapsed_ms:.1f} ms ({source or 'source unspecified'})")
print(f"Founder: 1 ({founder['name']})")
print(f"Core: {len(core['value_nodes'])} value nodes, {len(core['edges'])} edges")
print(f"Categories: {len(categories)}")
print(f"Leads: {len(leads['people'])} people, {len(leads['orgs'])} orgs, "
      f"{len(leads['edges'])} edges, {len(leads['paths'])} paths")
print(f"Evidence: {len(evidence)}")
if notes:
    print(notes)

people_ids = {person['id'] for person in leads['people']}
org_ids = {org['id'] for org in leads['orgs']}
category_ids = {category['id'] for category in categories}
value_ids = {node['id'] for node in core['value_nodes']}
node_ids = people_ids | org_ids | category_ids | value_ids | {founder['id']}
lead_edge_ids = {edge['id'] for edge in leads['edges']}
evidence_ids = {item['id'] for item in evidence}
errors = []


def check_refs(owner, field, refs, known):
    for ref in refs:
        if ref not in known:
            errors.append(f'{owner}.{field} references missing {ref!r}')


for item in [founder, *core['value_nodes'], *categories, *edges]:
    check_refs(item['id'], 'evidence_ids', item['evidence_ids'], evidence_ids)
for edge in edges:
    for key in ('from', 'to'):
        check_refs(edge['id'], key, [edge[key]], node_ids)
    if edge['type'] == 'FITS':
        check_refs(edge['id'], 'from', [edge['from']], category_ids)
        check_refs(edge['id'], 'to', [edge['to']], org_ids)
for category in categories:
    check_refs(category['id'], 'org_ids', category['org_ids'], org_ids)
    check_refs(category['id'], 'problem_node_ids', category['problem_node_ids'], value_ids)
for person in leads['people']:
    if person['org_id'] is not None:
        check_refs(person['id'], 'org_id', [person['org_id']], org_ids)
for path in leads['paths']:
    check_refs(path['id'], 'hops', path['hops'], lead_edge_ids)
    check_refs(path['id'], 'weakest_edge_id', [path['weakest_edge_id']], lead_edge_ids)
    check_refs(path['id'], 'founder_id', [path['founder_id']], {founder['id']})
    check_refs(path['id'], 'bridge_id', [path['bridge_id']], people_ids)
    check_refs(path['id'], 'buyer_org_id', [path['buyer_org_id']], org_ids)
    if path['buyer_person_id'] is not None:
        check_refs(path['id'], 'buyer_person_id', [path['buyer_person_id']], people_ids)
    if path['category_id'] is not None:
        check_refs(path['id'], 'category_id', [path['category_id']], category_ids)

if len(evidence) != len(evidence_ids):
    errors.append('Duplicate evidence IDs')
if source == 'Lightmatter fixture replay' and elapsed_ms >= 300:
    errors.append(f'Lightmatter exceeded the 300 ms budget ({elapsed_ms:.1f} ms)')
if errors:
    print('\n'.join(f'FAIL: {error}' for error in errors), file=sys.stderr)
    raise SystemExit(1)
print('PASS: all graph references resolve')
PY

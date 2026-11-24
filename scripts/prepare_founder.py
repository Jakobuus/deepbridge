"""Warm a founder's demo endpoints and record the actual results."""
import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

REPORT = Path(__file__).resolve().parents[1] / 'docs/founders.md'
LAYERS = ('icp', 'buyers', 'graph', 'paths', 'value-map', 'categories', 'knowledge-graph')
COUNT_FIELDS = {
    'icp': ('buyer_roles', 'industries', 'needs', 'expansion_segments'),
    'buyers': ('orgs', 'signals'),
    'graph': ('people', 'orgs', 'edges', 'evidence'),
    'value-map': ('value_nodes', 'edges', 'evidence'),
}


@dataclass
class Result:
    label: str
    elapsed: float
    status: str
    data: dict | list | None
    note: str = ''


def sizes(data, fields):
    return ', '.join(f'{len(data[field])} {field.replace("_", " ")}' for field in fields)


def counts(endpoint, data):
    if endpoint in COUNT_FIELDS:
        return sizes(data, COUNT_FIELDS[endpoint])
    if endpoint == 'knowledge-graph':
        return (f'core has {sizes(data["core"], ("value_nodes", "edges"))}, '
                f'{len(data["categories"])} categories, '
                f'leads have {sizes(data["leads"], ("people", "orgs", "edges", "paths"))}, '
                f'{len(data["evidence"])} evidence')
    if endpoint == 'intake':
        return f'{data["name"]} ({data["id"]}), {sizes(data, ("topics", "evidence_ids"))}'
    if not isinstance(data, list):
        raise TypeError('Expected a list')
    return f'{len(data)} {endpoint}'


def call(base, endpoint, founder_id=None, body=None, path_id=None):
    method = 'POST' if body is not None else 'GET'
    label = f'{method} /{endpoint}' + (f' ({path_id})' if path_id else '')
    suffix = '?' + urlencode({'founder_id': founder_id}) if founder_id else ''
    request = Request(base + '/' + endpoint + suffix, method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type': 'application/json'} if body is not None else {})
    start = time.perf_counter()
    try:
        with urlopen(request, timeout=240) as response:
            data = json.load(response)
            note = counts(endpoint, data)
            headers = response.headers
            provenance = [headers.get(key) for key in (
                'X-Graph-Data', 'X-Graph-Warnings', 'X-Value-Map-Data',
                'X-Categories-Data', 'X-Knowledge-Graph-Notes')]
            result = Result(label, 0, str(response.status), data,
                            ' · '.join(filter(None, [note, *provenance])))
    except HTTPError as exc:
        with exc:
            detail = exc.read(2048).decode(errors='replace').strip()
        try:
            detail = json.loads(detail).get('detail', detail)
        except (ValueError, AttributeError):
            pass
        result = Result(label, 0, str(exc.code), None, str(detail))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        result = Result(label, 0, 'ERROR', None, str(exc))
    result.elapsed = time.perf_counter() - start
    print(f'{result.label} {result.status} {result.elapsed:.3f}s {result.note}', flush=True)
    return result


def cell(value):
    return (str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('|', '&#124;').replace('\r', ' ').replace('\n', ' '))


def path_summary(paths, graph):
    people = {item['id']: item['name'] for item in graph.get('people', [])}
    orgs = {item['id']: item['name'] for item in graph.get('orgs', [])}
    edges = {item['id']: item for item in graph.get('edges', [])}
    evidence = {item['id']: item for item in graph.get('evidence', [])}
    if not paths:
        return ['No paths returned.'], False
    lines = ['| Rank | Bridge | Buyer organization | Evidence URL | Source quote |',
             '| ---: | --- | --- | --- | --- |']
    missing = False
    for rank, path in enumerate(paths[:5], 1):
        bridge = people.get(path['bridge_id'])
        org = orgs.get(path['buyer_org_id'])
        citations = [evidence[eid] for hop in path['hops']
                     for eid in edges.get(hop, {}).get('evidence_ids', []) if eid in evidence]
        source = next((item for item in citations if item.get('quote')
                       and urlsplit(item.get('source_url', '')).scheme in ('http', 'https')), None)
        missing |= not (bridge and org and source)
        link = f'<{source["source_url"].replace("|", "%7C")}>' if source else 'Unavailable'
        quote = cell(source['quote']) if source else 'Unavailable'
        lines.append(f'| {rank} | {cell(bridge or "Unavailable")} | {cell(org or "Unavailable")} | {link} | {quote} |')
    return lines, missing


def write_report(query, founder, results, paths, failure):
    key = hashlib.sha256(query.casefold().encode()).hexdigest()[:16]
    start, end = f'<!-- founder-run {key} -->', f'<!-- /founder-run {key} -->'
    title = cell(founder['name'] if founder else query)
    lines = [start, f'## {title}', '', f'Input `{cell(query)}`. '
             f'{"Incomplete" if failure else "Complete"} in {sum(r.elapsed for r in results):.3f}s.',
             '', '| Request | Status | Time | Counts and notes |', '| --- | --- | ---: | --- |']
    lines.extend(f'| `{cell(r.label)}` | {r.status} | {r.elapsed:.3f}s | {cell(r.note)} |'
                 for r in results)
    lines.extend(['', '### Top paths', '', *paths, '', end])
    section = '\n'.join(lines)
    existing = REPORT.read_text() if REPORT.exists() else (
        '# Demo founder preparation\n\n'
        'Run `scripts/prepare-founder.sh "<name or DOI>"` against the demo API. '
        'The report records the latest run for each input. '
        'Path ranks use the API scores, which are heuristics.\n')
    pattern = re.escape(start) + r'.*?' + re.escape(end)
    if re.search(pattern, existing, flags=re.S):
        updated = re.sub(pattern, lambda _: section, existing, count=1, flags=re.S)
    else:
        updated = existing.rstrip() + '\n\n' + section + '\n'
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=REPORT.parent,
                                     delete=False) as temporary:
        temporary.write(updated)
    temp_path = Path(temporary.name)
    temp_path.chmod(0o644)
    temp_path.replace(REPORT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('query', metavar='NAME_OR_DOI')
    args = parser.parse_args()
    query = args.query.strip()
    if not query:
        parser.error('Provide a founder name or DOI')
    port = os.environ.get('DEMO_PORT', '8000')
    base = os.environ.get('BASE_URL', f'http://127.0.0.1:{port}').rstrip('/')
    intake = call(base, 'intake', body={'query': query})
    results = [intake]
    founder = intake.data
    paths = []
    graph = {}
    drafts = []
    if founder:
        founder_id = founder['id']
        layers = {}
        for endpoint in LAYERS:
            result = call(base, endpoint, founder_id)
            results.append(result)
            layers[endpoint] = result.data
        knowledge = layers['knowledge-graph'] or {}
        graph = layers['graph'] or {**knowledge.get('leads', {}), 'evidence': knowledge.get('evidence', [])}
        paths = sorted(layers['paths'] or [], key=lambda path: (-path['score'], path['id']))
        for path in paths[:3]:
            path_id = path['id']
            result = call(base, 'drafts', founder_id, body={'path_id': path_id}, path_id=path_id)
            results.append(result)
            drafts.append(result.data)
        if len(paths) < 3:
            print(f'ERROR expected three paths for drafts, got {len(paths)}', flush=True)
    top, missing_evidence = path_summary(paths, graph)
    if missing_evidence:
        print('ERROR a top path is missing its bridge, buyer organization, or source', flush=True)
    if any(draft == [] for draft in drafts):
        print('ERROR a draft request returned no drafts', flush=True)
    failure = (any(result.data is None for result in results) or len(paths) < 3
               or missing_evidence or any(not draft for draft in drafts))
    write_report(query, founder, results, top, failure)
    print(f'{"FAIL" if failure else "PASS"} {query}, {sum(r.elapsed for r in results):.3f}s. '
          f'Summary written to {REPORT}', flush=True)
    return int(failure)


if __name__ == '__main__':
    raise SystemExit(main())

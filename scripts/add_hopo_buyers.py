"""Add extra real OpenAlex buyers (companies, agencies, hospitals) to the cached HOPO buyer list.
HACK: score = min(15, 3 * on-topic works found), below every discovered buyer (min 17); topic-works count only."""
import json, os, hashlib, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
for l in (ROOT / '.env').read_text().splitlines():
    if '=' in l and not l.startswith('#'):
        k, v = l.split('=', 1); os.environ.setdefault(k.strip(), v.strip().strip('"\''))
KEY = next((v for k, v in os.environ.items() if k.startswith('OPENALEX') and 'KEY' in k), None)
FID = 'person:openalex:A5043992375'
CACHE = ROOT / 'data/cache/jakob/buyers/ae6d5bcb159c6f29efcf4313.json'
CATS = {
 'radiation': (['medical countermeasures radiological nuclear emergency', 'actinide decorporation DTPA plutonium', 'radiation countermeasure medical countermeasure radionuclide decorporation'], ['I2801182042', 'I4210155143', 'I1293448361', 'I1289490764', 'I4210088792']),
 'pet': (['89Zr immuno-PET zirconium-89 chelator', 'zirconium-89 radiopharmaceutical desferrioxamine'], ['I183934855', 'I133593841', 'I4210147582', 'I186523950', 'I4405257904', 'I25763013']),
 'gd': (['gadolinium retention deposition contrast agent brain', 'gadolinium deposition macrocyclic contrast', 'Removal of gadolinium contrast agent sorbent hemoperfusion'], ['I120615911', 'I4210132761', 'I4210150350', 'I1299303238', 'I30558944', 'I17937529']),
 'lead': (['lead poisoning chelation therapy children succimer', 'childhood lead poisoning chelation DMSA EDTA'], ['I4210136340', 'I1288882113', 'I4210135976', 'I4210104433', 'I1302368450', 'I4210087865', 'I4210150312', 'I1335289525', 'I4210110933', 'I4210106432']),
}
KIND = {'company': 'company', 'government': 'government'}
def q(s):
    p = {'search': s, 'filter': 'from_publication_date:2015-01-01', 'per_page': 50, 'select': 'id,title,publication_date,authorships'}
    p['api_key' if KEY else 'mailto'] = KEY or 'hackathon@example.com'
    return json.load(urllib.request.urlopen('https://api.openalex.org/works?' + urllib.parse.urlencode(p)))['results']
data = json.loads(CACHE.read_text())
now = datetime.now(timezone.utc).isoformat()
orgs = {o['id']: o for o in data['orgs']}
ev = {e['id']: e for e in data['evidence']}
sigs = {s['id']: s for s in data['signals']}
cat_orgs = {}
for cat, (queries, targets) in CATS.items():
    found = {}
    for s in queries:
        for w in q(s):
            for a in w['authorships']:
                for i in a['institutions']:
                    sid = i['id'].rsplit('/', 1)[1]
                    if sid in targets:
                        found.setdefault(sid, {'inst': i, 'works': {}})['works'][w['id']] = w
    for sid in targets:
        if sid not in found: print('MISSING', cat, sid); continue
        inst, works = found[sid]['inst'], sorted(found[sid]['works'].values(), key=lambda w: w.get('publication_date') or '', reverse=True)[:3]
        oid = 'org:openalex:' + sid
        cat_orgs.setdefault(cat, []).append(oid)
        if oid not in orgs:
            orgs[oid] = {'id': oid, 'name': inst['display_name'], 'type': KIND.get(inst.get('type'), 'other'), 'is_buyer': True,
                         'buyer_score': min(15, 3 * len(works)), 'openalex_id': inst['id'], 'category_hint': cat, 'evidence_ids': []}
        eids = []
        for w in works:
            eid = 'evidence:buyers:' + hashlib.sha256((FID + oid + w['id']).encode()).hexdigest()[:20]
            ev[eid] = {'id': eid, 'source_url': w['id'], 'quote': w['title'], 'source_date': w.get('publication_date'), 'observed_at': now, 'kind': 'paper'}
            eids.append(eid)
        orgs[oid]['evidence_ids'] = list(dict.fromkeys(orgs[oid]['evidence_ids'] + eids))
        sid_ = 'signal:buyers:' + hashlib.sha256((FID + oid + cat + 'topic').encode()).hexdigest()[:20]
        sigs[sid_] = {'id': sid_, 'org_id': oid, 'type': 'topic_paper', 'date': works[0].get('publication_date'),
                      'title': f"{len(works)} OpenAlex work(s) on {cat}: {works[0]['title'][:90]}", 'evidence_ids': eids}
        print(cat, oid, inst['display_name'], len(works))
data['orgs'], data['signals'], data['evidence'] = list(orgs.values()), list(sigs.values()), list(ev.values())
CACHE.write_text(json.dumps(data, indent=1))
cf = ROOT / 'fixtures/categories_hopo.json'
cats = json.loads(cf.read_text())
for c in cats:
    cat = c['id'].split(':')[-1]
    cat = {'radiation': 'radiation', 'pet': 'pet', 'gd': 'gd', 'lead': 'lead'}[cat]
    for oid in cat_orgs.get(cat, []):
        if oid not in c['org_ids']: c['org_ids'].append(oid)
        for e in orgs[oid]['evidence_ids']:
            if any(sg['org_id'] == oid and sg['type'] == 'topic_paper' and e in sg['evidence_ids'] for sg in sigs.values()) and e not in c['evidence_ids']:
                c['evidence_ids'].append(e)
cf.write_text(json.dumps(cats, indent=2, ensure_ascii=False))

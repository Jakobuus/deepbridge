#!/usr/bin/env bash
set -euo pipefail
# Run against a freshly started service; this intentionally mutates demo memory.
export BASE_URL="${BASE_URL:-http://localhost:8000}"
python3 - <<'PY'
import json, os, subprocess
base=os.environ['BASE_URL']
def request(method,path,body=None,expected=200):
    cmd=['curl','-sS','--max-time','10','-X',method,base+path,'-w','\n%{http_code}']
    if body is not None: cmd+=['-H','Content-Type: application/json','--data',json.dumps(body)]
    out=subprocess.check_output(cmd,text=True); payload,code=out.rsplit('\n',1)
    print(f'{method} {path} {code}',flush=True)
    assert int(code)==expected,(code,payload)
    return json.loads(payload)
request('GET','/health')
f=request('POST','/intake',{'query':'Nicholas C. Harris'})
for path in ['/icp','/buyers','/graph','/paths','/pipeline','/metrics','/credits','/search?q=Harris']:
    result=request('GET',path)
    if path=='/graph': graph=result
    if path=='/paths': paths=result
request('GET','/evidence/'+graph['evidence'][0]['id'])
request('POST','/name-check',{'edge_id':graph['edges'][0]['id'],'decision':'ok'})
drafts=request('POST','/drafts',{'path_id':paths[0]['id']})
d=drafts[0]
d=request('PUT','/drafts/'+d['id'],{'subject':d['subject'],'body':d['body']+'\nSmoke edit.'})
d=request('POST','/approve',{'draft_id':d['id'],'content_hash':d['content_hash'],'decision':'approve'})
assert d['status']=='approved'
d=request('PUT','/drafts/'+d['id'],{'subject':d['subject']+' updated','body':d['body']})
assert d['status']=='stale'
request('POST','/approve',{'draft_id':d['id'],'content_hash':'wrong-hash','decision':'approve'},409)
request('POST','/approve',{'draft_id':d['id'],'content_hash':d['content_hash'],'decision':'approve'})
cards=request('GET','/pipeline'); card=next(c for c in cards if c['path_id']==d['path_id'])
assert card['stage']=='approved'
request('POST','/pipeline/'+card['id']+'/advance',{'stage':'intro_asked','actor':'Jakob'})
balance=request('GET','/credits')['balance']
for _ in range(int(balance)): request('POST','/drafts',{'path_id':paths[0]['id']})
request('POST','/drafts',{'path_id':paths[0]['id']},402)
metrics=request('GET','/metrics'); assert sum(metrics['per_stage'].values())==len(cards)
print('Smoke passed.')
PY

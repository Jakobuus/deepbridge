"""Band demo: 4 agents review one outreach draft in a real Band room, a human approves.

Scripted and deterministic (no LLM). Real data: the Larsen/Bayer intro draft from our API,
real copy checks from lanes/jakob/draftchecks.py (returned on each draft), real approve endpoint.
Nothing is ever sent to a real person; "approved" only moves the draft/pipeline card in our app.

Run: scripts/band-demo.sh   (stdlib only; reads BAND_* from ../.env)
Band REST: POST {rest}/api/v1/agent/chats/{room}/messages  (X-API-Key = the posting agent's key)
Human approval: the human replies in the room mentioning an agent ("@Security approve").
HACK: REST instead of band-sdk (no listener process needed for a scripted demo).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOUNDER = 'person:openalex:A5043992375'          # Abergel (HOPO)
PATH_ID = 'path:erick:e8691e1d13091477d524'      # Abergel -> Larsen (Bayer) co-author path
ROLES = ['PLANNER', 'BUILDER', 'REVIEWER', 'SECURITY']


def load_env():
    for line in (ROOT / '.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))


def http(method, url, headers=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors='replace')[:300]


class Band:
    def __init__(self):
        self.rest = os.environ.get('BAND_REST_URL', 'https://api.band.ai').rstrip('/')
        self.room = os.environ['BAND_ROOM_ID']
        self.keys = {r: os.environ[f'BAND_{r}_KEY'] for r in ROLES}
        self.ids = {r: os.environ.get(f'BAND_{r}_ID', '') for r in ROLES}
        self.people = {}      # role -> participant dict (id, name, handle)
        self.human = None

    def url(self, tail):
        return f'{self.rest}/api/v1/agent/chats/{self.room}/{tail}'

    def hdr(self, role):
        return {'X-API-Key': self.keys[role]}

    def load_participants(self):
        st, js = http('GET', self.url('participants'), self.hdr('PLANNER'))
        if st != 200:
            sys.exit(f'participants failed {st}: {js}')
        for p in js['data']:
            if p['type'] == 'User':
                if not self.human or p.get('role') == 'owner':
                    self.human = p
                continue
            for r in ROLES:
                if p['id'] == self.ids[r] or r.lower() in (p.get('name') or '').lower():
                    self.people.setdefault(r, p)
        missing = [r for r in ROLES if r not in self.people]
        if missing:
            sys.exit(f'agents not in room: {missing}')
        self.human_id = os.environ.get('BAND_HUMAN_USER_ID') or (self.human or {}).get('id', '')
        if not self.human:
            sys.exit('no human participant in the room')

    def mention(self, who):
        p = self.human if who == 'HUMAN' else self.people[who]
        m = {'id': p['id'], 'name': p.get('name', '')}
        if p.get('handle'):
            m['handle'] = p['handle']
        return m, p

    def say(self, role, text, to):
        """role posts text, @mentioning `to` (agent role or 'HUMAN'). Returns message id."""
        m, p = self.mention(to)
        tag = '@' + (p.get('handle') or p.get('name'))
        body = {'message': {'content': f'{tag} {text}', 'mentions': [m]}}
        st, js = http('POST', self.url('messages'), self.hdr(role), body)
        if st not in (200, 201):
            sys.exit(f'{role} post failed {st}: {js}')
        print(f'[{role.title()}] -> {to.title()}: {text.splitlines()[0][:90]}')
        return (js.get('data') or {}).get('id')

    def attention(self, role, text):
        for base in (self.rest, 'https://app.band.ai'):
            st, _ = http('POST', f'{base}/api/v1/agent/chats/{self.room}/events', self.hdr(role),
                         {'event': {'message_type': 'attention', 'content': text,
                                    'metadata': {'kind': 'review', 'blocking': True}}})
            if st in (200, 201):
                return True
        return False

    def human_reply(self, since_id):
        """Newest human message after `since_id` (as seen by Security and Planner), or None."""
        for role in ('SECURITY', 'PLANNER', 'REVIEWER', 'BUILDER'):
            st, js = http('GET', self.url('messages?status=all&sort_order=desc&limit=20'), self.hdr(role))
            if st != 200:
                continue
            for m in js['data']:                      # newest first
                if m['id'] == since_id:
                    break
                if m.get('sender_type') == 'User' and m.get('message_type', 'text') == 'text' \
                        and (not self.human_id or m['sender_id'] == self.human_id):
                    return m
        return None


def api(method, path, body=None):
    base = os.environ.get('API_URL', 'http://127.0.0.1:8000')
    sep = '&' if '?' in path else '?'
    return http(method, f'{base}{path}{sep}founder_id={urllib.parse.quote(FOUNDER)}', body=body, timeout=60)


def get_draft():
    st, js = api('POST', '/drafts', {'path_id': PATH_ID})
    if st == 200:
        return next(d for d in js if d['kind'] == 'intro_request')
    print(f'API drafts {st}; falling back to fixtures/drafts.json')
    fx = json.loads((ROOT / 'fixtures/drafts.json').read_text())['items']
    return next(d for d in fx if d['kind'] == 'intro_request' and 'e8691e1d' in d['path_id'])


def get_evidence(ids):
    out = []
    for i in ids:
        st, js = api('GET', '/evidence/' + urllib.parse.quote(i, safe=':'))
        if st == 200:
            out.append(js)
    if not out:
        fx = json.loads((ROOT / 'fixtures/evidence.json').read_text())
        items = fx.get('items', fx) if isinstance(fx, dict) else fx
        out = [e for e in items if e['id'] in ids]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeout', type=int, default=900, help='seconds to wait for the human')
    ap.add_argument('--no-wait', action='store_true', help='stop after the approval request')
    a = ap.parse_args()
    load_env()
    band = Band()
    band.load_participants()
    hname = band.human.get('name') or 'Jakob'
    first = hname.split()[0]

    draft = get_draft()
    ev = get_evidence(draft['evidence_ids'])
    print('draft', draft['id'], draft['status'])

    # 1 Planner
    band.say('PLANNER', 'Plan for the HOPO founder (Abergel) -> Bayer intro: warm path Abergel -> Larsen '
             f'(co-author, 2018 Th-227 chelator paper). Draft id {draft["id"]}. '
             'Steps: 1) Builder writes the intro from this path, 2) Reviewer runs our copy checks, '
             '3) Security checks privacy and the send gate, 4) a human approves. Nothing sends without approval. '
             'Builder, please draft the intro from this path.', 'BUILDER')
    time.sleep(1)

    # 2 Builder
    cites = '\n'.join(f'- {e.get("source_url") or "no url"} ({e.get("source_date") or "undated"}): '
                      f'"{(e.get("quote") or "")[:110]}"' for e in ev)
    band.say('BUILDER', f'Draft ready. Subject: {draft["subject"]}\n\n{draft["body"]}\n\nCited sources:\n{cites}\n\n'
             'Reviewer, please check it.', 'REVIEWER')
    time.sleep(1)

    # 3 Reviewer: real checks from draftchecks.py
    checks = draft.get('checks') or []
    lines = '\n'.join(f'{"✓" if c["ok"] else "✗"} {c["name"]}' + ('' if c['ok'] else f' ({c["detail"]})')
                      for c in checks)
    ok = sum(c['ok'] for c in checks)
    verdict = 'All checks pass.' if ok == len(checks) else 'Some checks failed; needs a fix before sending.'
    band.say('REVIEWER', f'Copy review, {ok}/{len(checks)} checks (service/app/lanes/jakob/draftchecks.py):\n{lines}\n'
             f'{verdict} Security, please check privacy and the send gate.', 'SECURITY')
    time.sleep(1)

    # 4 Security
    text = draft['subject'] + '\n' + draft['body']
    private = bool(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d ()-]{8,}\d', text))
    sourced = all((e.get('source_url') or '').startswith('http') for e in ev) and bool(ev)
    sec = (f'{"✗" if private else "✓"} no email address or phone number in the draft\n'
           f'{"✓" if sourced else "✗"} every claim cites a public source URL ({len(ev)} sources)\n'
           f'✓ nothing is sent: status is "{draft["status"]}"; the app only records approval, no email/LinkedIn call exists\n'
           f'✓ send gate: approval needs the human decision on content hash {draft["content_hash"][:10]}')
    request_id = band.say('SECURITY', f'Security review:\n{sec}\n'
                          f'{first}, approve or reject this intro to Larsen (Bayer)? '
                          'Reply here with "@Security approve" or "@Security reject".', 'HUMAN')
    band.attention('SECURITY', f'Approve or reject the Abergel -> Larsen (Bayer) intro draft {draft["id"]}?')
    if a.no_wait:
        print('request posted; not waiting')
        return

    # 5 Human gate
    print(f'waiting up to {a.timeout}s for {hname} to reply in the Band room ...')
    t0 = time.time()
    decision = None
    while time.time() - t0 < a.timeout:
        m = band.human_reply(request_id)
        if m:
            words = m['content'].lower()
            if re.search(r'\b(reject|rejected|deny|no)\b', words):
                decision = 'reject'
            elif re.search(r'\b(approve|approved|yes|ok|lgtm)\b', words):
                decision = 'approve'
            if decision:
                break
        time.sleep(3)
    if not decision:
        band.say('SECURITY', f'No decision from {first} within {a.timeout // 60} min. Draft stays "draft"; nothing sent.', 'PLANNER')
        print('timeout')
        return

    st, js = api('POST', '/approve', {'draft_id': draft['id'], 'content_hash': draft['content_hash'],
                                      'decision': decision})
    if st != 200:
        band.say('SECURITY', f'{decision} recorded in Band but our API refused: {st} {str(js)[:120]}', 'PLANNER')
        sys.exit(f'approve failed {st} {js}')
    if decision == 'approve':
        band.say('PLANNER', f'Approved by {first} -> pipeline updated (draft status: {js["status"]}). '
                 'Nothing was sent to anyone; sending stays a manual step.', 'BUILDER')
    else:
        band.say('PLANNER', f'Rejected by {first}. Draft marked rejected; stopping.', 'BUILDER')
    print('done:', decision, js['status'])


if __name__ == '__main__':
    main()

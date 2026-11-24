"""Band in the approval path: a background 4-agent review per demo draft; the human approves in Band.

Reuses service/band_agents.py (REST client + scripted agents). Non-blocking, silent when BAND_* is missing
or Band is unreachable. Nothing is ever sent to a real person; approval only moves the draft/pipeline card.
"""
import os
import re
import sys
import threading
import time
from pathlib import Path

from .models import CardHistory
from .store import now, store

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # service/ holds band_agents.py
import band_agents as ba  # noqa: E402

HOPO_ID = 'person:openalex:A5043992375'
NEEDED = ['BAND_ROOM_ID', 'BAND_HUMAN_USER_ID'] + [f'BAND_{r}_{k}' for r in ba.ROLES for k in ('ID', 'KEY')]
_active = set()


def enabled():
    return all(os.getenv(k) for k in NEEDED)


def room_url():
    return os.getenv('BAND_ROOM_URL') or None


def _card(draft):
    return next((c for c in store.cards.values() if c.path_id == draft.path_id), None)


def _step(draft, agent, verdict, kind='agent', actor=None):
    """Record a step on the draft review and as an attribution entry on the pipeline card."""
    with store.lock:
        draft.review['steps'].append({'agent': agent, 'verdict': verdict, 'at': now()})
        card = _card(draft)
        if card:
            card.history.append(CardHistory(stage=card.stage, at=now(), actor=actor or f'{agent} (Band)',
                                            actor_kind=kind))


def _status(draft, status):
    with store.lock:
        draft.review['status'] = status


def maybe_start(drafts, founder_id=None):
    """Kick off the review for the demo founder's intro draft. Never raises, never blocks."""
    try:
        selected = founder_id or getattr(store, 'jakob_active_founder_id', None)
        if selected != HOPO_ID or not enabled():
            return
        draft = next((d for d in drafts if d.kind == 'intro_request'), None)
        if draft is None or draft.review is not None or _active:
            return
        draft.review = {'by': 'band', 'room_url': room_url(), 'status': 'in_review', 'steps': []}
        _active.add(draft.id)
        threading.Thread(target=_run, args=(draft,), daemon=True).start()
    except Exception as exc:  # HACK: Band must never break draft creation
        print('band review not started:', type(exc).__name__)


def _run(draft):
    try:
        _review(draft)
    except BaseException as exc:  # band_agents uses sys.exit on API errors; keep the app alive
        print('band review stopped:', type(exc).__name__, str(exc)[:120])
        with store.lock:
            if draft.review and draft.review['status'] == 'in_review':
                draft.review = None  # unreachable Band: behave as if it never started
    finally:
        _active.discard(draft.id)


def _review(draft):
    band = ba.Band()
    band.load_participants()
    first = (band.human.get('name') or 'Jakob').split()[0]
    with store.lock:
        digest = draft.content_hash
        subject, body = draft.subject, draft.body
        checks = list(draft.checks or [])
        ev = [e.model_dump() for i in draft.evidence_ids if (e := store.evidence.get(i))]

    band.say('PLANNER', f'Plan for draft {draft.id} ("{subject}"). Steps: 1) Builder writes the intro from the '
             'warm path, 2) Reviewer runs our copy checks, 3) Security checks privacy and the send gate, '
             '4) a human approves. Nothing sends without approval. Builder, please draft the intro.', 'BUILDER')
    _step(draft, 'Planner', 'plan posted: write, review, security, human approval')
    time.sleep(1)

    cites = '\n'.join(f'- {e.get("source_url") or "no url"} ({e.get("source_date") or "undated"}): '
                      f'"{(e.get("quote") or "")[:110]}"' for e in ev)
    band.say('BUILDER', f'Draft ready. Subject: {subject}\n\n{body}\n\nCited sources:\n{cites}\n\n'
             'Reviewer, please check it.', 'REVIEWER')
    _step(draft, 'Builder', f'draft written, {len(ev)} cited sources')
    time.sleep(1)

    ok = sum(bool(c['ok']) for c in checks)
    lines = '\n'.join(f'{"✓" if c["ok"] else "✗"} {c["name"]}' + ('' if c['ok'] else f' ({c["detail"]})')
                      for c in checks)
    verdict = 'All checks pass.' if ok == len(checks) else 'Some checks failed; needs a fix before sending.'
    band.say('REVIEWER', f'Copy review, {ok}/{len(checks)} checks (draftchecks.py):\n{lines}\n{verdict} '
             'Security, please check privacy and the send gate.', 'SECURITY')
    _step(draft, 'Reviewer', f'{ok}/{len(checks)} checks')
    time.sleep(1)

    private = bool(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d ()-]{8,}\d', subject + '\n' + body))
    sourced = bool(ev) and all((e.get('source_url') or '').startswith('http') for e in ev)
    sec_ok = [not private, sourced, True, True]
    sec = (f'{"✓" if sec_ok[0] else "✗"} no email address or phone number in the draft\n'
           f'{"✓" if sec_ok[1] else "✗"} every claim cites a public source URL ({len(ev)} sources)\n'
           f'✓ nothing is sent: status is "{draft.status}"; the app only records approval\n'
           f'✓ send gate: approval needs the human decision on content hash {digest[:10]}')
    request_id = band.say('SECURITY', f'Security review:\n{sec}\n{first}, approve or reject this intro? '
                          'Reply here with "@Security approve" or "@Security reject".', 'HUMAN')
    after = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - 3))  # Band stamps are UTC ISO
    band.attention('SECURITY', f'Approve or reject draft {draft.id}?')
    _step(draft, 'Security', f'{sum(sec_ok)}/{len(sec_ok)} checks; waiting for {first}')
    _status(draft, 'awaiting_human')

    deadline = time.time() + int(os.getenv('BAND_REVIEW_TIMEOUT', '900'))
    while time.time() < deadline:
        if draft.status != 'draft':  # decided in the app meanwhile
            _status(draft, 'approved' if draft.status == 'approved' else 'rejected')
            band.say('SECURITY', f'Decision made in the DeepBridge app: {draft.status}.', 'PLANNER')
            return
        m = band.human_reply(request_id, after)
        decision = None
        if m:
            words = m['content'].lower()
            if re.search(r'\b(reject|rejected|deny|no)\b', words):
                decision = 'reject'
            elif re.search(r'\b(approve|approved|yes|ok|lgtm)\b', words):
                decision = 'approve'
        if decision:
            if draft.content_hash != digest:
                band.say('SECURITY', 'The draft changed after review; the decision is not applied. Re-review needed.',
                         'PLANNER')
                _status(draft, 'in_review')
                return
            store.approve(draft.id, digest, decision, via='band', actor=f'{first} (Band)')
            done = 'approved' if decision == 'approve' else 'rejected'
            _status(draft, done)
            _step(draft, first, f'{done} in Band', kind='human', actor=f'{first} (Band)')
            band.say('PLANNER', f'{done.title()} by {first} -> pipeline updated (draft status: {draft.status}). '
                     'Nothing was sent to anyone; sending stays a manual step.', 'BUILDER')
            return
        time.sleep(3)
    band.say('SECURITY', 'No decision in time. Draft stays "draft"; nothing sent.', 'PLANNER')

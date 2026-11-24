"""Per-process demo memory; restarting restores cached fixtures."""
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path as FilePath
from threading import RLock
from fastapi import HTTPException
from .models import (Approval, Card, CardHistory, CreditEvent, Credits, Draft, Edge,
                     Evidence, Founder, Icp, Metrics, Org, Path, Person, Signal, STAGES)

FIXTURES = FilePath(__file__).resolve().parents[2] / 'fixtures'

def now():
    return datetime.now(timezone.utc).isoformat()

def content_hash(subject: str, body: str) -> str:
    return hashlib.sha256((subject + '\n' + body).encode('utf-8')).hexdigest()

class Store:
    def __init__(self):
        self.lock = RLock()

    def load(self):
        with self.lock:
            self.metadata = {}
            def read(name):
                data = json.loads((FIXTURES / f'{name}.json').read_text())
                self.metadata[name] = data.pop('_meta', {}) if isinstance(data, dict) else {}
                return data['items'] if isinstance(data, dict) and 'items' in data else data
            self.founder = Founder.model_validate(read('founder'))
            self.icp = Icp.model_validate(read('icp'))
            self.credits = Credits.model_validate(read('credits'))
            for name, model in [('orgs', Org), ('people', Person), ('edges', Edge),
                                ('evidence', Evidence), ('paths', Path), ('signals', Signal),
                                ('drafts', Draft), ('cards', Card)]:
                setattr(self, name, {item['id']: model.model_validate(item) for item in read(name)})
            for draft in self.drafts.values():
                if draft.content_hash != content_hash(draft.subject, draft.body):
                    raise ValueError(f'Fixture hash mismatch: {draft.id}')
            self.draft_templates = [d.model_copy(deep=True) for d in self.drafts.values()]
            self.approvals: list[Approval] = []

    def get(self, collection, id):
        item = getattr(self, collection).get(id)
        if item is None:
            raise HTTPException(404, f'{collection}: {id} not found')
        return item

    def check_founder(self, founder_id=None):
        if founder_id is not None and founder_id != self.founder.id:
            raise HTTPException(404, 'Founder not in cached demo')

    def update_name_check(self, edge_id, decision):
        with self.lock:
            edge = self.get('edges', edge_id)
            edge.name_check = decision
            return edge

    def credit_event(self, action, delta, blocked=False):
        self.credits.events.append(CreditEvent(at=now(), action=action, delta=delta, blocked=blocked))
        if not blocked:
            self.credits.balance += delta

    def add_or_replace_draft(self, draft):
        with self.lock:
            draft.content_hash = content_hash(draft.subject, draft.body)
            self.drafts[draft.id] = draft
            return draft

    def generate_drafts(self, path_id):
        with self.lock:
            self.get('paths', path_id)
            templates = [d for d in self.draft_templates if d.path_id == path_id]
            if not templates:
                raise HTTPException(404, 'No cached drafts for this path')
            if self.credits.balance < 1:
                self.credit_event('drafts:' + path_id, 0, True)
                raise HTTPException(402, 'No credits remaining')
            self.credit_event('drafts:' + path_id, -1)
            # Repeated requests preserve edits and approvals of existing drafts.
            drafts = [self.drafts.get(d.id) or self.add_or_replace_draft(d.model_copy(deep=True)) for d in templates]
            card = next((c for c in self.cards.values() if c.path_id == path_id), None)
            if card and STAGES.index(card.stage) < STAGES.index('draft'):
                self.advance_card(card.id, 'draft', 'Draft agent', 'agent')
            return drafts

    def edit_draft(self, id, subject, body):
        with self.lock:
            draft = self.get('drafts', id)
            new_hash = content_hash(subject, body)
            if draft.status == 'approved':
                draft.status = 'stale'
            draft.subject, draft.body, draft.content_hash = subject, body, new_hash
            return draft

    def approve(self, draft_id, digest, decision):
        with self.lock:
            draft = self.get('drafts', draft_id)
            if digest != draft.content_hash:
                raise HTTPException(409, 'Draft changed; review the current content hash')
            self.approvals.append(Approval(draft_id=draft.id, content_hash=digest,
                                           decision=decision, by='Jakob', at=now()))
            draft.status = 'approved' if decision == 'approve' else 'rejected'
            if decision == 'approve':
                card = next((c for c in self.cards.values() if c.path_id == draft.path_id), None)
                if card and STAGES.index(card.stage) < STAGES.index('approved'):
                    self.advance_card(card.id, 'approved', 'Jakob')
            return draft

    def advance_card(self, card_id, stage, actor, actor_kind='human'):
        with self.lock:
            card = self.get('cards', card_id)
            if STAGES.index(stage) < STAGES.index(card.stage):
                raise HTTPException(409, 'Card stage cannot move backwards')
            if stage != card.stage:
                card.stage = stage
                card.history.append(CardHistory(stage=stage, at=now(), actor=actor, actor_kind=actor_kind))
            return card

    def metrics(self):
        with self.lock:
            counts = Counter(c.stage for c in self.cards.values())
            reached = {s: sum(n for stage, n in counts.items() if STAGES.index(stage) >= i)
                       for i, s in enumerate(STAGES)}
            actors = Counter((h.actor, h.actor_kind) for c in self.cards.values() for h in c.history)
            kinds = sorted({p.kind for p in self.paths.values()})
            return Metrics.model_validate(dict(
                per_stage={s: counts[s] for s in STAGES},
                conversion=[{'from': a, 'to': b, 'rate': reached[b] / reached[a] if reached[a] else 0}
                            for a, b in zip(STAGES, STAGES[1:])],
                by_path_kind=[dict(kind=k, count=sum(p.kind == k for p in self.paths.values()),
                                   approved=sum(self.paths[c.path_id].kind == k and STAGES.index(c.stage) >= 3
                                                for c in self.cards.values())) for k in kinds],
                by_actor=[dict(actor=a, actor_kind=k, actions=n) for (a, k), n in sorted(actors.items())]))

store = Store()

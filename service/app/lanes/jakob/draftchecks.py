"""Deterministic checks for draft copy and its cited evidence."""
import re
from collections.abc import Iterable
from typing import TypedDict

from ...models import Draft, Edge, Evidence, Path
from ...store import store

BANNED = (
    'revolutionize',
    'drive growth',
    'great work',
    'great job',
    'kudos',
    'congrats',
    'deeper insights',
    'made easy',
    'shows the impact',
    'boost your',
    'revolutionizing',
    'game-changer',
    'game changer',
    'unlock',
    'unleash',
    'supercharge',
    'seamless',
    'seamlessly',
    'cutting-edge',
    'cutting edge',
    'state-of-the-art',
    'next-level',
    'next level',
    'synergy',
    'leverage',
    'empower',
    'elevate',
    'in today’s',
    "in today's",
    'fast-paced',
    'look no further',
    'take it to the next',
    'harness the power',
    'delve',
    'tapestry',
    'landscape',
    'world-class',
    'best-in-class',
    'robust',
    'holistic',
    'transformative',
    'innovative',
    'amazing',
    'incredible',
    'impressive',
    'love what you',
    'huge fan',
    'i hope this',
    'just wanted to',
    'reach out',
    'touch base',
    'circle back',
    'quick question',
    'excited to',
    'thrilled',
    'passionate',
)

BEGGING = (
    'refer me',
    'referral',
    'any openings',
    'any opportunities',
    'grateful if you could',
    "I'd be grateful if you",
    'would mean the world',
    'pass my resume',
    'pick your brain',
    'just checking in',
    'desperate',
    'please consider me',
    'sorry to bother',
)

WORD_LIMITS = {'intro_request': 110, 'forwardable_note': 70, 'direct_fallback': 120}
BLURB = 'Blurb you can forward:'
NUMBER = re.compile(r'\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[%×]|x\b|[km]\b)?', re.I)
URL = re.compile(r'\b(?:https?://|www\.)\S+', re.I)
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”')
EMOJI = re.compile(
    '[\U0001f170-\U0001f251\U0001f300-\U0001faff\u2600-\u26ff\u2700-\u27bf'
    '\u231a\u231b\u23e9-\u23f3\u23f8-\u23fa\u24c2\u2b05-\u2b07\u2b1b\u2b1c'
    '\u2b50\u2b55\u3030\u303d\u3297\u3299\ufe0f\u20e3]'
)
WAY_OUT = re.compile(
    r"\b(?:no (?:pressure|worries|problem|obligation|need to (?:reply|respond|forward)|(?:is|would be) (?:completely |totally )?fine)"
    r"|declin\w* is (?:completely |totally )?(?:fine|okay|ok)"
    r"|(?:fine|okay|ok|free) to (?:decline|pass|say no|skip)"
    r"|(?:fine|happy|okay) (?:for you )?to (?:hear|say) no"
    r"|(?:feel free to|you can) (?:say no|decline|pass|skip|ignore)"
    r"|(?:okay|ok|fine) if (?:not|you(?:'d| would) rather not)"
    r"|no (?:is |would be )?(?:(?:completely|totally|absolutely) )?(?:fine|okay|ok)"
    r"|if (?:it(?:'s| is)|this (?:is|isn't)|the timing(?:'s| is)) (?:not |a )?(?:a fit|relevant|bad time|right),? (?:feel free|please feel free|happy|no))\b",
    re.I,
)
GENERIC_NOUNS = set(
    'homepage site website post posts blog changelog docs team product work customer customers '
    'podcast newsletter page latest recent newer new own question time thoughts notes engineering '
    'roadmap launch way approach take view side paper publication affiliation affiliations'.split()
)
STOP_WORDS = set(
    'the and for with that this from into have has its their they them than what when which who '
    'will just about over more most only also like now or but so if is are was were be been to of '
    'in on at by as it a an do does did'.split()
)
INSTITUTION = re.compile(
    r'[^,:;"\[\]()]*\b(?:laborator(?:y|ies)|labs?|university|institute|department|centre|center)\b'
    r'[^,:;"\[\]()]*', re.I,
)
CHECK_PUNCTUATION = str.maketrans({'‘': "'", '’': "'", '‐': '-', '‑': '-', '‒': '-'})


class Check(TypedDict):
    name: str
    ok: bool
    detail: str


class CheckedDraft(Draft):
    checks: list[Check]


def shared_work_urls(path: Path, edges: Iterable[Edge], evidence: Iterable[Evidence]) -> set[str]:
    ids = {evidence_id for edge in edges
           if edge.id in path.hops and edge.type in {'LAB_MATE', 'CO_AUTHORED'}
           and {edge.from_, edge.to} == {path.founder_id, path.bridge_id}
           for evidence_id in edge.evidence_ids}
    return {source.source_url for source in evidence if source.id in ids and source.source_url}


def passed(checks: Iterable[Check]) -> bool:
    return all(check['ok'] for check in checks)


def _normalize(text: str) -> str:
    return ' '.join(text.translate(CHECK_PUNCTUATION).casefold().split())


def _names(text: str, name: str) -> bool:
    return bool(name and re.search(rf'(?<!\w){re.escape(_normalize(name))}(?!\w)', text))


def _numbers(text: str) -> list[str]:
    return [re.sub(r'[,\s]', '', n).lower().replace('×', 'x') for n in NUMBER.findall(text)]


def repeated_numbers(text: str) -> list[str]:
    repeated = {}
    for sentence in re.split(r'(?<=[.?!])\s+|\n+', text):
        seen = set()
        pairs = set()
        previous = None
        for match in re.findall(r'\d+(?:[.,]\d+)*', sentence):
            number = match.replace(',', '')
            if number in seen and ('→' in sentence or '->' in sentence):
                repeated[number] = None
            seen.add(number)
            if previous is not None and previous != number:
                pair = (previous, number)
                if pair in pairs:
                    repeated.update(dict.fromkeys(pair))
                pairs.add(pair)
            previous = number
    return list(repeated)


def _feature_words(text: str) -> set[str]:
    text = re.sub(r"(?:'s|-affiliated)\b", '', _normalize(text))
    words = re.sub(r'[^\w\s-]', ' ', text).split()
    return {re.sub(r'(?<=[a-z]{3})(es|s)$', '', word)
            for word in words if len(word) >= 3 and word not in STOP_WORDS}


def made_up_features(text: str, company: str, quotes: str) -> list[str]:
    owners = ['your']
    if company:
        owners.extend(re.escape(name) + "'s" for name in dict.fromkeys(
            (_normalize(company), _normalize(company).split()[0])))
    refs = re.compile(rf"\b(?:{'|'.join(owners)})\s+([a-z][\w-]*(?:[ \t]+[a-z][\w-]*){{0,2}})", re.I)
    known = _feature_words(quotes)
    invented = []
    for match in refs.finditer(QUOTED.sub(' ', text.translate(CHECK_PUNCTUATION))):
        words = []
        for word in match[1].split():
            lower = word.lower()
            if lower in STOP_WORDS or (words and lower.endswith(('ing', 'ed', 'ly'))):
                break
            words.append(word)
            if lower in GENERIC_NOUNS or re.search(r'[^s]s$', lower):
                break
        telling = ' '.join(word for word in words
                           if word.lower() not in GENERIC_NOUNS | {'published', 'listed', 'documented'})
        if _feature_words(telling) - known:
            owner = match[0][:-len(match[1])].strip()
            invented.append(' '.join([owner, *words]))
    return list(dict.fromkeys(invented))


def _shared_names(evidence: Iterable[Evidence]) -> set[str]:
    names = set()
    for source in evidence:
        if source.kind != 'paper':
            continue
        title = re.search(r'(?:^|;\s*)title:\s*([^;]+)', source.quote, re.I)
        if title:
            names.add(title[1].strip())
        elif ':' not in source.quote:
            names.add(source.quote.strip())
        affiliation = re.split(r'raw_affiliation_strings:\s*', source.quote, maxsplit=1, flags=re.I)
        text = affiliation[-1]
        for match in INSTITUTION.finditer(text):
            name = match[0].strip()
            words = re.findall(r'[A-Za-z]+', name)
            if len(words) < 2:
                continue
            names.add(name)
            acronym = ''.join(word[0] for word in words if word.lower() not in {'of', 'and', 'the'})
            if len(acronym) >= 3:
                names.add(acronym)
        if len(affiliation) > 1:
            names.update(set(re.findall(r'\b[A-Z]{3,6}\b', text)) - {'USA'})
    return names


def _sentence_count(body: str) -> int:
    body = re.sub(r'\b(?:[A-Z]|Dr|Mr|Mrs|Ms|Prof)\.(?=\s)', '', body.strip())
    sentences = re.split(r"""[.!?]+["”')\]]*(?:\s+|$)""", body)
    return len([sentence for sentence in sentences if sentence.strip()])


def check_draft(draft: Draft, evidence: Iterable[Evidence], *, buyer_org: str | None = None,
                bridge_work_urls: set[str] | None = None) -> list[Check]:
    """Check the copy using only evidence attached to this draft."""
    evidence = list(evidence)
    sources = [e for e in evidence if e.id in draft.evidence_ids and e.source_url and e.quote]
    path = getattr(store, 'paths', {}).get(draft.path_id)
    if buyer_org is None:
        org = store.orgs.get(path.buyer_org_id) if path else None
        buyer_org = org.name if org else ''
    quotes = '\n'.join(e.quote for e in sources)
    body = draft.body
    full = f'{draft.subject}\n{body}'
    lower = _normalize(full)
    claims = URL.sub(' ', full)
    known_numbers = set(_numbers(quotes + '\n' + '\n'.join(e.source_date or '' for e in sources)))  # HACK: source dates count as cited
    missing = list(dict.fromkeys(n for n in _numbers(claims) if n not in known_numbers))
    repeated = repeated_numbers(claims)
    invented = made_up_features(full, buyer_org, quotes)
    banned = next((phrase for phrase in BANNED if _normalize(phrase) in lower), '')
    begging = next((phrase for phrase in BEGGING
                    if re.search(rf"(?<![\w']){re.escape(_normalize(phrase))}(?![\w'])", lower)), '')
    checks: list[Check] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({'name': name, 'ok': ok, 'detail': '' if ok else detail})

    words = len(body.split())
    limit = WORD_LIMITS[draft.kind]
    add('length', words <= limit, f'{words} words, maximum {limit}')
    add('grounded', not missing, 'Numbers missing from cited quotes: ' + ', '.join(missing))
    add('no_repeated_numbers', not repeated, 'Numbers repeated in one sentence: ' + ', '.join(repeated))
    add('no_made_up_features', not invented, 'Features missing from cited quotes: ' + ', '.join(invented))
    add('banned', not banned, f'Uses "{banned}"')
    add('no_begging', not begging, f'Uses "{begging}"')
    add('no_exclamation', '!' not in full, 'Uses an exclamation mark')
    add('no_emoji', not EMOJI.search(full), 'Uses emoji')
    add('no_knows', not _names(lower, 'knows'), 'Uses the word "knows"')

    if draft.kind == 'forwardable_note':
        add('two_sentences', _sentence_count(body) == 2 and bool(re.search(r"""[.!?]["”')\]]*$""", body.strip())),
            'Write exactly two complete sentences')
        add('no_question_marks', '?' not in full, 'Uses a question mark')
        add('no_first_person_i', not _names(lower, 'i'), 'Uses the first-person pronoun "I"')
    else:
        add('one_ask', body.count('?') == 1, f'Expected one question mark in the body, found {body.count("?")}')
        if draft.kind == 'intro_request':
            intro = _normalize(body.partition(BLURB)[0])
            if bridge_work_urls is None and path:
                bridge_work_urls = shared_work_urls(path, store.edges.values(), evidence)
            shared = [e for e in sources if bridge_work_urls is None or e.source_url in bridge_work_urls]
            add('names_shared_paper_or_lab', any(_names(intro, name) for name in _shared_names(shared)),
                'Name the bridge’s cited shared paper or lab in the intro')
            add('way_out', bool(WAY_OUT.search(intro)), 'Give the bridge explicit permission to decline')
        else:
            add('names_buyer_org', _names(lower, buyer_org), f'Name the buyer org ({buyer_org or "unavailable"})')
    return checks

"""Offline behavior checks; run: uv run python -m unittest app.lanes.erick.test_graph."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.lanes.erick import build, pull
from app.lanes.erick.paths import find_paths

MIT = {'id': 'https://openalex.org/I1', 'display_name': 'MIT', 'type': 'education'}
CO = {'id': 'https://openalex.org/I2', 'display_name': 'Example Semiconductor', 'type': 'company'}
OTHER = {'id': 'https://openalex.org/I3', 'display_name': 'Other University', 'type': 'education'}


def author(aid, name, institutions):
    return {'author': {'id': 'https://openalex.org/' + aid, 'display_name': name},
            'institutions': institutions, 'raw_affiliation_strings': [i['display_name'] for i in institutions]}


def work(wid, date, authors, **extra):
    return {'id': 'https://openalex.org/' + wid, 'title': 'Measured battery performance',
            'publication_date': date, 'authorships': authors, 'topics': [], **extra}


class ComputedGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name)
        self.patch = patch.object(pull, 'CACHE', self.cache)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.shared = work('W1', '2020-05-01', [author('A1', 'Founder', [MIT]), author('A2', 'Bridge', [MIT])])
        self.later = work('W2', '2025-06-01', [author('A2', 'Bridge', [MIT, CO])])
        self.dataset = {'founder': {'id': 'https://openalex.org/A1', 'display_name': 'Founder'},
                        'works': [self.shared], 'coauthor_works': [self.later],
                        'profiles': {'https://openalex.org/A2': {'id': 'https://openalex.org/A2',
                            'display_name': 'Bridge', 'affiliations': [{'institution': MIT, 'years': [2020]},
                                                                     {'institution': CO, 'years': [2025]}]}},
                        'citing_works': [], 'advisor_works': [], 'topic_works': [],
                        'observed_at': '2026-11-24T00:00:00Z', 'warnings': [], 'cached': True}

    def graph(self):
        with patch.object(pull, 'load_dataset', return_value=self.dataset):
            return build.build_graph('person:openalex:A1')

    def test_shared_university_and_later_company_produce_evidenced_paths(self):
        people, orgs, edges, evidence = self.graph()
        self.assertTrue(any(e.type == 'LAB_MATE' for e in edges))
        self.assertTrue(any(e.type == 'DUAL_AFFILIATION' for e in edges))
        self.assertTrue(all(e.evidence_ids and set(e.evidence_ids) <= {v.id for v in evidence} for e in edges))
        with patch('app.lanes.erick.paths.build_graph', return_value=(people, orgs, edges, evidence)):
            paths = find_paths('person:openalex:A1', ['org:openalex:I2'])
        self.assertTrue(paths)
        by_id = {e.id: e for e in edges}
        for path in paths:
            node = 'person:openalex:A1'
            for eid in path.hops:
                self.assertEqual(by_id[eid].from_, node)
                node = by_id[eid].to
            self.assertEqual(node, 'org:openalex:I2')
            self.assertIn(path.weakest_edge_id, path.hops)
            self.assertGreater(path.score, 0)

    def test_homonym_affiliation_mismatch_is_low_confidence(self):
        self.dataset['profiles']['https://openalex.org/A2']['affiliations'] = [{'institution': OTHER, 'years': [2020]}]
        _, _, edges, _ = self.graph()
        relationships = [e for e in edges if e.to == 'person:openalex:A2']
        self.assertTrue(relationships)
        self.assertTrue(all(e.confidence < .5 and e.name_check == 'unchecked' for e in relationships))

    def test_rejected_edges_never_make_paths(self):
        graph = self.graph()
        for edge in graph[2]:
            if edge.to == 'person:openalex:A2':
                edge.name_check = 'rejected'
        with patch('app.lanes.erick.paths.build_graph', return_value=graph):
            self.assertEqual(find_paths('person:openalex:A1', ['org:openalex:I2']), [])

    def test_profile_affiliations_keep_year_without_inventing_exact_date(self):
        self.dataset['coauthor_works'] = []
        _, _, edges, evidence = self.graph()
        affiliation = next(e for e in edges if e.to == 'org:openalex:I2')
        self.assertIsNone(affiliation.date)
        self.assertIn('as of 2025', affiliation.label)
        self.assertLess(affiliation.confidence, .5)

    def test_unknown_buyer_does_not_return_other_orgs(self):
        with patch('app.lanes.erick.paths.build_graph', return_value=self.graph()):
            self.assertEqual(find_paths('person:openalex:A1', ['org:missing']), [])

    def test_human_name_check_persists_after_rebuild_and_excludes_path(self):
        from app.models import NameCheckRequest
        from app.routers.graph import name_check
        first = self.graph()
        rejected = next(e for e in first[2] if e.type == 'LAB_MATE')
        name_check(NameCheckRequest(edge_id=rejected.id, decision='rejected'))
        self.addCleanup(build.NAME_CHECKS.pop, rejected.id, None)
        rebuilt = self.graph()
        self.assertEqual(next(e for e in rebuilt[2] if e.id == rejected.id).name_check, 'rejected')
        with patch('app.lanes.erick.paths.build_graph', return_value=rebuilt):
            self.assertTrue(all(rejected.id not in p.hops for p in find_paths('person:openalex:A1')))

    def test_canonical_founder_alias_keeps_lightmatter_fixture_response(self):
        from fastapi import Response
        from app.routers.graph import graph
        from app.store import store
        store.load()
        with patch.object(pull, 'load_dataset', side_effect=AssertionError('fixture must not compute')):
            result = graph(Response(), 'a5102978866')
        self.assertEqual({e.id for e in result['edges']}, set(store.edges))

    def test_explicit_seed_works_are_fetched_without_list_query_budget(self):
        directory = self.cache / 'A1'
        directory.mkdir()
        (directory / 'seed.json').write_text(json.dumps({'work_ids': ['W1']}))
        with patch.object(pull, 'ROOT', self.cache), patch.object(pull, 'request', return_value=self.shared):
            self.assertEqual([x['id'] for x in pull._seed_works('A1')], ['https://openalex.org/W1'])

    def test_seed_works_ignores_openalex_null_author_ids(self):
        directory = self.cache / 'data/cache/jakob/founders'
        directory.mkdir(parents=True)
        w = dict(self.shared)
        w['authorships'] = [{'author': {'id': None}}, author('A1', 'Founder', [MIT])]
        (directory / 'seed.json').write_text(json.dumps({'works': [w]}))
        with patch.object(pull, 'ROOT', self.cache):
            self.assertEqual([x['id'] for x in pull._seed_works('A1')], ['https://openalex.org/W1'])

    def test_cached_request_never_needs_network_or_key(self):
        with patch.dict('os.environ', {'OPENALEX_API_KEY': 'secret-one'}):
            with patch.object(pull, 'urlopen') as network:
                network.return_value.__enter__.return_value.read.return_value = b'{"id":"https://openalex.org/A1"}'
                pull.request('authors/A1')
        with patch.dict('os.environ', {'OPENALEX_API_KEY': 'secret-two'}):
            with patch.object(pull, 'urlopen', side_effect=AssertionError('must use cache')):
                self.assertEqual(pull.request('authors/A1')['id'], 'https://openalex.org/A1')
        self.assertNotIn('secret-one', ''.join(p.read_text() for p in self.cache.rglob('*.json')))

    def test_budget_error_is_clear_and_does_not_cache_error_payload(self):
        from urllib.error import HTTPError
        with patch.object(pull, 'urlopen', side_effect=HTTPError('url', 429, 'budget', {}, None)):
            with self.assertRaisesRegex(pull.OpenAlexUnavailable, 'budget.*OPENALEX_API_KEY'):
                pull.request('works', {'filter': 'author.id:A1'})
        self.assertEqual(list(self.cache.rglob('*.json')), [])


if __name__ == '__main__':
    unittest.main()

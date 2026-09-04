"""Offline regression tests. Every database and source file is disposable."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / 'scripts'))
from app.models.db import (
    get_engine, init_db, get_session_factory, Transaction, SourceType, TxnStatus,
    Match, MatchType, MatchStatus, MatchTransaction, Exception_, ExceptionStatus,
    ExceptionCategory, AuditLog, User, TxnRole,
)
from app.services.ingestion import parse_ledger_amount, parse_bank_amount, ingest_all
from app.services.matching import run_matching, persist_group_result, build_groups
from app.services.verification import verify_group, RULE_VERSION
from app.services.evaluation import evaluate
from app.services.metrics import calculate_metrics
from app.services import ai_reasoning
from generate_synthetic_data import Generator, fmt_ledger_amount
from run_pipeline import run
from prepare_showcase import add_showcase_cases, attach_reconciled_entities
from fastapi.testclient import TestClient
from pydantic import ValidationError

# Import API with a disposable path, never the user's working database.
API_TEMP = TemporaryDirectory()
with patch.dict(os.environ, {'RECON_DATA_DIR': API_TEMP.name, 'RECON_DB_PATH': str(Path(API_TEMP.name) / 'api.db')}):
    from app import main as api


def group(number=1, amount=10000):
    now = datetime(2026, 6, 1)
    ref = f'LEDG-{number:06d}'
    return {
        'ledger': [Transaction(source_type=SourceType.LEDGER, external_ref=ref,
            amount_minor_units=amount, currency='INR', timestamp_utc=now,
            status=TxnStatus.CAPTURED, raw_payload={'refund_amount_paise': 0})],
        'settlement': [Transaction(source_type=SourceType.SETTLEMENT, external_ref=f'SETT-{number:06d}',
            amount_minor_units=amount - 236, currency='INR', timestamp_utc=now + timedelta(days=1),
            status=TxnStatus.CAPTURED, raw_payload={'payment_ref': ref, 'gross_amount_paise': amount,
                                                 'fee_paise': 200, 'gst_paise': 36})],
        'bank': [Transaction(source_type=SourceType.BANK, external_ref=f'BANK-{number:06d}',
            amount_minor_units=amount - 236, currency='INR', timestamp_utc=now + timedelta(days=1),
            status=TxnStatus.CAPTURED, raw_payload={'description': ref})],
    }


def truth(groups):
    return [dict(event_id=f'test-{i}', event_type='fee_gst', expected_resolution='auto_match',
                 notes='', **{f'{source}_refs': [t.external_ref for t in rows] for source, rows in item.items()})
            for i, item in enumerate(groups)]


class ArithmeticTests(unittest.TestCase):
    def test_exact_paise_parsing(self):
        self.assertEqual(parse_ledger_amount('1,234.57 INR'), 123457)
        self.assertEqual(parse_ledger_amount('-0.01'), -1)
        self.assertEqual(parse_ledger_amount('90071992547409.93'), 9007199254740993)
        self.assertEqual(parse_bank_amount('123457'), 123457)
        for invalid in ['NaN', 'Infinity', '0.001', 'hello']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_ledger_amount(invalid)

    def test_generator_does_not_round_away_paise(self):
        for style in range(3):
            self.assertEqual(parse_ledger_amount(fmt_ledger_amount(123457, style)), 123457)

    def test_fee_gst_each_leg_is_verified(self):
        rows = group()
        proof = verify_group(rows)
        self.assertEqual(proof['outcome'], 'match')
        self.assertEqual(proof['explanation']['expected_settlement'], 9764)
        rows['ledger'][0].amount_minor_units += 50
        self.assertEqual(verify_group(rows)['category'], ExceptionCategory.AMOUNT_DISCREPANCY)

    def test_opposing_row_errors_cannot_cancel(self):
        rows, more = group(), group(2)
        rows['ledger'] += more['ledger']
        rows['settlement'] += more['settlement']
        rows['bank'][0].amount_minor_units *= 2
        rows['settlement'][0].amount_minor_units += 50
        rows['settlement'][1].amount_minor_units -= 50
        self.assertEqual(verify_group(rows)['category'], ExceptionCategory.AMOUNT_DISCREPANCY)

    def test_rounding_and_end_to_end_bound(self):
        rows = group()
        rows['bank'][0].amount_minor_units += 5
        self.assertEqual(verify_group(rows)['match_type'], MatchType.FUZZY)
        rows['settlement'][0].amount_minor_units += 5
        rows['bank'][0].amount_minor_units += 5
        self.assertEqual(verify_group(rows)['outcome'], 'exception')

    def test_refund_needs_merchant_evidence(self):
        rows = group()
        rows['ledger'][0].status = TxnStatus.PARTIALLY_REFUNDED
        rows['ledger'][0].raw_payload = {}
        self.assertEqual(verify_group(rows)['category'], ExceptionCategory.REFUND_MISMATCH)

    def test_currency_lifecycle_and_malformed_evidence(self):
        for kind in ['currency', 'failed', 'negative_fee', 'fractional_fee', 'missing_gross', 'zero_partial_refund']:
            rows = group()
            if kind == 'currency': rows['bank'][0].currency = 'USD'
            elif kind == 'failed': rows['ledger'][0].status = TxnStatus.FAILED
            elif kind == 'negative_fee': rows['settlement'][0].raw_payload['fee_paise'] = -200
            elif kind == 'fractional_fee': rows['settlement'][0].raw_payload['fee_paise'] = 200.9
            elif kind == 'missing_gross': del rows['settlement'][0].raw_payload['gross_amount_paise']
            else: rows['ledger'][0].status = TxnStatus.PARTIALLY_REFUNDED
            with self.subTest(kind=kind): self.assertEqual(verify_group(rows)['outcome'], 'exception')

    def test_duplicate_bank_posting_is_not_silently_removed(self):
        rows = group()
        rows['bank'].append(group(2)['bank'][0])
        self.assertEqual(verify_group(rows)['category'], ExceptionCategory.DUPLICATE)

    def test_backwards_timing_is_exception(self):
        rows = group()
        rows['bank'][0].timestamp_utc -= timedelta(days=2)
        self.assertEqual(verify_group(rows)['category'], ExceptionCategory.TIMING_DISCREPANCY)

    def test_ai_schema_rejects_invalid_confidence(self):
        for value in [-.01, 1.01]:
            with self.assertRaises(ValidationError):
                ai_reasoning.AIHypothesis(resolved=True, confidence=value, explanation='test', evidence_fields_used=[])


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.engine = get_engine('sqlite:///' + str(self.path / 'test.db'))
        init_db(self.engine)
        self.factory = get_session_factory(self.engine)
        self.session = self.factory()
        def get_db():
            with self.factory() as session: yield session
        api.app.dependency_overrides[api.get_db] = get_db
        self.client = TestClient(api.app)  # No startup context against another DB.

    def tearDown(self):
        self.client.close()
        api.app.dependency_overrides.clear()
        self.session.close()
        self.engine.dispose()
        self.temp.cleanup()

    def add(self, rows):
        for items in rows.values(): self.session.add_all(items)
        self.session.commit()

    def exception(self, rows=None, category=ExceptionCategory.UNKNOWN_ADJUSTMENT):
        rows = rows or group()
        self.add(rows)
        persist_group_result(self.session, rows, {'outcome': 'exception', 'category': category,
            'notes': 'Manual gate fixture; source arithmetic must still be checked.', 'explanation': {}})
        self.session.commit()
        return self.session.query(Exception_).one().exception_id

    def review(self, exception_id, **updates):
        body = {'action': 'approve', 'reviewer_name': 'Test reviewer', 'notes': 'Checked every source.', 'expected_status': 'open'}
        body.update(updates)
        return self.client.post(f'/exceptions/{exception_id}/review', json=body)

    def test_all_scenarios_across_three_fresh_seeds(self):
        for seed in [42, 7, 2026]:
            with self.subTest(seed=seed):
                directory = self.path / f'batch-{seed}'
                directory.mkdir()
                generator = Generator(seed)
                for scenario in Generator.SCENARIO_FUNCS.values(): scenario(generator)
                generator.generate(200 - len(Generator.SCENARIO_FUNCS))
                generator.write(str(directory))
                report = run(directory, directory / 'result.db')
                self.assertGreaterEqual(sum(report['ingested'].values()), 50)
                self.assertTrue(report['evaluation']['all_checks_passed'], report['evaluation']['errors'])
                self.assertEqual(report['evaluation']['false_positives'], 0)
                self.assertEqual(report['evaluation']['false_negatives'], 0)
                self.assertGreater(len(report['unresolved_exceptions']), 0)

    def test_five_case_showcase_is_exact_and_navigable(self):
        directory = self.path / 'showcase'
        directory.mkdir()
        generator = Generator(2026)
        cases = add_showcase_cases(generator)
        generator.write(str(directory))
        db_path = directory / 'showcase.db'
        report = run(directory, db_path)
        self.assertTrue(report['evaluation']['all_checks_passed'], report['evaluation']['errors'])
        self.assertEqual(report['evaluation']['true_positives'], 4)
        self.assertEqual(report['evaluation']['correct_exceptions'], 1)
        self.assertEqual(sum(report['ingested'].values()), 20)
        attach_reconciled_entities(db_path, cases, generator.ground_truth)
        self.assertEqual(len({case['entity_id'] for case in cases}), 5)
        self.assertEqual([case['entity_type'] for case in cases], ['match', 'match', 'match', 'match', 'exception'])

    def test_demo_cases_endpoint_is_optional(self):
        with patch.object(api, 'DATA_DIR', str(self.path)):
            self.assertEqual(self.client.get('/demo-cases').json(), {'available': False, 'cases': []})
            manifest = {'available': True, 'title': 'Demo', 'cases': [{'entity_id': 'case-1'}]}
            (self.path / 'demo_cases.json').write_text(json.dumps(manifest), encoding='utf-8')
            self.assertEqual(self.client.get('/demo-cases').json(), manifest)

    def test_existing_database_is_preserved(self):
        before = (self.path / 'test.db').read_bytes()
        with self.assertRaises(FileExistsError): run(self.path, self.path / 'test.db')
        self.assertEqual(before, (self.path / 'test.db').read_bytes())

    def test_duplicate_pipeline_run_refused(self):
        self.add(group())
        run_matching(self.session)
        with self.assertRaises(ValueError): run_matching(self.session)
        with self.assertRaises(ValueError): ingest_all(self.session, str(self.path))
        self.assertEqual(self.session.query(Match).count(), 1)

    def test_blank_references_do_not_merge_unrelated_ledger_rows(self):
        rows = [group()['ledger'][0], group(2)['ledger'][0]]
        for row in rows: row.external_ref = None
        self.session.add_all(rows)
        self.session.commit()
        self.assertEqual(len(build_groups(self.session)), 2)

    def test_equal_counts_but_wrong_membership_fails_evaluation(self):
        first, second = group(), group(2)  # Identical amounts, distinct references.
        self.add(first); self.add(second)
        run_matching(self.session)
        expected = truth([first, second])
        self.assertTrue(evaluate(self.session, expected)['all_checks_passed'])
        ledger_links = self.session.query(MatchTransaction).filter_by(role=TxnRole.LEDGER).all()
        ledger_links[0].transaction_id, ledger_links[1].transaction_id = ledger_links[1].transaction_id, ledger_links[0].transaction_id
        self.session.commit(); self.session.expire_all()
        scores = evaluate(self.session, expected)
        self.assertTrue(scores['match_count_correct'])
        self.assertEqual(scores['false_positives'], 2)
        self.assertEqual(scores['false_negatives'], 2)
        self.assertFalse(scores['all_checks_passed'])

    def test_correct_links_but_bad_money_fails_evaluation(self):
        rows = group(); self.add(rows); run_matching(self.session)
        rows['ledger'][0].amount_minor_units += 100
        self.session.commit()
        scores = evaluate(self.session, truth([rows]))
        self.assertEqual(scores['financial_validation_failures'], 1)
        self.assertEqual(scores['match_precision'], 0)

    def test_wrong_exception_category_and_missing_source_are_detected(self):
        rows = group(); rows['bank'] = []
        self.exception(rows)
        expected = truth([rows]); expected[0].update(expected_resolution='exception', expected_category='missing_bank_credit')
        scores = evaluate(self.session, expected)
        self.assertEqual(scores['incorrect_exceptions'], 1)
        expected[0]['bank_refs'] = ['BANK-999999']
        self.assertFalse(evaluate(self.session, expected)['dataset_aligned'])

    def test_no_denominator_is_not_fake_perfect_precision(self):
        scores = evaluate(self.session, [])
        self.assertIsNone(scores['match_precision'])
        self.assertIsNone(scores['match_recall'])

    def test_unverified_approval_has_no_side_effects(self):
        rows = group(); rows['ledger'][0].amount_minor_units += 100
        exception_id = self.exception(rows)
        audit_count = self.session.query(AuditLog).count()
        self.assertEqual(self.review(exception_id).status_code, 409)
        self.assertEqual(self.session.query(Match).count(), 0)
        self.assertEqual(self.session.query(User).count(), 0)
        self.assertEqual(self.session.query(AuditLog).count(), audit_count)

    def test_rejection_reopens_and_preserves_unresolved_metrics(self):
        exception_id = self.exception()
        before = self.client.get('/metrics').json()
        response = self.review(exception_id, action='reject')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['new_status'], 'reopened')
        after = self.client.get('/metrics').json()
        self.assertEqual(after['unresolved_groups'], 1)
        self.assertEqual(after['total_groups'], before['total_groups'])
        self.assertEqual(after['straight_through_rate'], before['straight_through_rate'])
        self.assertEqual(after['exceptions_reopened'], 1)
        detail = self.client.get(f'/exceptions/{exception_id}').json()
        self.assertIsNone(detail['resolved_at'])
        audit = self.session.query(AuditLog).filter_by(action='human_rejected').one()
        self.assertEqual(audit.details['old_status'], 'open')
        self.assertEqual(audit.details['new_status'], 'reopened')
        self.assertEqual(self.review(exception_id, action='reject', expected_status='reopened').status_code, 409)

    def test_approval_is_verified_audited_and_does_not_double_count(self):
        rows = group(); exception_id = self.exception(rows)
        response = self.review(exception_id)
        self.assertEqual(response.status_code, 200, response.text)
        match = self.session.query(Match).one()
        self.assertEqual(match.match_type, MatchType.HUMAN)
        self.assertEqual(match.explanation['rule_version'], RULE_VERSION)
        self.assertTrue(match.explanation['financially_verified'])
        self.assertEqual(match.explanation['source_exception_id'], exception_id)
        scores = self.client.get('/metrics').json()
        self.assertEqual(scores['total_groups'], 1)
        self.assertEqual(scores['match_rate'], 1)
        self.assertEqual(scores['straight_through_rate'], 0)
        self.assertEqual(scores['unresolved_groups'], 0)
        self.assertEqual(evaluate(self.session, truth([rows]))['actual_matches'], 0)
        self.assertEqual(self.review(exception_id).status_code, 409)
        self.assertEqual(self.session.query(Match).count(), 1)

    def test_review_requires_nonblank_notes_name_and_current_status(self):
        exception_id = self.exception()
        for update in [{'notes': ''}, {'notes': '   '}, {'reviewer_name': ' '}, {'expected_status': 'resolved'}]:
            with self.subTest(update=update): self.assertEqual(self.review(exception_id, **update).status_code, 422)
        self.assertEqual(self.review(exception_id, expected_status='in_review').status_code, 409)

    def test_two_concurrent_approvals_create_one_match(self):
        exception_id = self.exception()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.review(exception_id).status_code, range(2)))
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(self.session.query(Match).count(), 1)

    def test_overlapping_accepted_match_blocks_review_and_rolls_back(self):
        rows = group(); exception_id = self.exception(rows)
        persist_group_result(self.session, rows, verify_group(rows)); self.session.commit()
        self.assertEqual(self.review(exception_id).status_code, 409)
        self.session.expire_all()
        self.assertEqual(self.session.get(Exception_, exception_id).status, ExceptionStatus.OPEN)
        self.assertEqual(self.session.query(User).count(), 0)

    def test_mock_ai_proposes_only_and_excludes_private_fields(self):
        rows = group(); rows['ledger'][0].amount_minor_units += 100
        exception_id = self.exception(rows, ExceptionCategory.AMOUNT_DISCREPANCY)
        with patch.dict(os.environ, {'RECON_AI_MODE': 'mock', 'GEMINI_API_KEY': 'test-not-a-key'}), patch.object(ai_reasoning, 'call_gemini', side_effect=AssertionError('No external calls allowed')):
            response = self.client.post('/run-ai-reasoning')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['mode'], 'mock')
        self.assertEqual(response.json()['total_processed'], 1)
        self.assertEqual(response.json()['processed_by_category'], {
            'amount_discrepancy': 1, 'ambiguous_candidate': 0})
        self.session.expire_all()
        exception = self.session.get(Exception_, exception_id)
        self.assertEqual(exception.status, ExceptionStatus.IN_REVIEW)
        self.assertEqual(self.session.query(Match).count(), 0)
        for forbidden in ['customer_id', 'raw_payload', 'external_ref', 'order_id']:
            self.assertNotIn(forbidden, json.dumps(exception.ai_hypothesis['evidence_sent']))

    def test_ai_does_not_overwrite_human_review_during_model_call(self):
        rows = group(); rows['ledger'][0].amount_minor_units += 100
        exception_id = self.exception(rows, ExceptionCategory.AMOUNT_DISCREPANCY)
        def reviewed_while_waiting(payload):
            self.assertEqual(self.review(exception_id, action='reject').status_code, 200)
            return ai_reasoning.call_mock(payload)
        with patch.object(ai_reasoning, 'get_ai_hypothesis', side_effect=reviewed_while_waiting):
            _, count, _ = ai_reasoning.apply_ai_reasoning(self.session)
        self.assertEqual(count, 0)
        self.session.expire_all()
        self.assertEqual(self.session.get(Exception_, exception_id).status, ExceptionStatus.REOPENED)
        self.assertEqual(self.session.query(AuditLog).filter_by(actor='ai').count(), 0)

    def test_pagination_validation_and_stable_order(self):
        self.add(group()); self.add(group(2)); run_matching(self.session)
        first = self.client.get('/matches?limit=1').json()[0]['match_id']
        second = self.client.get('/matches?limit=1&offset=1').json()[0]['match_id']
        self.assertNotEqual(first, second)
        self.assertEqual(first, self.client.get('/matches?limit=1').json()[0]['match_id'])
        for path in ['/matches?limit=0', '/matches?limit=501', '/matches?offset=-1', '/matches?match_type=invalid', '/exceptions?status=bad', '/exceptions?category=bad', '/audit-log?offset=-1']:
            with self.subTest(path=path): self.assertEqual(self.client.get(path).status_code, 422)

    def test_eval_api_contract_and_missing_truth_error(self):
        rows = group(); self.add(rows); run_matching(self.session)
        target = self.path / 'truth.json'
        target.write_text(json.dumps(truth([rows])), encoding='utf-8')
        with patch.object(api, 'GROUND_TRUTH_PATH', str(target)):
            response = self.client.get('/eval-scores')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['true_positives'], 1)
        with patch.object(api, 'GROUND_TRUTH_PATH', str(self.path / 'missing.json')):
            self.assertEqual(self.client.get('/eval-scores').status_code, 404)


def tearDownModule():
    api._engine.dispose()
    API_TEMP.cleanup()


if __name__ == '__main__':
    unittest.main()

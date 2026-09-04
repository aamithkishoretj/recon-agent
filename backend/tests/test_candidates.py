"""Adversarial candidate recovery tests; no external calls or working-data edits."""
from collections import Counter
from datetime import timedelta
import json
import os
from pathlib import Path
import random
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / 'scripts'))
from test_reconciliation import group, truth, api
from app.models.db import (get_engine, init_db, get_session_factory, Transaction, Match,
    MatchTransaction, Exception_, ExceptionTransaction, ExceptionCategory, TxnStatus, AuditLog, User)
from app.services.matching import build_groups, run_matching
from app.services.candidates import recover_candidates, CANDIDATE_VERSION
from app.services import ai_reasoning
from app.services.evaluation import evaluate
from app.services.ingestion import extract_refs, ingest_all
from generate_synthetic_data import Generator
from fastapi.testclient import TestClient


def broken(number=1, amount=10000, typo=False, identity=True):
    rows = group(number, amount)
    ledger, settlement, bank = (rows[key][0] for key in ('ledger', 'settlement', 'bank'))
    settlement.raw_payload['payment_ref'] = ledger.external_ref[:-1] + 'X' if typo else ''
    bank.raw_payload = {'description': 'NEFT PAYMENT SETTLEMENT'}
    if identity:
        ledger.order_id = f'ORDER-{number}'
        ledger.customer_id = f'CUSTOMER-{number}'
        ledger.raw_payload.update(payment_method='CARD')
        settlement.raw_payload.update(order_id='' if typo else ledger.order_id,
            customer_id=ledger.customer_id, payment_method='CARD', payout_ref=f'PAYOUT-{number}')
        bank.raw_payload.update(payout_ref=f'PAYOUT-{number}', payment_method='CARD')
    return rows


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.engine = get_engine('sqlite:///' + str(Path(self.temp.name) / 'test.db'))
        init_db(self.engine)
        self.factory = get_session_factory(self.engine)
        self.session = self.factory()
        def get_db():
            with self.factory() as session: yield session
        api.app.dependency_overrides[api.get_db] = get_db
        self.client = TestClient(api.app)

    def tearDown(self):
        self.client.close()
        api.app.dependency_overrides.clear()
        self.session.close()
        self.engine.dispose()
        self.temp.cleanup()

    def add(self, *groups):
        for rows in groups:
            for values in rows.values(): self.session.add_all(values)
        self.session.commit()

    def partition_is_disjoint(self):
        links = self.session.query(MatchTransaction).all() + self.session.query(ExceptionTransaction).all()
        self.assertEqual(Counter(link.transaction_id for link in links), Counter(row.record_id for row in self.session.query(Transaction)))

    def test_unique_missing_references_recovered_with_identity_and_math(self):
        rows = broken(); self.add(rows)
        self.assertEqual(len(build_groups(self.session)), 3)
        counts, total = run_matching(self.session)
        self.assertEqual((counts, total), ({'match': 1, 'exception': 0}, 1))
        match = self.session.query(Match).one()
        self.assertEqual(match.match_type.value, 'fuzzy')
        self.assertEqual(match.explanation['candidate_version'], CANDIDATE_VERSION)
        self.assertTrue(match.explanation['candidate']['identity_verified'])
        self.assertEqual(match.explanation['candidate']['score'], 100)
        self.assertTrue(evaluate(self.session, truth([rows]))['all_checks_passed'])
        self.partition_is_disjoint()

    def test_corrupted_reference_needs_customer_and_method_corroboration(self):
        rows = broken(typo=True); self.add(rows)
        run_matching(self.session)
        match = self.session.query(Match).one()
        self.assertEqual(match.confidence, .95)
        self.assertGreaterEqual(match.explanation['candidate']['link_evidence']['payment_reference_similarity'], .88)

    def test_no_false_exact_link_from_a_corrupted_prefix(self):
        self.assertEqual(extract_refs('NEFT LEDG-000001X batch'), [])
        self.assertEqual(extract_refs('NEFT XLEDG-000001 batch'), [])
        self.assertEqual(extract_refs('ref=LEDG-000001 / BATCH-12345'), ['LEDG-000001', 'BATCH-12345'])
        a, b = broken(1, typo=True), broken(2, amount=20000, typo=True)
        self.add(a, b)
        # Both damaged payment refs equal LEDG-00000X; they must NOT be unioned.
        self.assertEqual(len(build_groups(self.session)), 6)
        self.assertEqual(run_matching(self.session)[0]['match'], 2)

    def test_amount_and_timing_alone_stay_in_review(self):
        self.add(broken(identity=False)); counts, _ = run_matching(self.session)
        self.assertEqual(counts, {'match': 0, 'exception': 1})
        exc = self.session.query(Exception_).one()
        self.assertEqual(exc.category, ExceptionCategory.AMBIGUOUS_CANDIDATE)
        audit = self.session.query(AuditLog).filter_by(entity_id=exc.exception_id).one()
        self.assertFalse(audit.details['evidence']['financially_verified'])
        self.assertEqual(audit.details['evidence']['candidate_count'], 1)
        self.partition_is_disjoint()

    def test_reference_similarity_alone_is_not_identity(self):
        rows = broken(typo=True, identity=False)
        rows['bank'][0].raw_payload['description'] = 'NEFT LEDG-00000X'
        self.add(rows); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 0)

    def test_two_plausible_orders_form_one_ambiguous_case(self):
        rows = broken(identity=False)
        other = group(2)['ledger'][0]
        other.timestamp_utc += timedelta(minutes=3)
        rows['ledger'].append(other)
        self.add(rows); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 0)
        exc = self.session.query(Exception_).one()
        evidence = self.session.query(AuditLog).filter_by(entity_id=exc.exception_id).one().details['evidence']
        self.assertEqual(evidence['candidate_count'], 2)
        self.assertEqual(len(exc.transactions), 4)
        self.assertEqual({c['references']['ledger'][0] for c in evidence['candidates']}, {'LEDG-000001', 'LEDG-000002'})
        self.partition_is_disjoint()

    def test_close_scores_do_not_choose_a_winner(self):
        rows = broken(typo=True)
        ledger = rows['ledger'][0]
        rows['settlement'][0].raw_payload['order_id'] = ledger.order_id
        other = group(2)['ledger'][0]
        other.customer_id = ledger.customer_id
        other.raw_payload['payment_method'] = 'CARD'
        rows['ledger'].append(other)
        self.add(rows); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 0)
        evidence = self.session.query(AuditLog).filter_by(action='flagged').one().details['evidence']
        self.assertEqual([candidate['score'] for candidate in evidence['candidates']], [100, 95])

    def test_clear_leader_can_match_and_leaves_decoy_unresolved(self):
        rows = broken()
        decoy = group(2)['ledger'][0]
        self.add(rows, {'ledger': [decoy]})
        run_matching(self.session)
        match = self.session.query(Match).one()
        self.assertEqual(match.explanation['score_margin'], 30)
        self.assertEqual(self.session.query(Exception_).one().category, ExceptionCategory.MISSING_SETTLEMENT)
        self.partition_is_disjoint()

    def test_one_bank_credit_cannot_satisfy_two_settlements(self):
        first, second = broken(), broken(2)
        second['bank'] = []
        second['settlement'][0].raw_payload['payout_ref'] = 'PAYOUT-1'
        self.add(first, second); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 0)
        self.assertEqual(self.session.query(Exception_).count(), 1)
        self.partition_is_disjoint()

    def test_two_equally_plausible_bank_credits_stay_unresolved(self):
        rows = broken()
        second = broken(2)['bank'][0]
        second.raw_payload['payout_ref'] = 'PAYOUT-1'
        rows['bank'].append(second)
        self.add(rows); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 0)
        self.assertEqual(self.session.query(Exception_).count(), 1)
        self.partition_is_disjoint()

    def test_distinct_payout_metadata_disambiguates_equal_amounts(self):
        self.add(broken(), broken(2)); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 2)
        self.partition_is_disjoint()

    def test_exact_match_is_never_reused_by_candidate_recovery(self):
        exact, candidate = group(), broken(2)
        self.add(exact, candidate); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 2)
        self.partition_is_disjoint()

    def test_existing_two_source_component_remains_indivisible(self):
        rows = broken()
        rows['settlement'][0].raw_payload['payment_ref'] = rows['ledger'][0].external_ref
        decoy = group(2)['ledger'][0]
        self.add(rows, {'ledger': [decoy]}); run_matching(self.session)
        match = self.session.query(Match).one()
        ledger_links = [link.transaction.external_ref for link in match.transactions if link.role.value == 'ledger']
        self.assertEqual(ledger_links, ['LEDG-000001'])
        self.partition_is_disjoint()

    def test_candidate_hard_filters(self):
        for conflict in ['currency', 'status', 'method', 'order', 'customer', 'batch', 'payout', 'negative_time', 'late_settlement', 'late_bank', 'bad_fee', 'refund']:
            with self.subTest(conflict=conflict):
                rows = broken()
                ledger, settlement, bank = (rows[source][0] for source in ('ledger', 'settlement', 'bank'))
                if conflict == 'currency': bank.currency = 'USD'
                elif conflict == 'status': ledger.status = TxnStatus.AUTHORIZED
                elif conflict == 'method': settlement.raw_payload['payment_method'] = 'UPI'
                elif conflict == 'order': settlement.raw_payload['order_id'] = 'WRONG-ORDER'
                elif conflict == 'customer': settlement.raw_payload['customer_id'] = 'WRONG-CUSTOMER'
                elif conflict == 'batch': settlement.batch_id = 'BATCH-12345'; bank.batch_id = 'BATCH-54321'
                elif conflict == 'payout': bank.raw_payload['payout_ref'] = 'WRONG-PAYOUT'
                elif conflict == 'negative_time': bank.timestamp_utc -= timedelta(days=2)
                elif conflict == 'late_settlement': settlement.timestamp_utc += timedelta(days=4); bank.timestamp_utc += timedelta(days=4)
                elif conflict == 'late_bank': bank.timestamp_utc += timedelta(days=3)
                elif conflict == 'bad_fee': settlement.raw_payload['fee_paise'] += 100
                else: ledger.status = TxnStatus.PARTIALLY_REFUNDED; ledger.raw_payload['refund_amount_paise'] = 500
                # IDs normally assigned during ingestion; use stable fixture IDs.
                for source in rows:
                    for row in rows[source]: row.record_id = row.external_ref
                groups = [{source: [rows[source][0]] if source == chosen else [] for source in rows} for chosen in rows]
                output = recover_candidates(groups)
                self.assertFalse(any(result and result['outcome'] == 'match' for _, result in output))

    def test_legacy_complete_discrepancy_is_not_repaired_by_stealing_rows(self):
        rows = group(); rows['bank'][0].amount_minor_units -= 100
        self.add(rows, broken(2)); run_matching(self.session)
        self.assertEqual(self.session.query(Match).count(), 1)
        self.assertEqual(self.session.query(Exception_).one().category, ExceptionCategory.AMOUNT_DISCREPANCY)
        self.partition_is_disjoint()

    def test_record_order_does_not_break_ties_or_change_decisions(self):
        rows = broken(identity=False); rows['ledger'].append(group(2)['ledger'][0])
        self.add(rows)
        groups = build_groups(self.session)
        def signature(output):
            return sorted((tuple(sorted(t.external_ref for values in group.values() for t in values)), result['outcome'] if result else None,
                result['category'].value if result and result['outcome'] == 'exception' else None) for group, result in output)
        baseline = signature(recover_candidates(groups))
        for seed in range(10):
            random.Random(seed).shuffle(groups)
            self.assertEqual(signature(recover_candidates(groups)), baseline)

    def test_search_budget_never_truncates_then_auto_matches(self):
        self.add(broken(), broken(2))
        with patch('app.services.candidates.MAX_NEIGHBORS', 1):
            counts, _ = run_matching(self.session)
        self.assertEqual(counts['match'], 0)
        self.assertTrue(all(log.details['evidence']['search_limit_reached'] for log in self.session.query(AuditLog)))
        self.partition_is_disjoint()

    def test_ambiguous_review_cannot_approve_all_candidates(self):
        self.add(broken(identity=False)); run_matching(self.session)
        exc = self.session.query(Exception_).one()
        response = self.client.post(f'/exceptions/{exc.exception_id}/review', json={
            'action': 'approve', 'reviewer_name': 'Demo', 'notes': 'Attempted bypass', 'expected_status': 'open'})
        self.assertEqual(response.status_code, 409)
        self.assertIn('identity is unresolved', response.json()['detail'])
        self.assertEqual(self.session.query(Match).count(), 0)
        self.assertEqual(self.session.query(User).count(), 0)

    def test_candidate_audit_is_available_through_existing_exception_api(self):
        self.add(broken(identity=False)); run_matching(self.session)
        response = self.client.get('/exceptions')
        self.assertEqual(response.status_code, 200)
        evidence = response.json()[0]['system_evidence']['evidence']
        self.assertEqual(evidence['candidate_version'], CANDIDATE_VERSION)
        self.assertEqual(evidence['candidates'][0]['signals']['financial_arithmetic'], 40)

    def test_ai_assesses_ambiguous_candidates_without_ids_or_a_winner(self):
        rows = broken(identity=False)
        other = group(2)['ledger'][0]
        other.timestamp_utc += timedelta(minutes=3)
        rows['ledger'].append(other)
        self.add(rows); run_matching(self.session)
        exc = self.session.query(Exception_).one()
        self.assertEqual(exc.category, ExceptionCategory.AMBIGUOUS_CANDIDATE)

        with patch.dict(os.environ, {'RECON_AI_MODE': 'mock', 'GEMINI_API_KEY': 'test-not-a-key'}), \
                patch.object(ai_reasoning, 'call_gemini', side_effect=AssertionError('No external calls allowed')):
            response = self.client.post('/run-ai-reasoning')

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['processed_by_category'], {
            'amount_discrepancy': 0, 'ambiguous_candidate': 1})
        self.session.expire_all()
        exc = self.session.get(Exception_, exc.exception_id)
        self.assertEqual(exc.status.value, 'in_review')
        self.assertEqual(self.session.query(Match).count(), 0)
        self.assertFalse(exc.ai_hypothesis['resolved'])
        self.assertEqual(exc.ai_hypothesis['analysis_kind'], 'ambiguous_candidate')
        self.assertEqual(exc.ai_hypothesis['evidence_sent']['candidate_count'], 2)
        serialized = json.dumps(exc.ai_hypothesis['evidence_sent'])
        for forbidden in ['customer_id', 'raw_payload', 'external_ref', 'order_id',
                          'record_ids', 'references', 'LEDG-', 'SETT-', 'BANK-']:
            self.assertNotIn(forbidden, serialized)
        log = self.session.query(AuditLog).filter_by(actor='ai').one()
        self.assertEqual(log.details['analysis_kind'], 'ambiguous_candidate')

    def test_ai_provider_cannot_resolve_candidate_identity(self):
        rows = broken(identity=False)
        other = group(2)['ledger'][0]
        other.timestamp_utc += timedelta(minutes=3)
        rows['ledger'].append(other)
        self.add(rows); run_matching(self.session)
        unsafe = ai_reasoning.AIHypothesis(
            resolved=True, confidence=0.99, explanation='Choose candidate one',
            evidence_fields_used=['candidates'], suggested_category='other')

        with patch.object(ai_reasoning, 'get_ai_hypothesis', return_value=unsafe):
            processed, total, by_category = ai_reasoning.apply_ai_reasoning(self.session)

        self.assertEqual(total, 1)
        self.assertEqual(processed, {'resolved_hypothesis': 0, 'declined_hypothesis': 1})
        self.assertEqual(by_category['ambiguous_candidate'], 1)
        exc = self.session.query(Exception_).one()
        self.assertFalse(exc.ai_hypothesis['resolved'])
        self.assertLessEqual(exc.ai_hypothesis['confidence'], 0.3)
        self.assertEqual(self.session.query(Match).count(), 0)

    def test_generated_ambiguity_contains_no_winner_reference(self):
        generator = Generator(42); generator.scenario_ambiguous_candidate()
        event = generator.ground_truth[0]
        self.assertEqual(event['expected_resolution'], 'exception')
        self.assertEqual(len(event['ledger_refs']), 2)
        self.assertEqual(generator.settlement_rows[0]['payment_ref'], '')
        for ref in event['ledger_refs']:
            self.assertNotIn(ref, generator.bank_rows[0]['description'])
        generator.write(self.temp.name); ingest_all(self.session, self.temp.name); run_matching(self.session)
        self.assertTrue(evaluate(self.session, generator.ground_truth)['all_checks_passed'])
        evidence = self.session.query(AuditLog).one().details['evidence']
        actual = {(tuple(c['references']['ledger']), tuple(c['references']['settlement']), tuple(c['references']['bank'])) for c in evidence['candidates']}
        expected = {(tuple(c['ledger_refs']), tuple(c['settlement_refs']), tuple(c['bank_refs'])) for c in event['candidate_sets']}
        self.assertEqual(actual, expected)

    def test_matching_has_no_ground_truth_access(self):
        generator = Generator(7); generator.scenario_missing_references(); generator.write(self.temp.name)
        ingest_all(self.session, self.temp.name)
        # No file reads are needed after ingestion, even if truth is unavailable.
        with patch('builtins.open', side_effect=AssertionError('Matching must not read files')):
            counts, _ = run_matching(self.session)
        self.assertEqual(counts['match'], 1)


if __name__ == '__main__':
    unittest.main()

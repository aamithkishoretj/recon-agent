"""Create a fresh, isolated five-case dataset for the judge presentation.

The showcase manifest is written only after reconciliation has finished. The
matching pipeline never reads it (or ground truth), so it cannot influence a
matching decision.
"""
import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path

from generate_synthetic_data import Generator
from run_pipeline import run, BACKEND

from app.models.db import Exception_, Match, get_engine, get_session_factory
from app.services.evaluation import group_keys, truth_groups


def add_showcase_cases(generator: Generator):
    """Build five intentionally memorable finance-ops cases."""
    cases = []

    # 1. Gross ₹10,000 less ₹200 fee and ₹36 GST = ₹9,764 net.
    ts = generator.base_date.replace(hour=10, minute=15)
    ledger = generator.add_ledger('SHOWCASE-FEE-GST', ts, 1_000_000)
    generator.ledger_rows[-1]['payment_method'] = 'CARD'
    settlement = generator.add_settlement(ledger, ts + timedelta(days=1), 1_000_000, 20_000, 3_600, 976_400)
    bank = generator.add_bank(ledger, ts + timedelta(days=1, hours=2), 976_400)
    generator.record_gt('fee_gst', [ledger], [settlement], [bank], 'auto_match',
                        notes='canonical_showcase gross=1000000 fee=20000 gst=3600 net=976400')
    cases.append({
        'event_id': generator.ground_truth[-1]['event_id'],
        'number': '01', 'kind': 'fee_gst', 'title': 'Fee + GST waterfall',
        'summary': 'A ₹10,000 card payment lands as ₹9,764 after the processor fee and GST.',
        'outcome': 'Auto-matched', 'tone': 'blue',
        'facts': [{'label': 'Gross', 'value': '₹10,000'}, {'label': 'Fee', 'value': '₹200'},
                  {'label': 'GST', 'value': '₹36'}, {'label': 'Net', 'value': '₹9,764'}],
        'talking_point': 'The verifier proves the full arithmetic chain; equal-looking totals are not enough.',
    })

    # 2. Four orders roll up to one settlement and one bank credit.
    settle_ts = generator.base_date.replace(day=4, hour=18)
    ledger_refs = []
    gross_amounts = [250_000, 350_000, 400_000, 500_000]
    for index, gross in enumerate(gross_amounts, start=1):
        ref = generator.add_ledger(f'SHOWCASE-BATCH-{index}', settle_ts - timedelta(hours=8 - index), gross)
        generator.ledger_rows[-1]['payment_method'] = 'CARD'
        ledger_refs.append(ref)
    settlement = generator.add_settlement(','.join(ledger_refs), settle_ts, 1_500_000, 30_000, 5_400,
                                          1_464_600, batch_id='BATCH-04004')
    bank = generator.add_bank('BATCH-04004', settle_ts + timedelta(hours=1), 1_464_600, note='BATCH')
    generator.record_gt('batch_n_to_1', ledger_refs, [settlement], [bank], 'auto_match',
                        notes='canonical_showcase n=4 batch_id=BATCH-04004')
    cases.append({
        'event_id': generator.ground_truth[-1]['event_id'],
        'number': '02', 'kind': 'batch_n_to_1', 'title': 'Four orders, one payout',
        'summary': 'Four separate ledger orders reconcile to one settlement batch and one bank credit.',
        'outcome': 'Auto-matched', 'tone': 'violet',
        'facts': [{'label': 'Orders', 'value': '4'}, {'label': 'Gross', 'value': '₹15,000'},
                  {'label': 'Payouts', 'value': '1'}, {'label': 'Net', 'value': '₹14,646'}],
        'talking_point': 'The data model supports N:1 groups instead of forcing every order into a false 1:1 match.',
    })

    # 3. One captured payment followed by a ₹1,500 partial refund.
    ts = generator.base_date.replace(day=8, hour=12, minute=30)
    ledger = generator.add_ledger('SHOWCASE-PARTIAL-REFUND', ts, 800_000, status='partially_refunded')
    generator.ledger_rows[-1]['payment_method'] = 'CARD'
    generator.record_refund(ledger, 150_000)
    settlement_sale = generator.add_settlement(ledger, ts + timedelta(days=1), 800_000, 16_000, 2_880, 781_120)
    bank_sale = generator.add_bank(ledger, ts + timedelta(days=1, hours=2), 781_120)
    settlement_refund = generator.add_settlement(ledger, ts + timedelta(days=3), -150_000, 0, 0, -150_000,
                                                 status='refund')
    bank_refund = generator.add_bank(ledger, ts + timedelta(days=3, hours=1), -150_000, note='REFUND')
    generator.record_gt('partial_refund', [ledger], [settlement_sale, settlement_refund],
                        [bank_sale, bank_refund], 'auto_match', notes='canonical_showcase refund_amt=150000')
    cases.append({
        'event_id': generator.ground_truth[-1]['event_id'],
        'number': '03', 'kind': 'partial_refund', 'title': 'Partial refund across records',
        'summary': 'A ₹1,500 refund is tied back to the original ₹8,000 order across two settlement and bank rows.',
        'outcome': 'Auto-matched', 'tone': 'green',
        'facts': [{'label': 'Original', 'value': '₹8,000'}, {'label': 'Refund', 'value': '₹1,500'},
                  {'label': 'Settlement rows', 'value': '2'}, {'label': 'Bank rows', 'value': '2'}],
        'talking_point': 'Refunds stay connected to the original sale, so the cash movement remains explainable.',
    })

    # 4. A valid payout that arrives two calendar days later.
    ts = generator.base_date.replace(day=12, hour=9)
    ledger = generator.add_ledger('SHOWCASE-TPLUS2', ts, 650_000)
    generator.ledger_rows[-1]['payment_method'] = 'CARD'
    settlement = generator.add_settlement(ledger, ts + timedelta(days=2), 650_000, 13_000, 2_340, 634_660)
    bank = generator.add_bank(ledger, ts + timedelta(days=2, hours=3), 634_660)
    generator.record_gt('settlement_delay', [ledger], [settlement], [bank], 'auto_match',
                        notes='canonical_showcase delay_days=2')
    cases.append({
        'event_id': generator.ground_truth[-1]['event_id'],
        'number': '04', 'kind': 'settlement_delay', 'title': 'T+2 settlement timing',
        'summary': 'A payment settles two days later without being mistaken for a missing payout.',
        'outcome': 'Auto-matched', 'tone': 'amber',
        'facts': [{'label': 'Gross', 'value': '₹6,500'}, {'label': 'Delay', 'value': 'T+2'},
                  {'label': 'Fee + GST', 'value': '₹153.40'}, {'label': 'Net', 'value': '₹6,346.60'}],
        'talking_point': 'Time-window evidence is explicit and the downstream timestamps remain auditable.',
    })

    # 5. Expected ₹19,420 but only ₹19,170 reaches the bank: honest exception.
    ts = generator.base_date.replace(day=18, hour=14)
    ledger = generator.add_ledger('SHOWCASE-SHORTFALL', ts, 2_000_000)
    generator.ledger_rows[-1]['payment_method'] = 'CARD'
    settlement = generator.add_settlement(ledger, ts + timedelta(days=1), 2_000_000, 50_000, 8_000, 1_942_000)
    bank = generator.add_bank(ledger, ts + timedelta(days=1, hours=2), 1_917_000, note='SHORTFALL')
    generator.record_gt('unexplained_discrepancy', [ledger], [settlement], [bank], 'exception',
                        notes='canonical_showcase unexplained_shortfall_paise=25000')
    cases.append({
        'event_id': generator.ground_truth[-1]['event_id'],
        'number': '05', 'kind': 'unexplained_discrepancy', 'title': 'Unexplained ₹250 shortfall',
        'summary': 'The expected ₹19,420 settlement is ₹250 above the observed ₹19,170 bank credit.',
        'outcome': 'Needs review', 'tone': 'red',
        'facts': [{'label': 'Expected', 'value': '₹19,420'}, {'label': 'Observed', 'value': '₹19,170'},
                  {'label': 'Difference', 'value': '₹250'}, {'label': 'Explanation', 'value': 'None'}],
        'talking_point': 'The controller refuses to invent a reason and routes the unexplained gap to a human.',
    })
    return cases


def attach_reconciled_entities(db_path: Path, cases: list[dict], events: list[dict]):
    expected_by_event = {group['event_id']: group['keys'] for group in truth_groups(events)}
    engine = get_engine('sqlite:///' + str(db_path))
    try:
        with get_session_factory(engine)() as session:
            entities = {}
            for match in session.query(Match).all():
                entities[group_keys(match)] = ('match', match.match_id)
            for exception in session.query(Exception_).all():
                entities[group_keys(exception)] = ('exception', exception.exception_id)
            for case in cases:
                entity = entities.get(expected_by_event[case['event_id']])
                if not entity:
                    raise RuntimeError('Showcase case was not emitted by reconciliation: ' + case['event_id'])
                case['entity_type'], case['entity_id'] = entity
                case.pop('event_id')
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--outdir', type=Path)
    args = parser.parse_args()
    outdir = args.outdir or BACKEND / 'showcase-runs' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    outdir.mkdir(parents=True, exist_ok=False)

    generator = Generator(seed=2026)
    cases = add_showcase_cases(generator)
    generator.write(str(outdir))
    db_path = outdir / 'recon.db'
    report = run(outdir, db_path)
    report_path = outdir / 'report.json'
    report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    if not report['evaluation']['all_checks_passed']:
        raise RuntimeError('Showcase evaluation failed; inspect ' + str(report_path))

    attach_reconciled_entities(db_path, cases, generator.ground_truth)
    manifest = {
        'available': True,
        'title': 'Five cases worth showing',
        'summary': 'A compact, deterministic presentation batch. Every number below comes from the active source files.',
        'cases': cases,
    }
    manifest_path = outdir / 'demo_cases.json'
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({
        'data_dir': str(outdir), 'db_path': str(db_path), 'report': str(report_path),
        'demo_cases': str(manifest_path), 'records': sum(report['ingested'].values()),
        'evaluation': report['evaluation'], 'elapsed_seconds': report['elapsed_seconds'],
    }))


if __name__ == '__main__':
    main()

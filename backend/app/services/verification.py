"""Integer-paise verification of the synthetic feed contract, never tax advice.

Fee/GST amounts are declared source evidence, not independently verified tariffs.
Refunds must also be explicitly declared in the merchant ledger. No invented
adjustments, currency conversion, or LLM arithmetic is accepted.
"""
from app.models.db import ExceptionCategory as Category, MatchType, TxnStatus

RULE_VERSION = 'ledger-net-v2'
TOLERANCE = 5


def linked_group(record):
    group = {'ledger': [], 'settlement': [], 'bank': []}
    for link in record.transactions:
        group[link.transaction.source_type.value].append(link.transaction)
    return group


def integer_evidence(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('Expected integer paise')
    return int(value)


def verify_group(group):
    ledger, settlement, bank = (group[name] for name in ('ledger', 'settlement', 'bank'))
    evidence = {'rule_version': RULE_VERSION, 'rounding_tolerance_paise': TOLERANCE,
                'financially_verified': False, 'fee_basis': 'Declared settlement fee and GST, not tariff verification'}

    def exception(category, note):
        return {'outcome': 'exception', 'category': category, 'notes': note, 'explanation': dict(evidence)}

    for rows, category, note in [
        (ledger, Category.MISSING_LEDGER, 'No linked merchant ledger record.'),
        (settlement, Category.MISSING_SETTLEMENT, 'No linked settlement record.'),
        (bank, Category.MISSING_BANK_CREDIT, 'No linked bank credit.'),
    ]:
        if not rows:
            return exception(category, note)
    transactions = ledger + settlement + bank
    currencies = {row.currency for row in transactions}
    if len(currencies) != 1 or currencies != {'INR'}:
        return exception(Category.CURRENCY_MISMATCH, 'Only same-currency INR reconciliation is supported.')
    if any(row.status in (TxnStatus.FAILED, TxnStatus.AUTHORIZED, TxnStatus.REVERSED) for row in transactions):
        return exception(Category.UNKNOWN_ADJUSTMENT, 'Unsupported payment lifecycle; human investigation required.')
    for rows in (ledger, settlement, bank):
        refs = [row.external_ref for row in rows if row.external_ref]
        if len(refs) != len(set(refs)):
            return exception(Category.DUPLICATE, 'Repeated source-local reference within the group.')
    # Conservative duplicate suspicion, not deletion: equal bank postings on the
    # same day need human evidence to distinguish an import duplicate from splits.
    bank_keys = [(row.amount_minor_units, row.timestamp_utc.date()) for row in bank]
    if len(bank_keys) != len(set(bank_keys)):
        return exception(Category.DUPLICATE, 'Equal bank postings on the same date require duplicate review.')
    try:
        gross = sum(row.amount_minor_units for row in ledger)
        if any(row.amount_minor_units < 0 for row in ledger):
            return exception(Category.REFUND_MISMATCH, 'Use explicit merchant refund totals, not negative order amounts.')
        refund = 0
        for row in ledger:
            raw = row.raw_payload or {}
            if row.status in (TxnStatus.REFUNDED, TxnStatus.PARTIALLY_REFUNDED) and 'refund_amount_paise' not in raw:
                return exception(Category.REFUND_MISMATCH, 'Merchant refund amount is missing; settlement alone cannot prove it.')
            amount = integer_evidence(raw.get('refund_amount_paise', 0))
            if amount < 0 or amount > row.amount_minor_units:
                return exception(Category.REFUND_MISMATCH, 'Merchant refund amount is outside the order value.')
            if row.status == TxnStatus.REFUNDED and amount != row.amount_minor_units:
                return exception(Category.REFUND_MISMATCH, 'Fully refunded order does not declare a full refund.')
            if row.status == TxnStatus.PARTIALLY_REFUNDED and not 0 < amount < row.amount_minor_units:
                return exception(Category.REFUND_MISMATCH, 'Partial refund must be positive and less than the order value.')
            if amount and row.status not in (TxnStatus.REFUNDED, TxnStatus.PARTIALLY_REFUNDED):
                return exception(Category.REFUND_MISMATCH, 'Merchant refund status contradicts its declared refund amount.')
            refund += amount
        fee = gst = reported_gross = reported_refund = 0
        row_errors = []
        for row in settlement:
            raw = row.raw_payload or {}
            g, f, tax = (integer_evidence(raw[key]) for key in ('gross_amount_paise', 'fee_paise', 'gst_paise'))
            if f < 0 or tax < 0:
                return exception(Category.UNKNOWN_ADJUSTMENT, 'Negative fee/GST adjustments are not supported.')
            if g < 0:
                if row.status != TxnStatus.REFUNDED or f or tax:
                    return exception(Category.REFUND_MISMATCH, 'Refund rows must declare a refund status and zero fees/GST.')
                reported_refund -= g
            else:
                reported_gross += g
            fee += f
            gst += tax
            row_errors.append(row.amount_minor_units - (g - f - tax))
    except (KeyError, ValueError, TypeError):
        return exception(Category.UNKNOWN_ADJUSTMENT, 'Missing or malformed fee, GST, gross, or refund evidence.')
    net = gross - fee - gst - refund
    reported = sum(row.amount_minor_units for row in settlement)
    observed = sum(row.amount_minor_units for row in bank)
    differences = {
        'ledger_to_reported_gross_diff_paise': reported_gross - gross,
        'refund_diff_paise': reported_refund - refund,
        'ledger_to_settlement_diff_paise': reported - net,
        'settlement_to_bank_diff_paise': observed - reported,
        'ledger_to_bank_diff_paise': observed - net,
    }
    evidence.update(gross_ledger_amount=gross, fee=fee, gst=gst, refunds=refund,
                    expected_settlement=net, reported_settlement=reported,
                    observed_bank_total=observed, settlement_row_differences_paise=row_errors,
                    **differences)
    evidence['timing_delta_hours'] = round((max(t.timestamp_utc for t in bank) - min(t.timestamp_utc for t in ledger)).total_seconds() / 3600, 2)
    evidence['evidence_fields'] = ['ledger.amount', 'ledger.refund_amount_paise',
        'settlement.gross_amount_paise', 'settlement.fee_paise', 'settlement.gst_paise',
        'settlement.net_amount_paise', 'bank.credit_amount']
    if reported_refund != refund:
        return exception(Category.REFUND_MISMATCH, 'Merchant and settlement refund totals disagree.')
    # Check every leg and every row, so opposing errors cannot cancel each other.
    errors = list(differences.values()) + row_errors
    if any(abs(value) > TOLERANCE for value in errors):
        return exception(Category.AMOUNT_DISCREPANCY, 'Ledger, settlement formula, and bank evidence do not reconcile within 5 paise.')
    if min(t.timestamp_utc for t in settlement + bank) < min(t.timestamp_utc for t in ledger):
        return exception(Category.TIMING_DISCREPANCY, 'Downstream posting predates the first merchant order.')
    evidence['financially_verified'] = True
    rounded = any(errors)
    evidence['verification_kind'] = 'rounding_tolerance' if rounded else 'exact_arithmetic'
    evidence['confidence_basis'] = 'Rule score, not a calibrated probability: complete references, INR, supported lifecycle and every arithmetic check.'
    return {'outcome': 'match', 'match_type': MatchType.FUZZY if rounded else MatchType.DETERMINISTIC,
            'confidence': .95 if rounded else 1.0, 'explanation': evidence}

"""Conservative recovery of broken-reference 1:1:1 groups, without ground truth.

Exact graph components are indivisible. Only incomplete, single-row-per-source,
captured INR components are searched. Indexed amount windows narrow candidates;
currency, lifecycle, timing, metadata and the existing verifier gate each triple.
Amount/timing alone may suggest an investigation, NEVER an automatic match.
Scores are explicit rule points, not probabilities or LLM confidence.
"""
from bisect import bisect_left, bisect_right
from collections import defaultdict
from difflib import SequenceMatcher
import re

from app.models.db import ExceptionCategory, MatchType, TxnStatus
from app.services.verification import RULE_VERSION, TOLERANCE, integer_evidence, verify_group

CANDIDATE_VERSION = 'reference-recovery-v1'
AUTO_THRESHOLD = 90
MIN_MARGIN = 10
SETTLEMENT_WINDOW_HOURS = 72
BANK_WINDOW_HOURS = 48
MAX_NEIGHBORS = 100
MAX_COMBINATIONS = 10000
SOURCES = ('ledger', 'settlement', 'bank')


def rows_of(group):
    return [row for source in SOURCES for row in group[source]]


def row_key(row):
    return row.source_type.value, row.external_ref or '', row.record_id


def meta(row, key):
    # IDs are case-normalized, NOT punctuation-stripped: ORD-1 != ORD1.
    value = getattr(row, key, None) or (row.raw_payload or {}).get(key)
    return str(value).strip().upper() if value is not None else ''


def equal_meta(left, right, key):
    return bool(meta(left, key)) and meta(left, key) == meta(right, key)


def contradicts(left, right, key):
    return bool(meta(left, key) and meta(right, key) and meta(left, key) != meta(right, key))


def eligible(group):
    if all(group[source] for source in SOURCES) or any(len(group[source]) > 1 for source in SOURCES):
        return False
    for row in rows_of(group):
        if row.currency != 'INR' or row.status != TxnStatus.CAPTURED or row.amount_minor_units <= 0:
            return False
        try:
            if integer_evidence((row.raw_payload or {}).get('refund_amount_paise', 0)) != 0:
                return False
        except (ValueError, TypeError):
            return False
    return True


def similar_reference(left, right):
    # Similarity is only corroboration; neighboring numeric IDs look alike.
    a, b = str(left or '').strip().upper(), str(right or '').strip().upper()
    if min(len(a), len(b)) < 6:
        return 0.0
    return round(SequenceMatcher(None, a, b, autojunk=False).ratio(), 4)


def score_candidate(ledger, settlement, bank, owner):
    group = {'ledger': [ledger], 'settlement': [settlement], 'bank': [bank]}
    lag = (settlement.timestamp_utc - ledger.timestamp_utc).total_seconds() / 3600
    bank_lag = (bank.timestamp_utc - settlement.timestamp_utc).total_seconds() / 3600
    if not (0 <= lag <= SETTLEMENT_WINDOW_HOURS and 0 <= bank_lag <= BANK_WINDOW_HOURS):
        return None
    for key in ('order_id', 'customer_id', 'payment_method'):
        if any(contradicts(a, b, key) for a, b in ((ledger, settlement), (settlement, bank), (ledger, bank))):
            return None
    if any(contradicts(settlement, bank, key) for key in ('payout_ref', 'batch_id')):
        return None
    proof = verify_group(group)
    if proof['outcome'] != 'match':
        return None

    exact_ls = owner[ledger.record_id] == owner[settlement.record_id]
    exact_bank = owner[bank.record_id] in (owner[ledger.record_id], owner[settlement.record_id])
    order = equal_meta(ledger, settlement, 'order_id')
    customer = equal_meta(ledger, settlement, 'customer_id')
    method = equal_meta(ledger, settlement, 'payment_method')
    ref_similarity = similar_reference(ledger.external_ref, (settlement.raw_payload or {}).get('payment_ref'))
    # A typo plus the same customer and method is evidence, unlike typo alone.
    corroborated_typo = ref_similarity >= .88 and customer and method
    ledger_identity = exact_ls or order or corroborated_typo
    payout = equal_meta(settlement, bank, 'payout_ref')
    batch = equal_meta(settlement, bank, 'batch_id')
    bank_order = equal_meta(ledger, bank, 'order_id')
    bank_identity = exact_bank or payout or batch or bank_order
    description = (bank.raw_payload or {}).get('description', '')
    # Description similarity can rank an investigation but cannot establish identity.
    tokens = re.findall(r'[A-Za-z0-9_-]{6,}', description)
    description_similarity = max((similar_reference(ledger.external_ref, token) for token in tokens), default=0)
    signals = {
        'financial_arithmetic': 40,
        'settlement_window': 6 if lag <= 48 else 4,
        'bank_window': 4 if bank_lag <= 24 else 2,
        'ledger_identity': 25 if exact_ls or order else 20 if corroborated_typo else 5 if customer else 0,
        'bank_identity': 20 if bank_identity else 2 if description_similarity >= .88 else 0,
        'payment_method': 5 if method else 0,
    }
    return {
        'group': group, 'component_ids': frozenset(owner[row.record_id] for row in (ledger, settlement, bank)),
        'score': sum(signals.values()), 'identity_verified': ledger_identity and bank_identity,
        'signals': signals, 'proof': proof,
        'evidence': {
            'exact_ledger_component': exact_ls, 'exact_bank_component': exact_bank,
            'order_metadata_agrees': order, 'customer_metadata_agrees': customer,
            'payment_method_agrees': method, 'payout_metadata_agrees': payout,
            'batch_metadata_agrees': batch, 'bank_order_metadata_agrees': bank_order,
            'payment_reference_similarity': ref_similarity, 'description_reference_similarity': description_similarity,
            'settlement_lag_hours': round(lag, 4), 'bank_lag_hours': round(bank_lag, 4),
        },
    }


def public_candidate(candidate):
    return {
        'references': {source: [row.external_ref for row in candidate['group'][source]] for source in SOURCES},
        'record_ids': {source: [row.record_id for row in candidate['group'][source]] for source in SOURCES},
        'score': candidate['score'], 'identity_verified': candidate['identity_verified'],
        'signals': candidate['signals'], 'link_evidence': candidate['evidence'],
        'arithmetic': candidate['proof']['explanation'],
    }


def candidate_policy():
    return {'candidate_version': CANDIDATE_VERSION, 'auto_threshold': AUTO_THRESHOLD,
            'minimum_margin': MIN_MARGIN, 'settlement_window_hours': SETTLEMENT_WINDOW_HOURS,
            'bank_window_hours': BANK_WINDOW_HOURS, 'max_neighbors': MAX_NEIGHBORS,
            'max_combinations': MAX_COMBINATIONS,
            'score_basis': 'Rule points, not probability. Arithmetic 40; timing up to 10; ledger identity up to 25; bank identity up to 20; method 5.'}


def unresolved_result(candidates, reason, category=ExceptionCategory.AMBIGUOUS_CANDIDATE):
    return {'outcome': 'exception', 'category': category, 'notes': reason,
            'explanation': dict(candidate_policy(), rule_version=RULE_VERSION,
                financially_verified=False, candidate_review_required=True, candidate_count=len(candidates),
                candidates=[public_candidate(candidate) for candidate in candidates], reason=reason)}


class SearchLimitExceeded(Exception):
    pass


def generate_candidates(groups, eligible_ids):
    owner = {row.record_id: i for i, group in enumerate(groups) for row in rows_of(group)}
    ledger = sorted([row for i in eligible_ids for row in groups[i]['ledger']], key=lambda row: (row.amount_minor_units, row_key(row)))
    bank = sorted([row for i in eligible_ids for row in groups[i]['bank']], key=lambda row: (row.amount_minor_units, row_key(row)))
    ledger_amounts = [row.amount_minor_units for row in ledger]
    bank_amounts = [row.amount_minor_units for row in bank]
    settlements = sorted([row for i in eligible_ids for row in groups[i]['settlement']], key=row_key)
    candidates, combinations = [], 0
    for settlement in settlements:
        try:
            gross = integer_evidence((settlement.raw_payload or {})['gross_amount_paise'])
        except (KeyError, ValueError, TypeError):
            continue
        ls = ledger[bisect_left(ledger_amounts, gross - TOLERANCE):bisect_right(ledger_amounts, gross + TOLERANCE)]
        net = settlement.amount_minor_units
        bs = bank[bisect_left(bank_amounts, net - TOLERANCE):bisect_right(bank_amounts, net + TOLERANCE)]
        # Never hide a runner-up by truncating a search and then auto-matching.
        if len(ls) > MAX_NEIGHBORS or len(bs) > MAX_NEIGHBORS:
            raise SearchLimitExceeded
        for merchant in ls:
            for posting in bs:
                combinations += 1
                if combinations > MAX_COMBINATIONS:
                    raise SearchLimitExceeded
                component_ids = {owner[row.record_id] for row in (merchant, settlement, posting)}
                selected = {merchant.record_id, settlement.record_id, posting.record_id}
                component_rows = {row.record_id for i in component_ids for row in rows_of(groups[i])}
                if selected != component_rows:
                    continue  # Never split an existing reference component.
                candidate = score_candidate(merchant, settlement, posting, owner)
                if candidate:
                    candidates.append(candidate)
    return candidates


def recover_candidates(groups):
    """Return a disjoint partition of (group, optional classification override).

All competing triples are considered before any decision. Only reciprocal clear
leaders can auto-match; remaining overlapping alternatives form review clusters.
Every input record still belongs to exactly one output group.
"""
    eligible_ids = {i for i, group in enumerate(groups) if eligible(group)}
    try:
        candidates = generate_candidates(groups, eligible_ids)
    except SearchLimitExceeded:
        result = unresolved_result([], 'Candidate search limit reached. No automatic recovery was attempted; narrow the batch for review.', ExceptionCategory.UNKNOWN_ADJUSTMENT)
        result['explanation']['search_limit_reached'] = True
        return [(group, result if i in eligible_ids else None) for i, group in enumerate(groups)]
    candidates.sort(key=lambda item: (-item['score'], tuple(row_key(row) for row in rows_of(item['group']))))
    by_component = defaultdict(list)
    for index, candidate in enumerate(candidates):
        for component in candidate['component_ids']:
            by_component[component].append(index)
    consumed, recovered = set(), []
    for index, candidate in enumerate(candidates):
        rivals = {other for component in candidate['component_ids'] for other in by_component[component] if other != index}
        runner_up = max((candidates[other]['score'] for other in rivals), default=None)
        margin = candidate['score'] - runner_up if runner_up is not None else None
        if (candidate['score'] < AUTO_THRESHOLD or not candidate['identity_verified'] or
                (margin is not None and margin < MIN_MARGIN) or candidate['component_ids'] & consumed):
            continue
        explanation = dict(candidate['proof']['explanation'], **candidate_policy(),
            matching_method='candidate_recovery', candidate=public_candidate(candidate),
            runner_up_score=runner_up, score_margin=margin, candidate_review_required=False,
            confidence_basis='Rule points from arithmetic, bounded timing and corroborated cross-source identity; not a calibrated probability.')
        result = {'outcome': 'match', 'match_type': MatchType.FUZZY,
                  'confidence': candidate['score'] / 100, 'explanation': explanation}
        recovered.append((candidate['group'], result))
        consumed.update(candidate['component_ids'])

    # Connected components of overlapping alternatives become one investigation,
    # not several exceptions that count the same source row multiple times.
    remaining = [candidate for candidate in candidates if not candidate['component_ids'] & consumed]
    adjacency = defaultdict(set)
    for candidate in remaining:
        for component in candidate['component_ids']:
            adjacency[component].update(candidate['component_ids'])
    visited = set(consumed)
    for component in sorted(adjacency):
        if component in visited:
            continue
        cluster, stack = set(), [component]
        while stack:
            current = stack.pop()
            if current in cluster:
                continue
            cluster.add(current)
            stack.extend(adjacency[current] - cluster)
        visited.update(cluster)
        alternatives = [candidate for candidate in remaining if candidate['component_ids'] <= cluster]
        merged = {source: sorted([row for i in cluster for row in groups[i][source]], key=row_key) for source in SOURCES}
        reason = ('Multiple plausible record assignments; no clear, independently supported winner.' if len(alternatives) > 1
                  else 'Amounts reconcile, but cross-source identity evidence is insufficient for automatic recovery.')
        recovered.append((merged, unresolved_result(alternatives, reason)))
    recovered.extend((group, None) for i, group in enumerate(groups) if i not in visited)
    recovered.sort(key=lambda pair: tuple(sorted(row_key(row) for row in rows_of(pair[0]))))
    return recovered

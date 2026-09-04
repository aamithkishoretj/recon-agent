"""Evaluator-only ground truth access. The matcher never imports this module."""
from collections import Counter
import re

from app.models.db import Match, MatchType, MatchStatus, Exception_, Transaction
from app.services.verification import verify_group, linked_group, RULE_VERSION

CATEGORY = {'duplicate_row': 'duplicate', 'missing_ledger': 'missing_ledger',
            'missing_bank': 'missing_bank_credit', 'missing_settlement': 'missing_settlement',
            'unexplained_discrepancy': 'amount_discrepancy'}


def truth_groups(events):
    groups = []
    for event in events:
        if event['expected_resolution'] not in ('auto_match', 'exception'):
            raise ValueError('Unknown expected resolution in ground truth.')
        category = event.get('expected_category') or CATEGORY.get(event['event_type'])
        if event['expected_resolution'] == 'exception' and not category:
            raise ValueError('Expected exception is missing its category.')
        keys = tuple(sorted((source, ref) for source in ('ledger', 'settlement', 'bank')
                            for ref in event[f'{source}_refs']))
        if not keys:
            raise ValueError('Ground truth contains an empty event.')
        if any(not isinstance(ref, str) or not ref.strip() for _, ref in keys):
            raise ValueError('Ground truth requires nonblank source-local references.')
        groups.append(dict(event, keys=keys, category=category))
        # Legacy generator stored the un-settled decoy in notes. Score that row
        # explicitly too; do not silently omit it from the evaluation universe.
        decoy = re.search(r'decoy_ledger_ref=(LEDG-\d+)', event.get('notes', ''))
        if decoy:
            groups.append({'event_id': event['event_id'] + '-decoy', 'event_type': 'unsettled_decoy',
                           'expected_resolution': 'exception', 'category': 'missing_settlement',
                           'keys': (('ledger', decoy.group(1)),)})
    all_keys = [key for group in groups for key in group['keys']]
    if len(all_keys) != len(set(all_keys)):
        raise ValueError('Ground truth reuses source references across events.')
    return groups


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def group_keys(record):
    return tuple(sorted((link.transaction.source_type.value, link.transaction.external_ref or '__unknown__' + link.transaction_id)
                        for link in record.transactions))


def evaluate(session, events):
    expected = truth_groups(events)
    auto_expected = {group['keys']: group for group in expected if group['expected_resolution'] == 'auto_match'}
    ex_expected = {group['keys']: group for group in expected if group['expected_resolution'] == 'exception'}
    matches = session.query(Match).filter(Match.match_type.in_([MatchType.DETERMINISTIC, MatchType.FUZZY]),
                                        Match.status == MatchStatus.AUTO_MATCHED).order_by(Match.match_id).all()
    exceptions = session.query(Exception_).order_by(Exception_.exception_id).all()
    transactions = session.query(Transaction).all()
    expected_keys = {key for group in expected for key in group['keys']}
    actual_keys = [(row.source_type.value, row.external_ref or '__unknown__' + row.record_id) for row in transactions]
    missing = sorted(expected_keys - set(actual_keys))
    extra = sorted(set(actual_keys) - expected_keys)
    repeated = len(actual_keys) - len(set(actual_keys))
    seen_auto, seen_ex, errors = set(), set(), []
    financial_failures = 0
    legacy_matches = 0
    for match in matches:
        keys = group_keys(match)
        proof = verify_group(linked_group(match))
        financial_failures += proof['outcome'] != 'match'
        legacy_matches += (match.explanation or {}).get('rule_version') != RULE_VERSION
        if keys in auto_expected and keys not in seen_auto and proof['outcome'] == 'match':
            seen_auto.add(keys)
        else:
            errors.append({'kind': 'false_positive', 'match_id': match.match_id,
                           'references': keys, 'reason': proof.get('notes', 'Incorrect or duplicate source-row membership')})
    correct_ex = 0
    breakdown = {name: {'expected': count, 'actual': 0, 'correct': 0, 'match': False}
                 for name, count in Counter(g['category'] for g in ex_expected.values()).items()}
    for exc in exceptions:
        keys = group_keys(exc)
        category = exc.category.value
        row = breakdown.setdefault(category, {'expected': 0, 'actual': 0, 'correct': 0, 'match': False})
        row['actual'] += 1
        target = ex_expected.get(keys)
        if target and target['category'] == category and keys not in seen_ex:
            correct_ex += 1
            row['correct'] += 1
            seen_ex.add(keys)
        else:
            errors.append({'kind': 'incorrect_exception', 'exception_id': exc.exception_id, 'references': keys, 'category': category})
    for row in breakdown.values():
        row['match'] = row['correct'] == row['expected'] == row['actual']
    for keys, event in auto_expected.items():
        if keys not in seen_auto:
            errors.append({'kind': 'false_negative', 'event_id': event['event_id'], 'references': keys})
    tp, fp, fn = len(seen_auto), len(matches) - len(seen_auto), len(auto_expected) - len(seen_auto)
    return {
        'evaluation_version': 'exact-source-sets-and-arithmetic-v2', 'rule_version': RULE_VERSION,
        'total_ground_truth_events': len(events), 'expected_groups': len(expected),
        'expected_auto_matches': len(auto_expected), 'actual_matches': len(matches),
        'true_positives': tp, 'false_positives': fp, 'false_negatives': fn,
        'match_precision': ratio(tp, tp + fp), 'match_recall': ratio(tp, tp + fn),
        'false_match_rate': ratio(fp, tp + fp), 'correct_exceptions': correct_ex,
        'incorrect_exceptions': len(exceptions) - correct_ex,
        'exception_recall': ratio(correct_ex, len(ex_expected)),
        'exception_precision': ratio(correct_ex, len(exceptions)),
        'exception_breakdown': breakdown, 'financial_validation_failures': financial_failures,
        'legacy_auto_matches': legacy_matches, 'match_count_correct': len(matches) == len(auto_expected),
        'dataset_aligned': not (missing or extra or repeated),
        'missing_source_refs': missing, 'unexpected_source_refs': extra, 'duplicate_source_refs': repeated,
        'all_checks_passed': not (fp or fn or len(exceptions) != correct_ex or correct_ex != len(ex_expected) or missing or extra or repeated),
        'errors': errors,
        'definition': 'Auto-match TP requires the exact complete source-row set and current arithmetic verification. Human decisions never inflate automatic precision. Null ratios mean no denominator.',
    }

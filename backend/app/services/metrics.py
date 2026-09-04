from collections import Counter, defaultdict
from app.models.db import Transaction, Match, MatchType, MatchStatus, Exception_, ExceptionStatus
from app.services.verification import RULE_VERSION


def calculate_metrics(session):
    transactions = session.query(Transaction).all()
    matches = session.query(Match).filter(Match.status.in_([MatchStatus.AUTO_MATCHED, MatchStatus.APPROVED])).all()
    exceptions = session.query(Exception_).all()
    identity = lambda row: frozenset(link.transaction_id for link in row.transactions)
    match_groups = {identity(row) for row in matches}
    ex_groups = {identity(row) for row in exceptions}
    auto = [row for row in matches if row.match_type in (MatchType.DETERMINISTIC, MatchType.FUZZY)]
    auto_groups = {identity(row) for row in auto}
    groups = match_groups | ex_groups
    auto_ids = {link.transaction_id for row in auto for link in row.transactions}
    unresolved = [row for row in exceptions if row.status != ExceptionStatus.RESOLVED]
    unresolved_ids = {link.transaction_id for row in unresolved for link in row.transactions}
    values = defaultdict(lambda: {'ledger_gross_paise': 0, 'auto_reconciled_paise': 0, 'requiring_review_paise': 0})
    for row in transactions:
        if row.source_type.value != 'ledger' or row.amount_minor_units <= 0:
            continue
        value = values[row.currency]
        value['ledger_gross_paise'] += row.amount_minor_units
        if row.record_id in auto_ids:
            value['auto_reconciled_paise'] += row.amount_minor_units
        if row.record_id in unresolved_ids:
            value['requiring_review_paise'] += row.amount_minor_units
    for value in values.values():
        value['monetary_coverage'] = round(value['auto_reconciled_paise'] / value['ledger_gross_paise'], 6) if value['ledger_gross_paise'] else None
    statuses = Counter(row.status.value for row in exceptions)
    return dict(total_transactions=len(transactions), total_matches=len(matches), total_exceptions=len(exceptions),
                total_groups=len(groups), auto_reconciled_groups=len(auto_groups), unresolved_groups=len({identity(row) for row in unresolved}),
                exceptions_open=statuses['open'], exceptions_in_review=statuses['in_review'],
                exceptions_resolved=statuses['resolved'], exceptions_reopened=statuses['reopened'],
                match_rate=round(len(match_groups)/len(groups), 6) if groups else 0,
                straight_through_rate=round(len(auto_groups)/len(groups), 6) if groups else 0,
                matches_by_type=dict(Counter(row.match_type.value for row in matches)),
                exceptions_by_category=dict(Counter(row.category.value for row in exceptions)),
                currency_values=dict(values), legacy_auto_matches=sum((row.explanation or {}).get('rule_version') != RULE_VERSION for row in auto),
                group_definition='Unique source-row sets; a reviewed exception and its human match count once.',
                monetary_definition='Positive merchant ledger gross, once per source record and currency. Not bank exposure; excludes bank-only orphan groups.')

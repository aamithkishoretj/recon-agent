"""
Deterministic + fuzzy matching engine.

Strategy: build a reference graph (which rows point at which natural keys),
union-find them into connected components, then classify each component:

  - complete group, amounts reconcile exactly       -> DETERMINISTIC match
  - complete group, amounts reconcile within a small
    tolerance (rounding)                              -> FUZZY match
  - complete group, duplicate rows detected           -> Exception: DUPLICATE
  - a leg of the group is missing                      -> Exception: MISSING_*
  - complete group, amounts don't reconcile and no
    known formula explains the gap                     -> Exception:
                                                            AMOUNT_DISCREPANCY

Nothing here calls an LLM. Every classification is fully deterministic and
reproducible — rerunning on unchanged data produces identical results.
Anything this layer can't confidently resolve is left for Phase 3 (AI
reasoning on ambiguous exceptions) — this module does not attempt to guess.
"""
from collections import defaultdict

from app.models.db import (
    Transaction, Match, MatchTransaction, Exception_, ExceptionTransaction,
    AuditLog, SourceType, MatchType, MatchStatus, ExceptionCategory,
    ExceptionStatus, TxnRole,
)
from app.services.ingestion import extract_refs

ROUNDING_TOLERANCE_PAISE = 5
DUPLICATE_CONFIDENCE = None  # duplicates are always an exception, never scored


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def build_groups(session):
    """Returns a list of groups, each a dict of {ledger: [...], settlement: [...], bank: [...]}
    of Transaction ORM objects, grouped by shared natural-key references."""
    txns = session.query(Transaction).all()

    uf = UnionFind()
    node_of = {}  # node_key -> Transaction

    def row_node(t):
        return f"ROW:{t.record_id}"

    for t in txns:
        node_of[row_node(t)] = t

        if t.source_type == SourceType.LEDGER and t.external_ref:
            ref_key = f"REF:{t.external_ref}"
            uf.union(row_node(t), ref_key)

        elif t.source_type == SourceType.SETTLEMENT:
            payment_ref = t.raw_payload.get("payment_ref", "")
            for tok in payment_ref.split(","):
                tok = tok.strip()
                if tok and extract_refs(tok) == [tok]:
                    uf.union(row_node(t), f"REF:{tok}")
            if t.batch_id:
                uf.union(row_node(t), f"REF:{t.batch_id}")

        elif t.source_type == SourceType.BANK:
            desc = t.raw_payload.get("description", "")
            for tok in extract_refs(desc):
                uf.union(row_node(t), f"REF:{tok}")

    groups = defaultdict(lambda: {"ledger": [], "settlement": [], "bank": []})
    for key, t in node_of.items():
        root = uf.find(key)
        bucket = {SourceType.LEDGER: "ledger", SourceType.SETTLEMENT: "settlement",
                  SourceType.BANK: "bank"}[t.source_type]
        groups[root][bucket].append(t)

    return list(groups.values())


def classify_group(group):
    from app.services.verification import verify_group
    return verify_group(group)


def persist_group_result(session, group, result):
    all_txns = [(t, TxnRole.LEDGER) for t in group["ledger"]] + \
               [(t, TxnRole.SETTLEMENT) for t in group["settlement"]] + \
               [(t, TxnRole.BANK) for t in group["bank"]]

    if result["outcome"] == "match":
        m = Match(
            match_type=result["match_type"],
            confidence=result["confidence"],
            status=MatchStatus.AUTO_MATCHED,
            explanation=result["explanation"],
        )
        session.add(m)
        session.flush()
        for t, role in all_txns:
            session.add(MatchTransaction(match_id=m.match_id, transaction_id=t.record_id, role=role))
        session.add(AuditLog(
            entity_type="match", entity_id=m.match_id, actor="system",
            action=f"{result['match_type'].value}_match",
            details={"confidence": result["confidence"], "n_transactions": len(all_txns), "evidence": result["explanation"]},
        ))
        return "match"

    else:
        priority = max((t.amount_minor_units for t in group["ledger"] + group["settlement"]
                         if t.amount_minor_units), default=0)
        e = Exception_(
            category=result["category"],
            priority_score=int(abs(priority) / 100),  # rough: rupee value as priority
            status=ExceptionStatus.OPEN,
            ai_hypothesis=None,
        )
        session.add(e)
        session.flush()
        for t, role in all_txns:
            session.add(ExceptionTransaction(exception_id=e.exception_id, transaction_id=t.record_id, role=role))
        session.add(AuditLog(
            entity_type="exception", entity_id=e.exception_id, actor="system",
            action="flagged", details={"category": result["category"].value, "notes": result["notes"], "evidence": result.get("explanation", {})},
        ))
        return "exception"


def run_matching(session):
    if session.query(Match).first() or session.query(Exception_).first():
        raise ValueError('Matching requires an unclassified database; existing decisions were preserved.')
    from app.services.candidates import recover_candidates
    groups = recover_candidates(build_groups(session))
    counts = {"match": 0, "exception": 0}
    for group, candidate_result in groups:
        result = candidate_result or classify_group(group)
        outcome = persist_group_result(session, group, result)
        counts[outcome] += 1
    session.commit()
    return counts, len(groups)

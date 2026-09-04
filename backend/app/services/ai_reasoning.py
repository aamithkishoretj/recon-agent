"""
AI reasoning layer — Phase 3.

Hard guardrail (per design decision): this layer NEVER creates a Match row
and NEVER resolves an exception on its own, regardless of how confident it
is. It only writes a structured hypothesis onto the Exception record and
flips its status to IN_REVIEW. Promoting a hypothesis into an actual Match
is exclusively a human action (Phase 5's review queue). This is what makes
"the AI proposes, it never decides" true in code, not just in the pitch.

Scope for this build: applied to AMOUNT_DISCREPANCY and AMBIGUOUS_CANDIDATE
exceptions. Amount cases ask whether numeric evidence supports a known
mechanism. Candidate cases ask the model to explain why identity is still
insufficient; the model is forbidden to choose a winner, and the existing
backend/UI candidate-approval block remains authoritative.

Data minimization: only numeric/timing evidence or an anonymized candidate
signal matrix is sent to the model — no customer_id, references, record IDs,
raw source rows, or other values that could identify a transaction.
"""
import json
import os
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import update

from app.models.db import (
    Exception_, ExceptionTransaction, Transaction, AuditLog,
    ExceptionCategory, ExceptionStatus, SourceType,
)

SUPPORTED_CATEGORIES = (
    ExceptionCategory.AMOUNT_DISCREPANCY,
    ExceptionCategory.AMBIGUOUS_CANDIDATE,
)


SYSTEM_PROMPT = """You are a financial reconciliation analyst assistant.

You will receive one of two minimized evidence payloads:
- amount_discrepancy: ledger, settlement, and bank totals plus fee/GST,
  refund, record-count, and timing evidence;
- ambiguous_candidate: anonymized candidate scores, boolean linkage signals,
  timing values, arithmetic status, and overlap counts.

For amount_discrepancy, determine whether the gap is explained by a KNOWN
mechanism using only the supplied evidence. For ambiguous_candidate, explain
which identity evidence is missing or tied. Never choose, rank, or name a
candidate winner; candidate identity cannot be resolved by language-model
judgment.

Strict rules:
- If the evidence does not clearly support an explanation, you MUST set
  resolved=false and confidence=0.0 to 0.3. Do NOT invent a plausible-
  sounding cause. An honest "insufficient evidence" is the correct and
  expected output when nothing in the evidence explains the gap.
- Never assume information you were not given (e.g. do not assume a refund
  happened unless the evidence shows one).
- For ambiguous_candidate payloads, always set resolved=false. Do not infer
  identity from amount, timing, score, or similarity alone.
- Your confidence must be justified by which evidence fields you actually
  used — cite them.
- Output must strictly follow the provided schema."""


class AIHypothesis(BaseModel):
    resolved: bool = Field(description="True only if you found a clear, evidence-backed explanation")
    confidence: float = Field(ge=0, le=1, description="0.0 to 1.0, must reflect actual evidence strength, not guesswork")
    explanation: str = Field(description="Your reasoning, or 'Insufficient evidence to explain this discrepancy' if unresolved")
    evidence_fields_used: list[str] = Field(description="Which specific evidence fields you relied on")
    suggested_category: Optional[str] = Field(
        default=None,
        description="If resolved, which category best fits: fee_error, gst_error, unlinked_refund, rounding, timing, other"
    )


def build_case_payload(session, exception: Exception_) -> dict:
    """Minimal-necessary evidence extraction for one exception — no PII, no raw rows."""
    links = session.query(ExceptionTransaction).filter_by(exception_id=exception.exception_id).all()
    txns = [session.get(Transaction, l.transaction_id) for l in links]

    ledger = [t for t in txns if t.source_type == SourceType.LEDGER]
    settlement = [t for t in txns if t.source_type == SourceType.SETTLEMENT]
    bank = [t for t in txns if t.source_type == SourceType.BANK]

    fee_total = sum(int(t.raw_payload.get("fee_paise", 0)) for t in settlement)
    gst_total = sum(int(t.raw_payload.get("gst_paise", 0)) for t in settlement)
    refund_total = sum(int((t.raw_payload or {}).get('refund_amount_paise', 0)) for t in ledger)

    return {
        "case_type": ExceptionCategory.AMOUNT_DISCREPANCY.value,
        "ledger_gross_amount_paise": sum(t.amount_minor_units for t in ledger),
        "settlement_net_amount_paise": sum(t.amount_minor_units for t in settlement),
        "bank_credit_total_paise": sum(t.amount_minor_units for t in bank),
        "known_fee_paise": fee_total,
        "known_gst_paise": gst_total,
        "merchant_declared_refunds_paise": refund_total,
        "expected_net_from_ledger_paise": sum(t.amount_minor_units for t in ledger) - fee_total - gst_total - refund_total,
        "difference_paise": sum(t.amount_minor_units for t in bank) - sum(t.amount_minor_units for t in settlement),
        "n_ledger_records": len(ledger),
        "n_settlement_records": len(settlement),
        "n_bank_records": len(bank),
        "timing_span_hours": round(
            (max(t.timestamp_utc for t in txns) - min(t.timestamp_utc for t in txns)).total_seconds() / 3600, 1
        ) if txns else None,
    }


def build_candidate_payload(session, exception: Exception_) -> dict:
    """Anonymized candidate matrix: no references, row IDs, PII, or raw data."""
    audit = session.query(AuditLog).filter_by(
        entity_type='exception', entity_id=exception.exception_id, action='flagged'
    ).order_by(AuditLog.created_at).first()
    evidence = ((audit.details or {}).get('evidence') or {}) if audit else {}
    candidates = evidence.get('candidates') if isinstance(evidence.get('candidates'), list) else []
    minimized = []
    memberships = []
    for index, candidate in enumerate(candidates):
        signals = candidate.get('signals') if isinstance(candidate.get('signals'), dict) else {}
        links = candidate.get('link_evidence') if isinstance(candidate.get('link_evidence'), dict) else {}
        arithmetic = candidate.get('arithmetic') if isinstance(candidate.get('arithmetic'), dict) else {}
        minimized.append({
            'candidate_number': index + 1,
            'rule_score': candidate.get('score'),
            'identity_verified': candidate.get('identity_verified') is True,
            'signals': {key: signals.get(key) for key in (
                'financial_arithmetic', 'settlement_window', 'bank_window',
                'ledger_identity', 'bank_identity', 'payment_method')},
            'link_evidence': {key: links.get(key) for key in (
                'exact_ledger_component', 'exact_bank_component', 'order_metadata_agrees',
                'customer_metadata_agrees', 'payment_method_agrees', 'payout_metadata_agrees',
                'batch_metadata_agrees', 'bank_order_metadata_agrees',
                'payment_reference_similarity', 'description_reference_similarity',
                'settlement_lag_hours', 'bank_lag_hours')},
            'financially_verified': arithmetic.get('financially_verified') is True,
        })
        record_ids = candidate.get('record_ids') if isinstance(candidate.get('record_ids'), dict) else {}
        memberships.append({value for source in ('ledger', 'settlement', 'bank')
                            for value in record_ids.get(source, []) if isinstance(value, str)})
    shared_counts = [len(memberships[left] & memberships[right])
                     for left in range(len(memberships)) for right in range(left + 1, len(memberships))]
    scores = sorted(
        [row['rule_score'] for row in minimized if isinstance(row['rule_score'], (int, float))],
        reverse=True,
    )
    return {
        'case_type': ExceptionCategory.AMBIGUOUS_CANDIDATE.value,
        'candidate_count': len(minimized),
        'auto_threshold_points': evidence.get('auto_threshold'),
        'minimum_margin_points': evidence.get('minimum_margin'),
        'top_score_gap_points': abs(scores[0] - scores[1]) if len(scores) >= 2 else None,
        'maximum_shared_source_records': max(shared_counts, default=0),
        'search_limit_reached': evidence.get('search_limit_reached') is True,
        'candidates': minimized,
    }


def evidence_payload(session, exception: Exception_) -> dict:
    if exception.category == ExceptionCategory.AMBIGUOUS_CANDIDATE:
        return build_candidate_payload(session, exception)
    return build_case_payload(session, exception)


def call_gemini(payload: dict) -> AIHypothesis:
    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not set. Run `setx GEMINI_API_KEY \"your-key\"` (Windows) "
            "or `export GEMINI_API_KEY=your-key` (Mac/Linux), then open a NEW terminal."
        )

    client = genai.Client(api_key=api_key)
    prompt = f"{SYSTEM_PROMPT}\n\nEvidence:\n{json.dumps(payload, indent=2)}"

    response = client.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": AIHypothesis},
    )
    return response.parsed


def call_mock(payload: dict) -> AIHypothesis:
    """
    Stand-in used when no API key is configured yet, so the pipeline wiring
    can be tested end to end without cost. Deliberately conservative — always
    declines, matching the correct behavior for our unexplained_discrepancy
    scenario. Swap to call_gemini() once GEMINI_API_KEY is set.
    """
    candidate_case = payload.get('case_type') == ExceptionCategory.AMBIGUOUS_CANDIDATE.value
    return AIHypothesis(
        resolved=False,
        confidence=0.1,
        explanation=(
            "[MOCK MODE — no model call] Candidate identity remains unresolved; compare the recorded linkage evidence and obtain a definitive source reference."
            if candidate_case else
            "[MOCK MODE — no model call] Insufficient evidence to explain this discrepancy."
        ),
        evidence_fields_used=[],
        suggested_category='candidate_ambiguity' if candidate_case else None,
    )


def get_ai_hypothesis(payload: dict) -> AIHypothesis:
    if os.environ.get('RECON_AI_MODE') != 'mock' and os.environ.get("GEMINI_API_KEY"):
        return call_gemini(payload)
    return call_mock(payload)


def apply_ai_reasoning(session, categories=SUPPORTED_CATEGORIES):
    """
    Runs the AI reasoning layer over all OPEN supported exceptions.
    Writes a hypothesis + moves status to IN_REVIEW. Never creates a Match.
    """
    categories = tuple(categories)
    exceptions = session.query(Exception_).filter(
        Exception_.category.in_(categories), Exception_.status == ExceptionStatus.OPEN
    ).order_by(Exception_.exception_id).all()

    processed = {"resolved_hypothesis": 0, "declined_hypothesis": 0}
    processed_by_category = {category.value: 0 for category in categories}

    for exc in exceptions:
        payload = evidence_payload(session, exc)
        hypothesis = get_ai_hypothesis(payload)

        # Candidate identity is never delegated to the model, even if a provider
        # violates the prompt and returns resolved=true.
        if exc.category == ExceptionCategory.AMBIGUOUS_CANDIDATE and hypothesis.resolved:
            hypothesis = AIHypothesis(
                resolved=False, confidence=min(hypothesis.confidence, 0.3),
                explanation='Candidate identity remains unresolved. AI output cannot select a source assignment.',
                evidence_fields_used=hypothesis.evidence_fields_used,
                suggested_category='candidate_ambiguity',
            )

        hypothesis_data = {
            "resolved": hypothesis.resolved,
            "confidence": hypothesis.confidence,
            "explanation": hypothesis.explanation,
            "evidence_fields_used": hypothesis.evidence_fields_used,
            "suggested_category": hypothesis.suggested_category,
            "analysis_kind": payload['case_type'],
            "evidence_sent": payload,
        }
        claimed = session.execute(update(Exception_).where(
            Exception_.exception_id == exc.exception_id, Exception_.status == ExceptionStatus.OPEN
        ).values(ai_hypothesis=hypothesis_data, status=ExceptionStatus.IN_REVIEW),
            execution_options={'synchronize_session': False})
        if claimed.rowcount != 1:
            continue  # Human review won the race while the model was responding.

        session.add(AuditLog(
            entity_type="exception", entity_id=exc.exception_id, actor="ai",
            action="ai_reasoning_applied",
            details={"resolved": hypothesis.resolved, "confidence": hypothesis.confidence,
                     "analysis_kind": payload['case_type']},
        ))

        if hypothesis.resolved:
            processed["resolved_hypothesis"] += 1
        else:
            processed["declined_hypothesis"] += 1
        processed_by_category[exc.category.value] += 1

    session.commit()
    return processed, sum(processed.values()), processed_by_category

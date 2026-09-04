"""API-facing schemas. Kept separate from the DB models (app/models/db.py)
so the wire format can evolve independently of the storage schema."""
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class TransactionOut(BaseModel):
    record_id: str
    source_type: str
    external_ref: Optional[str]
    amount_minor_units: int
    currency: str
    timestamp_utc: datetime
    status: str
    role: str  # role within this specific match/exception grouping


class MatchOut(BaseModel):
    match_id: str
    match_type: str
    confidence: float
    status: str
    explanation: Optional[dict]
    created_at: datetime
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    transactions: list[TransactionOut]


class ExceptionOut(BaseModel):
    exception_id: str
    category: str
    priority_score: int
    status: str
    ai_hypothesis: Optional[dict]
    created_at: datetime
    resolved_at: Optional[datetime]
    transactions: list[TransactionOut]
    system_evidence: Optional[dict] = None


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    reviewer_name: str = Field(min_length=1, max_length=100)
    notes: str = Field(min_length=1, max_length=4000)
    expected_status: Literal['open', 'in_review', 'reopened']

    @field_validator('reviewer_name', 'notes')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('A non-blank value is required')
        return value.strip()


class ReviewResponse(BaseModel):
    exception_id: str
    new_status: str
    created_match_id: Optional[str] = None


class MetricsOut(BaseModel):
    total_transactions: int
    total_matches: int
    total_exceptions: int
    exceptions_open: int
    exceptions_in_review: int
    exceptions_resolved: int
    match_rate: float  # matches / (matches + exceptions), as a fraction of groups
    straight_through_rate: float  # matches resolved with zero human input
    matches_by_type: dict[str, int]
    exceptions_by_category: dict[str, int]
    total_groups: int
    auto_reconciled_groups: int
    unresolved_groups: int
    exceptions_reopened: int
    currency_values: dict[str, dict]
    legacy_auto_matches: int
    group_definition: str
    monetary_definition: str


# ---------- New Phase 6 schemas ----------

class AuditLogOut(BaseModel):
    audit_id: str
    entity_type: str
    entity_id: str
    actor: str
    action: str
    details: Optional[dict]
    created_at: datetime


class ExceptionEvalRow(BaseModel):
    expected: int
    actual: int
    match: bool
    correct: int = 0


class EvalScoresOut(BaseModel):
    total_ground_truth_events: int
    expected_auto_matches: int
    actual_matches: int
    match_precision: Optional[float]
    match_count_correct: bool
    exception_breakdown: dict[str, ExceptionEvalRow]
    evaluation_version: str
    rule_version: str
    expected_groups: int
    true_positives: int
    false_positives: int
    false_negatives: int
    match_recall: Optional[float]
    false_match_rate: Optional[float]
    correct_exceptions: int
    incorrect_exceptions: int
    exception_recall: Optional[float]
    exception_precision: Optional[float]
    financial_validation_failures: int
    legacy_auto_matches: int
    dataset_aligned: bool
    missing_source_refs: list
    unexpected_source_refs: list
    duplicate_source_refs: int
    all_checks_passed: bool
    errors: list[dict]
    definition: str


class AIReasoningRunOut(BaseModel):
    mode: str           # "live" or "mock"
    total_processed: int
    resolved_hypothesis: int
    declined_hypothesis: int
    processed_by_category: dict[str, int]
    message: str


class CSVSourceIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=2_000_000)


class ImportPreviewRequest(BaseModel):
    ledger: CSVSourceIn
    settlement: CSVSourceIn
    bank: CSVSourceIn


class ImportRunOut(BaseModel):
    run_id: str
    status: str
    sources: dict[str, dict]
    report: Optional[dict] = None

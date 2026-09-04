"""
Database models for the reconciliation engine.

Design notes (mirrors the architecture doc):
- transactions holds the canonical normalized record from any of the 3 sources.
- matches is deliberately N:M with transactions via match_transactions, because a
  match can be N:1 (batching), 1:N (refund split), or N:M (ambiguous candidate sets).
- exceptions is the same shape via exception_transactions.
- audit_log is append-only. Never update a row in this table, only insert.
- ground_truth is intentionally NOT here — it lives in a separate module
  (evaluation/ground_truth.py) so the matching pipeline can never accidentally
  read it.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, BigInteger, Float, Integer, Text, DateTime,
    Enum as SAEnum, ForeignKey, JSON, create_engine
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()


def gen_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Enums ----------

class SourceType(str, enum.Enum):
    LEDGER = "ledger"
    SETTLEMENT = "settlement"
    BANK = "bank"


class TxnStatus(str, enum.Enum):
    CAPTURED = "captured"
    FAILED = "failed"
    AUTHORIZED = "authorized"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"
    REVERSED = "reversed"


class MatchType(str, enum.Enum):
    DETERMINISTIC = "deterministic"
    FUZZY = "fuzzy"
    AI = "ai"
    HUMAN = "human"


class MatchStatus(str, enum.Enum):
    AUTO_MATCHED = "auto_matched"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class ExceptionCategory(str, enum.Enum):
    MISSING_LEDGER = "missing_ledger"
    MISSING_SETTLEMENT = "missing_settlement"
    MISSING_BANK_CREDIT = "missing_bank_credit"
    DUPLICATE = "duplicate"
    AMOUNT_DISCREPANCY = "amount_discrepancy"
    TIMING_DISCREPANCY = "timing_discrepancy"
    UNKNOWN_ADJUSTMENT = "unknown_adjustment"
    AMBIGUOUS_CANDIDATE = "ambiguous_candidate"
    REFUND_MISMATCH = "refund_mismatch"
    CURRENCY_MISMATCH = "currency_mismatch"


class ExceptionStatus(str, enum.Enum):
    OPEN = "open"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    REOPENED = "reopened"


class UserRole(str, enum.Enum):
    VIEWER = "viewer"
    ANALYST = "analyst"
    MANAGER = "manager"


class TxnRole(str, enum.Enum):
    """Role a transaction plays within a match or exception grouping."""
    LEDGER = "ledger"
    SETTLEMENT = "settlement"
    BANK = "bank"
    CANDIDATE = "candidate"


# ---------- Core tables ----------

class Transaction(Base):
    __tablename__ = "transactions"

    record_id = Column(String, primary_key=True, default=gen_uuid)
    source_type = Column(SAEnum(SourceType), nullable=False)
    external_ref = Column(String, nullable=True, index=True)
    order_id = Column(String, nullable=True, index=True)
    customer_id = Column(String, nullable=True)
    amount_minor_units = Column(BigInteger, nullable=False)  # paise, never float
    currency = Column(String, default="INR", nullable=False)
    timestamp_utc = Column(DateTime, nullable=False, index=True)
    status = Column(SAEnum(TxnStatus), nullable=False)
    batch_id = Column(String, nullable=True, index=True)
    raw_payload = Column(JSON, nullable=True)  # untouched original record
    created_at = Column(DateTime, default=utcnow)

    match_links = relationship("MatchTransaction", back_populates="transaction")
    exception_links = relationship("ExceptionTransaction", back_populates="transaction")


class Match(Base):
    __tablename__ = "matches"

    match_id = Column(String, primary_key=True, default=gen_uuid)
    match_type = Column(SAEnum(MatchType), nullable=False)
    confidence = Column(Float, nullable=False)
    status = Column(SAEnum(MatchStatus), nullable=False, default=MatchStatus.AUTO_MATCHED)
    explanation = Column(JSON, nullable=True)
    # explanation shape: {gross_amount, fee, gst, expected_settlement,
    #   observed_settlement, timing_delta_hours, evidence_fields: [...]}
    reviewed_by = Column(String, ForeignKey("users.user_id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    transactions = relationship("MatchTransaction", back_populates="match")


class MatchTransaction(Base):
    """Junction table: which transactions belong to which match, and in what role."""
    __tablename__ = "match_transactions"

    id = Column(String, primary_key=True, default=gen_uuid)
    match_id = Column(String, ForeignKey("matches.match_id"), nullable=False)
    transaction_id = Column(String, ForeignKey("transactions.record_id"), nullable=False)
    role = Column(SAEnum(TxnRole), nullable=False)

    match = relationship("Match", back_populates="transactions")
    transaction = relationship("Transaction", back_populates="match_links")


class Exception_(Base):
    __tablename__ = "exceptions"

    exception_id = Column(String, primary_key=True, default=gen_uuid)
    category = Column(SAEnum(ExceptionCategory), nullable=False)
    priority_score = Column(Integer, default=0)  # derived from $ value, age, type
    status = Column(SAEnum(ExceptionStatus), nullable=False, default=ExceptionStatus.OPEN)
    ai_hypothesis = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime, nullable=True)

    transactions = relationship("ExceptionTransaction", back_populates="exception")


class ExceptionTransaction(Base):
    __tablename__ = "exception_transactions"

    id = Column(String, primary_key=True, default=gen_uuid)
    exception_id = Column(String, ForeignKey("exceptions.exception_id"), nullable=False)
    transaction_id = Column(String, ForeignKey("transactions.record_id"), nullable=False)
    role = Column(SAEnum(TxnRole), nullable=False)

    exception = relationship("Exception_", back_populates="transactions")
    transaction = relationship("Transaction", back_populates="exception_links")


class AuditLog(Base):
    """Append-only. Never update, only insert."""
    __tablename__ = "audit_log"

    audit_id = Column(String, primary_key=True, default=gen_uuid)
    entity_type = Column(String, nullable=False)  # "match" | "exception"
    entity_id = Column(String, nullable=False, index=True)
    actor = Column(String, nullable=False)  # "system" | "ai" | user_id
    action = Column(String, nullable=False)  # e.g. "auto_matched", "flagged", "approved"
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.ANALYST)


# ---------- Engine / session helpers ----------

def get_engine(db_path: str = "sqlite:///./data/recon.db"):
    return create_engine(db_path, connect_args={"check_same_thread": False})


def init_db(engine):
    Base.metadata.create_all(engine)


def get_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)

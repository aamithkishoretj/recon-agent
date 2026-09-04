"""
FastAPI backend for the reconciliation engine.

Run with:
    uvicorn app.main:app --reload --port 8000
(from the backend/ directory, with venv active)

Endpoints:
    GET  /health
    GET  /matches
    GET  /matches/{match_id}
    GET  /exceptions
    GET  /exceptions/{exception_id}
    POST /exceptions/{exception_id}/review
    GET  /metrics
    POST /run-ai-reasoning        (Phase 6)
    GET  /audit-log               (Phase 6)
    GET  /eval-scores             (Phase 6)
"""
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app.models.db import (
    AuditLog, Exception_, ExceptionStatus, ExceptionTransaction,
    Match, MatchStatus, MatchTransaction, MatchType, Transaction, User,
    UserRole, ExceptionCategory, get_engine, get_session_factory, init_db,
)
from app.schemas import (
    AuditLogOut, AIReasoningRunOut, EvalScoresOut, ExceptionEvalRow,
    ExceptionOut, MatchOut, MetricsOut, ReviewRequest, ReviewResponse,
    TransactionOut, ImportPreviewRequest, ImportRunOut,
)

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.environ.get('RECON_DATA_DIR', f'{BACKEND_DIR}/data')
DB_PATH = os.environ.get('RECON_DB_PATH', f'{DATA_DIR}/recon.db')
GROUND_TRUTH_PATH = f'{DATA_DIR}/ground_truth.json'
IMPORT_ROOT = os.environ.get('RECON_IMPORT_ROOT', f'{BACKEND_DIR}/import-runs')

app = FastAPI(title="Reconciliation Engine API")

# Wide open for hackathon dev — the React frontend runs on a different port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_engine = get_engine(f"sqlite:///{DB_PATH}")
_Session = get_session_factory(_engine)
_database_lock = Lock()
_retired_engines = []
_active_run_id = None


@app.on_event("startup")
def on_startup():
    init_db(_engine)


def get_db():
    with _database_lock:
        factory = _Session
    db = factory()
    try:
        yield db
    finally:
        db.close()


def activate_database(run_dir, run_id):
    """Atomically route new requests to a successfully completed isolated run."""
    global _engine, _Session, DATA_DIR, DB_PATH, GROUND_TRUTH_PATH, _active_run_id
    run_dir = Path(run_dir)
    new_path = run_dir / 'recon.db'
    new_engine = get_engine(f'sqlite:///{new_path}')
    init_db(new_engine)
    new_session = get_session_factory(new_engine)
    with _database_lock:
        _retired_engines.append(_engine)  # Existing request sessions may still use it.
        _engine, _Session = new_engine, new_session
        DATA_DIR, DB_PATH = str(run_dir), str(new_path)
        GROUND_TRUTH_PATH = str(run_dir / 'ground_truth.json')
        _active_run_id = run_id


def get_or_create_user(db, name: str) -> User:
    user = db.query(User).filter_by(name=name).first()
    if user:
        return user
    user = User(name=name, role=UserRole.ANALYST)
    db.add(user)
    db.flush()
    return user


def serialize_transactions(db, junction_rows) -> list[TransactionOut]:
    out = []
    for link in junction_rows:
        t = db.get(Transaction, link.transaction_id)
        out.append(TransactionOut(
            record_id=t.record_id, source_type=t.source_type.value,
            external_ref=t.external_ref, amount_minor_units=t.amount_minor_units,
            currency=t.currency, timestamp_utc=t.timestamp_utc, status=t.status.value,
            role=link.role.value,
        ))
    return out


# ---------- Health ----------

@app.get("/health")
def health():
    return {"status": "ok", "active_run_id": _active_run_id}


@app.get('/demo-cases')
def demo_cases():
    """Presentation metadata for an explicitly prepared showcase dataset."""
    manifest = Path(DATA_DIR) / 'demo_cases.json'
    if not manifest.exists():
        return {'available': False, 'cases': []}
    try:
        payload = json.loads(manifest.read_text(encoding='utf-8'))
        if not isinstance(payload, dict) or not isinstance(payload.get('cases'), list):
            raise ValueError('invalid showcase manifest shape')
        return payload
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(422, 'Invalid showcase manifest: ' + str(error)) from error


# ---------- Isolated CSV import runs ----------

@app.post('/import-runs/preview', response_model=ImportRunOut)
def preview_import(body: ImportPreviewRequest):
    from app.services.import_runs import stage_run
    try:
        return stage_run(IMPORT_ROOT, {source: getattr(body, source).model_dump() for source in ('ledger', 'settlement', 'bank')})
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.get('/import-runs/{run_id}', response_model=ImportRunOut)
def get_import_run(run_id: str):
    from app.services.import_runs import safe_run_dir, read_metadata
    try:
        return read_metadata(safe_run_dir(IMPORT_ROOT, run_id))
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error


@app.post('/import-runs/{run_id}/reconcile', response_model=ImportRunOut)
def reconcile_import(run_id: str):
    from app.services.import_runs import execute_run
    try:
        metadata, run_dir = execute_run(IMPORT_ROOT, run_id)
        activate_database(run_dir, run_id)
        return metadata
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    except Exception as error:
        raise HTTPException(422, 'Reconciliation failed: ' + str(error)) from error


# ---------- Matches ----------

@app.get("/matches", response_model=list[MatchOut])
def list_matches(
    match_type: MatchType | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    q = db.query(Match)
    if match_type:
        q = q.filter(Match.match_type == MatchType(match_type))
    matches = q.order_by(Match.created_at.desc(), Match.match_id).offset(offset).limit(limit).all()

    result = []
    for m in matches:
        links = db.query(MatchTransaction).filter_by(match_id=m.match_id).all()
        result.append(MatchOut(
            match_id=m.match_id, match_type=m.match_type.value, confidence=m.confidence,
            status=m.status.value, explanation=m.explanation, created_at=m.created_at,
            reviewed_by=m.reviewed_by, reviewed_at=m.reviewed_at,
            transactions=serialize_transactions(db, links),
        ))
    return result


@app.get("/matches/{match_id}", response_model=MatchOut)
def get_match(match_id: str, db=Depends(get_db)):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    links = db.query(MatchTransaction).filter_by(match_id=m.match_id).all()
    return MatchOut(
        match_id=m.match_id, match_type=m.match_type.value, confidence=m.confidence,
        status=m.status.value, explanation=m.explanation, created_at=m.created_at,
        reviewed_by=m.reviewed_by, reviewed_at=m.reviewed_at,
        transactions=serialize_transactions(db, links),
    )


# ---------- Exceptions ----------

@app.get("/exceptions", response_model=list[ExceptionOut])
def list_exceptions(
    status: ExceptionStatus | None = Query(None),
    category: ExceptionCategory | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    q = db.query(Exception_)
    if status:
        q = q.filter(Exception_.status == ExceptionStatus(status))
    if category:
        q = q.filter(Exception_.category == category)
    exceptions = q.order_by(Exception_.priority_score.desc(), Exception_.exception_id).offset(offset).limit(limit).all()

    result = []
    for e in exceptions:
        links = db.query(ExceptionTransaction).filter_by(exception_id=e.exception_id).all()
        result.append(ExceptionOut(
            exception_id=e.exception_id, category=e.category.value,
            priority_score=e.priority_score, status=e.status.value,
            ai_hypothesis=e.ai_hypothesis, created_at=e.created_at,
            resolved_at=e.resolved_at, transactions=serialize_transactions(db, links), system_evidence=system_evidence(db, e.exception_id),
        ))
    return result


@app.get("/exceptions/{exception_id}", response_model=ExceptionOut)
def get_exception(exception_id: str, db=Depends(get_db)):
    e = db.get(Exception_, exception_id)
    if not e:
        raise HTTPException(404, "Exception not found")
    links = db.query(ExceptionTransaction).filter_by(exception_id=e.exception_id).all()
    return ExceptionOut(
        exception_id=e.exception_id, category=e.category.value,
        priority_score=e.priority_score, status=e.status.value,
        ai_hypothesis=e.ai_hypothesis, created_at=e.created_at,
        resolved_at=e.resolved_at, transactions=serialize_transactions(db, links), system_evidence=system_evidence(db, e.exception_id),
    )


# ---------- Human review ----------

def system_evidence(db, exception_id):
    entry = db.query(AuditLog).filter_by(entity_id=exception_id, entity_type='exception', action='flagged').order_by(AuditLog.created_at).first()
    return entry.details if entry else None

@app.post("/exceptions/{exception_id}/review", response_model=ReviewResponse)
def review_exception(exception_id: str, body: ReviewRequest, db=Depends(get_db)):
    from app.services.verification import linked_group, verify_group
    exc = db.get(Exception_, exception_id)
    if not exc:
        raise HTTPException(404, "Exception not found")
    if exc.status.value != body.expected_status or exc.status == ExceptionStatus.RESOLVED:
        raise HTTPException(409, "Case changed since it was loaded. Refresh before reviewing.")
    original_evidence = system_evidence(db, exception_id) or {}
    if body.action == 'approve' and (exc.category == ExceptionCategory.AMBIGUOUS_CANDIDATE or
            (original_evidence.get('evidence') or {}).get('candidate_review_required')):
        raise HTTPException(409, 'Candidate identity is unresolved. Correct the linking evidence and rerun; approving all alternatives as one match is unsafe.')
    proof = verify_group(linked_group(exc))
    if body.action == 'approve' and proof['outcome'] != 'match':
        raise HTTPException(409, "Cannot approve an unverified match: " + proof['notes'] + " Correct the source evidence first.")
    old_status = exc.status
    new_status = ExceptionStatus.RESOLVED if body.action == 'approve' else ExceptionStatus.REOPENED
    if old_status == new_status:
        raise HTTPException(409, "This case is already reopened and unresolved.")
    now = datetime.now(timezone.utc)
    # Compare-and-swap claims the review before any user, match or audit write.
    claimed = db.execute(update(Exception_).where(Exception_.exception_id == exception_id,
                         Exception_.status == old_status).values(status=new_status,
                         resolved_at=now if body.action == 'approve' else None),
                         execution_options={'synchronize_session': False})
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Another reviewer changed this case. Refresh.")
    reviewer = get_or_create_user(db, body.reviewer_name)
    created_match_id = None
    if body.action == 'approve':
        ids = [link.transaction_id for link in exc.transactions]
        overlap = db.query(MatchTransaction).join(Match).filter(MatchTransaction.transaction_id.in_(ids),
                  Match.status.in_([MatchStatus.AUTO_MATCHED, MatchStatus.APPROVED])).first()
        if overlap:
            db.rollback()
            raise HTTPException(409, "A source record is already part of an accepted match.")
        explanation = dict(proof['explanation'], source_exception_id=exception_id,
                           human_notes=body.notes, original_hypothesis=exc.ai_hypothesis)
        match = Match(match_type=MatchType.HUMAN, confidence=proof['confidence'],
                      status=MatchStatus.APPROVED, explanation=explanation,
                      reviewed_by=reviewer.user_id, reviewed_at=now)
        db.add(match)
        db.flush()
        for link in exc.transactions:
            db.add(MatchTransaction(match_id=match.match_id, transaction_id=link.transaction_id, role=link.role))
        created_match_id = match.match_id
        db.add(AuditLog(entity_type='match', entity_id=match.match_id, actor=reviewer.name,
                       action='human_approved', details={'source_exception_id': exception_id, 'evidence': explanation}))
    db.add(AuditLog(entity_type='exception', entity_id=exception_id, actor=reviewer.name,
        action='human_approved' if body.action == 'approve' else 'human_rejected',
        details={'notes': body.notes, 'created_match_id': created_match_id,
                 'old_status': old_status.value, 'new_status': new_status.value,
                 'original_hypothesis': exc.ai_hypothesis, 'verification': proof['explanation']}))
    db.commit()
    return ReviewResponse(exception_id=exception_id, new_status=new_status.value, created_match_id=created_match_id)


@app.get("/metrics", response_model=MetricsOut)
def metrics(db=Depends(get_db)):
    from app.services.metrics import calculate_metrics
    return calculate_metrics(db)


# ---------- Phase 6: AI Reasoning trigger ----------

@app.post("/run-ai-reasoning", response_model=AIReasoningRunOut)
def run_ai_reasoning(db=Depends(get_db)):
    """
    Triggers AI assistance for OPEN amount and ambiguous-candidate exceptions.
    The AI writes a hypothesis + moves status to IN_REVIEW.
    It NEVER creates a Match — that requires human approval.
    """
    from app.services.ai_reasoning import apply_ai_reasoning

    processed, total, by_category = apply_ai_reasoning(db)
    mode = "live" if os.environ.get('RECON_AI_MODE') != 'mock' and os.environ.get("GEMINI_API_KEY") else "mock"

    return AIReasoningRunOut(
        mode=mode,
        total_processed=total,
        resolved_hypothesis=processed["resolved_hypothesis"],
        declined_hypothesis=processed["declined_hypothesis"],
        processed_by_category=by_category,
        message=(
            f"AI processed {total} supported exceptions in {mode.upper()} mode "
            f"({by_category.get('amount_discrepancy', 0)} amount discrepancies, "
            f"{by_category.get('ambiguous_candidate', 0)} ambiguous candidates). "
            f"{processed['resolved_hypothesis']} explainable, "
            f"{processed['declined_hypothesis']} declined (insufficient evidence). "
            f"All are now IN_REVIEW — human approval required to create a Match."
        ),
    )


# ---------- Phase 6: Audit Log ----------

@app.get("/audit-log", response_model=list[AuditLogOut])
def list_audit_log(
    entity_id: str | None = Query(None),
    entity_type: str | None = Query(None),
    actor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    q = db.query(AuditLog)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if actor:
        q = q.filter(AuditLog.actor == actor)
    logs = q.order_by(AuditLog.created_at.desc(), AuditLog.audit_id).offset(offset).limit(limit).all()
    return [
        AuditLogOut(
            audit_id=l.audit_id, entity_type=l.entity_type, entity_id=l.entity_id,
            actor=l.actor, action=l.action, details=l.details, created_at=l.created_at,
        )
        for l in logs
    ]


# ---------- Phase 6: Eval Scores ----------

@app.get("/eval-scores", response_model=EvalScoresOut)
def eval_scores(db=Depends(get_db)):
    from app.services.evaluation import evaluate
    try:
        with open(GROUND_TRUTH_PATH, encoding='utf-8') as handle:
            truth = json.load(handle)
        return evaluate(db, truth)
    except FileNotFoundError:
        raise HTTPException(404, 'No ground truth is configured for this dataset.')
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(422, 'Invalid ground truth: ' + str(error))

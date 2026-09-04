"""Run the deterministic pipeline into a brand-new database."""
import json
from pathlib import Path
from time import perf_counter

from app.models.db import get_engine, init_db, get_session_factory, Exception_, ExceptionStatus
from app.services.ingestion import ingest_all
from app.services.matching import run_matching
from app.services.metrics import calculate_metrics


def run(data_dir, db_path):
    data_dir, db_path = Path(data_dir), Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with db_path.open('x'):
        pass  # Exclusive creation: existing databases are never overwritten.
    engine = get_engine('sqlite:///' + str(db_path))
    try:
        init_db(engine)
        with get_session_factory(engine)() as session:
            started = perf_counter()
            ingested = ingest_all(session, str(data_dir))
            counts, groups = run_matching(session)
            elapsed = perf_counter() - started
            report = {
                'ingested': ingested, 'results': counts, 'groups': groups,
                'elapsed_seconds': round(elapsed, 6),
                'records_per_second': round(sum(ingested.values()) / elapsed, 2),
                'metrics': calculate_metrics(session),
            }
            from app.services.evaluation import evaluate, group_keys
            truth_path = data_dir / 'ground_truth.json'
            report['evaluation'] = evaluate(session, json.loads(truth_path.read_text(encoding='utf-8'))) if truth_path.exists() else None
            report['unresolved_exceptions'] = [
                {'exception_id': exc.exception_id, 'category': exc.category.value,
                 'status': exc.status.value, 'references': group_keys(exc)}
                for exc in session.query(Exception_).all() if exc.status != ExceptionStatus.RESOLVED
            ]
            return report
    finally:
        engine.dispose()

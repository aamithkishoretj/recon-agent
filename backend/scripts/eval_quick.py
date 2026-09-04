"""Read-only exact-source-set and arithmetic evaluation against synthetic truth."""
import argparse
import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.models.db import get_engine, get_session_factory
from app.services.evaluation import evaluate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=BACKEND / 'data' / 'recon.db')
    parser.add_argument('--truth', type=Path, default=BACKEND / 'data' / 'ground_truth.json')
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('Database does not exist; nothing was created.')
    engine = get_engine('sqlite:///' + str(args.db))
    try:
        with get_session_factory(engine)() as session:
            result = evaluate(session, json.loads(args.truth.read_text(encoding='utf-8')))
            print(json.dumps(result, indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()

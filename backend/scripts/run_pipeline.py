"""Reconcile into a NEW database; never delete existing data or decisions."""
import argparse
import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.services.pipeline import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=BACKEND / 'data')
    parser.add_argument('--db', type=Path, default=BACKEND / 'data' / 'recon.db')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.report and args.report.exists():
        parser.error('Report already exists; preserved unchanged. Choose a new --report path.')
    try:
        report = run(args.data_dir, args.db)
    except FileExistsError:
        parser.error('Database already exists; preserved unchanged. Choose a new --db path.')
    if args.report:
        with args.report.open('x', encoding='utf-8') as handle:
            json.dump(report, handle, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

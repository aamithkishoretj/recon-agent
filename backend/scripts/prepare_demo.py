"""Create a fresh, isolated all-scenario demo. Does not call AI or reset live data."""
import argparse
from datetime import datetime
import json
from pathlib import Path

from generate_synthetic_data import Generator
from run_pipeline import run, BACKEND


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=200)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--outdir', type=Path)
    args = parser.parse_args()
    if args.count < len(Generator.SCENARIO_FUNCS):
        parser.error(f'Use at least {len(Generator.SCENARIO_FUNCS)} events to include every scenario.')
    outdir = args.outdir or BACKEND / 'demo-runs' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    outdir.mkdir(parents=True, exist_ok=False)
    generator = Generator(args.seed)
    for scenario in Generator.SCENARIO_FUNCS.values():
        scenario(generator)
    generator.generate(args.count - len(Generator.SCENARIO_FUNCS))
    generator.write(str(outdir))
    report = run(outdir, outdir / 'recon.db')
    with (outdir / 'report.json').open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({'data_dir': str(outdir), 'db_path': str(outdir / 'recon.db'),
                     'report': str(outdir / 'report.json'), 'records': sum(report['ingested'].values()),
                     'evaluation': report['evaluation'], 'elapsed_seconds': report['elapsed_seconds']}))


if __name__ == '__main__':
    main()

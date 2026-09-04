"""CSV import workflow tests. All files and databases are disposable."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / 'scripts'))

from app.services.import_runs import execute_run, safe_run_dir, stage_run, validate_source
from generate_synthetic_data import Generator


class ImportRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / 'generated'
        source.mkdir()
        generator = Generator(42)
        generator.scenario_exact_match()
        generator.write(source)
        self.files = {name: {'filename': f'{name}.csv', 'content': (source / f'{name}.csv').read_text(encoding='utf-8')}
                      for name in ('ledger', 'settlement', 'bank')}
        self.imports = self.root / 'imports'

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_three_source_run_is_staged_and_reconciled_in_isolation(self):
        staged = stage_run(self.imports, self.files)
        self.assertEqual(staged['status'], 'uploaded')
        self.assertEqual({key: value['rows'] for key, value in staged['sources'].items()},
                         {'ledger': 1, 'settlement': 1, 'bank': 1})
        completed, run_dir = execute_run(self.imports, staged['run_id'])
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(completed['report']['results'], {'match': 1, 'exception': 0})
        self.assertTrue((run_dir / 'recon.db').is_file())
        self.assertTrue((run_dir / 'report.json').is_file())
        self.assertIsNone(completed['report']['evaluation'])

    def test_invalid_uploads_are_rejected_before_a_run_folder_is_created(self):
        invalid = dict(self.files)
        invalid['bank'] = {'filename': 'bank.csv', 'content': 'bank_ref,value_date\nB-1,2026-01-01T00:00:00Z\n'}
        with self.assertRaisesRegex(ValueError, 'missing required columns'):
            stage_run(self.imports, invalid)
        self.assertFalse(self.imports.exists())

    def test_row_errors_name_the_source_and_csv_row(self):
        text = self.files['ledger']['content'].replace(',captured,', ',unknown_status,')
        with self.assertRaisesRegex(ValueError, 'Ledger row 2'):
            validate_source('ledger', 'ledger.csv', text)

    def test_names_paths_sizes_and_duplicate_headers_are_bounded(self):
        with self.assertRaisesRegex(ValueError, 'plain .csv'):
            validate_source('bank', '../bank.csv', self.files['bank']['content'])
        with self.assertRaisesRegex(ValueError, 'duplicate column'):
            validate_source('bank', 'bank.csv', 'bank_ref,bank_ref,credit_amount,value_date,description\na,b,1,2026-01-01T00:00:00Z,x\n')
        with self.assertRaisesRegex(ValueError, '2 MB'):
            validate_source('bank', 'bank.csv', self.files['bank']['content'] + ('x' * 2_000_000))

    def test_run_ids_cannot_escape_the_import_root(self):
        for value in ('../data', 'not-a-uuid', ''):
            with self.subTest(value=value), self.assertRaises(ValueError):
                safe_run_dir(self.imports, value)

    def test_completed_run_cannot_overwrite_or_run_twice(self):
        staged = stage_run(self.imports, self.files)
        execute_run(self.imports, staged['run_id'])
        before = (self.imports / staged['run_id'] / 'recon.db').read_bytes()
        with self.assertRaisesRegex(ValueError, 'already started or completed'):
            execute_run(self.imports, staged['run_id'])
        self.assertEqual(before, (self.imports / staged['run_id'] / 'recon.db').read_bytes())
        metadata = json.loads((self.imports / staged['run_id'] / 'metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(metadata['status'], 'completed')


if __name__ == '__main__':
    unittest.main()

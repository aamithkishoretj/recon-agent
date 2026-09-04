"""Validated, isolated CSV import runs for the local demo workspace."""
import csv
import io
import json
from pathlib import Path
from threading import Lock
from uuid import UUID, uuid4

from app.services.ingestion import load_bank_stream, load_ledger_stream, load_settlement_stream
from app.services.pipeline import run

MAX_SOURCE_BYTES = 2_000_000
MAX_ROWS_PER_SOURCE = 10_000
SOURCES = ('ledger', 'settlement', 'bank')
FILENAMES = {source: f'{source}.csv' for source in SOURCES}
REQUIRED_HEADERS = {
    'ledger': {'ledger_ref', 'order_id', 'customer_id', 'amount', 'order_date', 'status'},
    'settlement': {'settlement_ref', 'payment_ref', 'gross_amount_paise', 'fee_paise', 'gst_paise',
                   'net_amount_paise', 'settlement_date', 'batch_id', 'status'},
    'bank': {'bank_ref', 'credit_amount', 'value_date', 'description'},
}
LOADERS = {'ledger': load_ledger_stream, 'settlement': load_settlement_stream, 'bank': load_bank_stream}
RUN_LOCK = Lock()


def validate_source(source, filename, content):
    if source not in SOURCES:
        raise ValueError(f'Unknown source: {source}')
    if not filename or Path(filename).name != filename or Path(filename).suffix.lower() != '.csv':
        raise ValueError(f'{source.title()} must be a plain .csv filename.')
    if '\x00' in content:
        raise ValueError(f'{source.title()} contains invalid null bytes.')
    size = len(content.encode('utf-8'))
    if size > MAX_SOURCE_BYTES:
        raise ValueError(f'{source.title()} exceeds the 2 MB local-demo limit.')
    probe = io.StringIO(content.lstrip('\ufeff'), newline='')
    reader = csv.DictReader(probe)
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)):
        raise ValueError(f'{source.title()} contains duplicate column names.')
    missing = sorted(REQUIRED_HEADERS[source] - set(headers))
    if missing:
        raise ValueError(f'{source.title()} is missing required columns: {", ".join(missing)}.')
    probe.seek(0)
    rows = LOADERS[source](probe)
    if not rows:
        raise ValueError(f'{source.title()} must contain at least one data row.')
    if len(rows) > MAX_ROWS_PER_SOURCE:
        raise ValueError(f'{source.title()} exceeds the 10,000-row local-demo limit.')
    for row_number, row in enumerate(rows, 2):
        if len(row.currency) != 3 or not row.currency.isalpha():
            raise ValueError(f'{source.title()} row {row_number}: currency must be a three-letter code.')
    return {'rows': len(rows), 'columns': len(headers), 'bytes': size, 'filename': filename}


def stage_run(import_root, files):
    if set(files) != set(SOURCES):
        raise ValueError('Exactly one ledger, settlement, and bank CSV are required.')
    summaries = {source: validate_source(source, files[source]['filename'], files[source]['content']) for source in SOURCES}
    import_root = Path(import_root)
    import_root.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid4())
    run_dir = import_root / run_id
    run_dir.mkdir(exist_ok=False)
    for source in SOURCES:
        (run_dir / FILENAMES[source]).write_text(files[source]['content'], encoding='utf-8', newline='')
    metadata = {'run_id': run_id, 'status': 'uploaded', 'sources': summaries}
    write_metadata(run_dir, metadata)
    return metadata


def safe_run_dir(import_root, run_id):
    try:
        canonical = str(UUID(run_id))
    except (ValueError, AttributeError) as error:
        raise ValueError('Invalid run ID.') from error
    run_dir = Path(import_root) / canonical
    if not (run_dir / 'metadata.json').is_file():
        raise FileNotFoundError('Import run not found.')
    return run_dir


def read_metadata(run_dir):
    return json.loads((Path(run_dir) / 'metadata.json').read_text(encoding='utf-8'))


def write_metadata(run_dir, metadata):
    target = Path(run_dir) / 'metadata.json'
    temporary = Path(run_dir) / 'metadata.next.json'
    temporary.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    temporary.replace(target)


def execute_run(import_root, run_id):
    with RUN_LOCK:
        run_dir = safe_run_dir(import_root, run_id)
        metadata = read_metadata(run_dir)
        if metadata.get('status') != 'uploaded':
            raise ValueError('This import run has already started or completed.')
        metadata['status'] = 'running'
        write_metadata(run_dir, metadata)
        try:
            report = run(run_dir, run_dir / 'recon.db')
            (run_dir / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            metadata.update(status='completed', report=report)
            write_metadata(run_dir, metadata)
            return metadata, run_dir
        except Exception as error:
            metadata.update(status='failed', error=str(error))
            write_metadata(run_dir, metadata)
            raise

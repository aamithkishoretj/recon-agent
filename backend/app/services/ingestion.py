"""
Ingestion & normalization layer.

Each source has its OWN unit/format conventions (this mirrors real life —
you know your bank's export format because you signed up for their feed).
Parsing rules are therefore source-specific, not a universal regex:

- ledger.amount        -> always rupees, various textual formats
- settlement.*_paise    -> always raw integer paise, already clean
- bank.credit_amount    -> EITHER rupees-formatted (has a '.') OR raw paise
                           (no '.', no ',') — this ambiguity is real-world
                           accurate and is resolved per-row by presence of
                           a decimal point.
"""
import csv
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from app.models.db import Transaction, SourceType, TxnStatus

DATE_FORMATS = [
    "%Y-%m-%dT%H:%M:%SZ",   # ISO / UTC
    "%d/%m/%Y %H:%M",        # local dd/mm/yyyy
    "%m-%d-%Y %I:%M %p",     # US-style 12hr
    "%d-%m-%Y %H:%M",        # dd-mm-yyyy 24hr — e.g. what Excel produces if it
                              # silently reformats a dd/mm/yyyy string on save
]

STATUS_MAP = {
    "captured": TxnStatus.CAPTURED,
    "refunded": TxnStatus.REFUNDED,
    "partially_refunded": TxnStatus.PARTIALLY_REFUNDED,
    "settled": TxnStatus.CAPTURED,
    "refund": TxnStatus.REFUNDED,
    "cross_cycle_refund": TxnStatus.REFUNDED,
    "failed": TxnStatus.FAILED,
    "authorized": TxnStatus.AUTHORIZED,
    "reversed": TxnStatus.REVERSED,
}

REF_PATTERN = re.compile(r"(?<![A-Za-z0-9_-])(LEDG-\d{6}|BATCH-\d{5}|MISSING-\d{6})(?![A-Za-z0-9_-])")


def parse_multi_date(raw: str) -> datetime:
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date format: {raw!r}")


def parse_ledger_amount(raw: str) -> int:
    """Ledger amounts are always rupees. Strip INR suffix and commas."""
    cleaned = raw.replace("INR", "").replace(",", "").strip()
    try:
        paise = Decimal(cleaned) * 100
        if not paise.is_finite() or paise != paise.to_integral_value():
            raise ValueError('Amounts must contain whole paise')
        return int(paise)
    except InvalidOperation as error:
        raise ValueError('Invalid monetary amount') from error


def parse_bank_amount(raw: str) -> int:
    """
    Bank amounts are rupees-formatted if they contain a decimal point,
    otherwise they're raw paise. This ambiguity is deliberate (problem #31
    from the spec) and resolved using the presence of '.' as the signal —
    the same heuristic a real ingestion script would need to apply per feed.
    """
    cleaned = raw.replace(",", "").strip()
    if "." in cleaned:
        return parse_ledger_amount(cleaned)
    return int(cleaned)


def extract_refs(description: str):
    """Pull all natural-key tokens (ledger/batch/missing refs) out of a
    free-text bank description. Order matters: first match is the primary
    reference, any additional matches are secondary/adjustment refs."""
    return REF_PATTERN.findall(description)


def load_ledger(path: str):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return load_ledger_stream(handle)


def load_ledger_stream(handle):
    rows = []
    for row_number, row in enumerate(csv.DictReader(handle), 2):
        try:
            amount = parse_ledger_amount(row["amount"])
            ts = parse_multi_date(row["order_date"])
            status = STATUS_MAP[row["status"].strip().lower()]
            rows.append(Transaction(
                source_type=SourceType.LEDGER,
                external_ref=row["ledger_ref"].strip() or None,
                order_id=row["order_id"].strip() or None,
                customer_id=row["customer_id"].strip() or None,
                amount_minor_units=amount,
                currency=(row.get("currency") or "INR").strip().upper(),
                timestamp_utc=ts,
                status=status,
                raw_payload=dict(row),
            ))
        except (KeyError, TypeError, ValueError, InvalidOperation) as error:
            raise ValueError(f"Ledger row {row_number}: {error}") from error
    return rows


def load_settlement(path: str):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return load_settlement_stream(handle)


def load_settlement_stream(handle):
    rows = []
    for row_number, row in enumerate(csv.DictReader(handle), 2):
        try:
            ts = datetime.strptime(row["settlement_date"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            status = STATUS_MAP[row["status"].strip().lower()]
            rows.append(Transaction(
                source_type=SourceType.SETTLEMENT,
                external_ref=row["settlement_ref"].strip() or None,
                order_id=row.get('order_id') or None,
                customer_id=row.get('customer_id') or None,
                amount_minor_units=int(row["net_amount_paise"]),
                currency=(row.get("currency") or "INR").strip().upper(),
                timestamp_utc=ts,
                status=status,
                batch_id=row["batch_id"] or None,
                raw_payload=dict(row),
            ))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Settlement row {row_number}: {error}") from error
    return rows


def load_bank(path: str):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return load_bank_stream(handle)


def load_bank_stream(handle):
    rows = []
    for row_number, row in enumerate(csv.DictReader(handle), 2):
        try:
            amount = parse_bank_amount(row["credit_amount"])
            ts = parse_multi_date(row["value_date"])
            rows.append(Transaction(
                source_type=SourceType.BANK,
                external_ref=row["bank_ref"].strip() or None,
                order_id=row.get('order_id') or None,
                customer_id=row.get('customer_id') or None,
                batch_id=row.get('batch_id') or None,
                amount_minor_units=amount,
                currency=(row.get("currency") or "INR").strip().upper(),
                timestamp_utc=ts,
                status=TxnStatus.CAPTURED,
                raw_payload=dict(row),
            ))
        except (KeyError, TypeError, ValueError, InvalidOperation) as error:
            raise ValueError(f"Bank row {row_number}: {error}") from error
    return rows


def ingest_all(session, data_dir: str):
    """Loads all 3 sources, normalizes, and persists as canonical
    Transaction rows. Returns counts for a quick sanity print."""
    if session.query(Transaction).first():
        raise ValueError('Ingestion requires an empty database; existing records were preserved.')
    ledger_rows = load_ledger(f"{data_dir}/ledger.csv")
    settlement_rows = load_settlement(f"{data_dir}/settlement.csv")
    bank_rows = load_bank(f"{data_dir}/bank.csv")

    session.add_all(ledger_rows)
    session.add_all(settlement_rows)
    session.add_all(bank_rows)
    session.commit()

    return {
        "ledger": len(ledger_rows),
        "settlement": len(settlement_rows),
        "bank": len(bank_rows),
    }

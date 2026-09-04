"""
Synthetic data generator for the reconciliation engine.

Core design principle: generate TRUTH first, then derive three messy,
independently-formatted views of it. Ground truth is written to a separate
file the matching pipeline never reads — only the evaluator does.

Every row in every source file carries a source-local natural key
(ledger_ref / settlement_ref / bank_ref) that stays stable across the
messy formatting, so the evaluator can trace any row back to its true event
regardless of how the normalization layer parses it.

Usage:
    python generate_synthetic_data.py --count 200 --seed 42 --outdir ../data
"""
import argparse
import csv
import json
import random
from pathlib import Path
from datetime import datetime, timedelta

FEE_RATES = {"UPI": 0.0, "CARD": 0.02, "INTL_CARD": 0.03}
GST_RATE = 0.18

SCENARIO_WEIGHTS = {
    "exact_match": 30,
    "fee_gst": 15,
    "settlement_delay": 10,
    "batch_n_to_1": 8,
    "partial_refund": 8,
    "full_refund": 6,
    "refund_crosses_cycle": 5,
    "rounding_diff": 5,
    "duplicate_row": 4,
    "missing_ledger": 3,
    "missing_settlement": 3,
    "missing_bank": 3,
    "ambiguous_candidate": 6,
    "unexplained_discrepancy": 4,
    "missing_references": 4,
    "corrupted_references": 4,
    "amount_only_candidate": 2,
}


def money(paise: int) -> int:
    return int(round(paise))


def fee_gst_for(gross_paise: int, method: str):
    fee = money(gross_paise * FEE_RATES[method])
    gst = money(fee * GST_RATE)
    net = gross_paise - fee - gst
    return fee, gst, net


class RefCounter:
    def __init__(self):
        self.n = {"ledger": 0, "settlement": 0, "bank": 0, "event": 0}

    def next(self, kind):
        self.n[kind] += 1
        return f"{kind.upper()[:4]}-{self.n[kind]:06d}"


def fmt_ledger_amount(paise: int, style: int) -> str:
    rupees = paise / 100
    if style == 0:
        return f"{rupees:,.2f}"
    if style == 1:
        return f"{rupees:.2f}"
    return f"{rupees:,.2f} INR"


def fmt_bank_amount(paise: int, style: int) -> str:
    rupees = paise / 100
    if style == 0:
        return f"{rupees:,.2f}"
    return str(int(paise))  # some bank exports dump raw paise


def fmt_date(dt: datetime, style: int) -> str:
    if style == 0:
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")          # ISO / UTC
    if style == 1:
        return dt.strftime("%d/%m/%Y %H:%M")               # local dd/mm/yyyy
    return dt.strftime("%m-%d-%Y %I:%M %p")                 # 12hr US-ish


class Generator:
    def __init__(self, seed: int):
        random.seed(seed)
        self.ref = RefCounter()
        self.ledger_rows = []
        self.settlement_rows = []
        self.bank_rows = []
        self.ground_truth = []
        self.base_date = datetime(2026, 6, 1)

    def rand_amount(self):
        return random.randint(50000, 5_000_000)  # paise: ₹500 - ₹50,000

    def rand_method(self):
        return random.choices(["UPI", "CARD", "INTL_CARD"], weights=[50, 40, 10])[0]

    def rand_ts(self, day_offset_range=(0, 60)):
        d = self.base_date + timedelta(
            days=random.randint(*day_offset_range),
            hours=random.randint(0, 23),
            minutes=random.randint(0, 59),
        )
        return d

    def add_ledger(self, order_id, ts, gross, status="captured"):
        ref = self.ref.next("ledger")
        self.ledger_rows.append({
            "ledger_ref": ref,
            "order_id": order_id,
            "customer_id": f"CUST-{random.randint(1000,9999)}",
            "amount": fmt_ledger_amount(gross, random.randint(0, 2)),
            "order_date": fmt_date(ts, random.randint(0, 2)),
            "status": status,
            "refund_amount_paise": 0,
            "payment_method": "",
        })
        return ref

    def record_refund(self, ledger_ref, amount):
        next(row for row in self.ledger_rows if row['ledger_ref'] == ledger_ref)['refund_amount_paise'] = amount

    def add_settlement(self, payment_ref, ts, gross, fee, gst, net, batch_id="", status="settled"):
        ref = self.ref.next("settlement")
        self.settlement_rows.append({
            "settlement_ref": ref,
            "payment_ref": payment_ref,
            "gross_amount_paise": gross,
            "fee_paise": fee,
            "gst_paise": gst,
            "net_amount_paise": net,
            "settlement_date": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "batch_id": batch_id,
            "status": status,
            "order_id": "",
            "customer_id": "",
            "payment_method": "",
            "payout_ref": "",
        })
        return ref

    def add_bank(self, ref_hint, ts, amount, note=""):
        ref = self.ref.next("bank")
        self.bank_rows.append({
            "bank_ref": ref,
            "credit_amount": fmt_bank_amount(amount, random.randint(0, 1)),
            "value_date": fmt_date(ts, random.randint(0, 2)),
            "description": f"NEFT {ref_hint} {note}".strip(),
            "currency": "INR",
            "order_id": "",
            "customer_id": "",
            "payment_method": "",
            "payout_ref": "",
            "batch_id": "",
        })
        return ref

    def record_gt(self, event_type, ledger_refs, settlement_refs, bank_refs, resolution, notes=""):
        self.ref.n["event"] += 1
        self.ground_truth.append({
            "event_id": f"EVT-{self.ref.n['event']:06d}",
            "event_type": event_type,
            "ledger_refs": ledger_refs,
            "settlement_refs": settlement_refs,
            "bank_refs": bank_refs,
            "expected_resolution": resolution,  # "auto_match" | "exception"
            "notes": notes,
        })

    # ---------- Scenario builders ----------

    def scenario_exact_match(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, 0, 0, gross, status="settled")
        b = self.add_bank(l, ts, gross)
        self.record_gt("exact_match", [l], [s], [b], "auto_match")

    def scenario_fee_gst(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        method = self.rand_method()
        fee, gst, net = fee_gst_for(gross, method)
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, fee, gst, net)
        b = self.add_bank(l, ts, net)
        self.record_gt("fee_gst", [l], [s], [b], "auto_match",
                        notes=f"method={method} fee={fee} gst={gst}")

    def scenario_settlement_delay(self):
        ts = self.rand_ts()
        delay_days = random.choice([1, 2])
        gross = self.rand_amount()
        method = self.rand_method()
        fee, gst, net = fee_gst_for(gross, method)
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        settle_ts = ts + timedelta(days=delay_days)
        s = self.add_settlement(l, settle_ts, gross, fee, gst, net)
        b = self.add_bank(l, settle_ts, net)
        self.record_gt("settlement_delay", [l], [s], [b], "auto_match",
                        notes=f"delay_days={delay_days}")

    def scenario_batch_n_to_1(self):
        n = random.randint(3, 6)
        batch_id = f"BATCH-{random.randint(10000,99999)}"
        settle_ts = self.rand_ts()
        ledger_refs, total_net, total_gross, total_fee, total_gst = [], 0, 0, 0, 0
        for _ in range(n):
            ts = settle_ts - timedelta(hours=random.randint(1, 20))
            gross = self.rand_amount()
            method = self.rand_method()
            fee, gst, net = fee_gst_for(gross, method)
            order_id = f"ORD{random.randint(100000,999999)}"
            l = self.add_ledger(order_id, ts, gross)
            ledger_refs.append(l)
            total_net += net
            total_gross += gross
            total_fee += fee
            total_gst += gst
        s = self.add_settlement(",".join(ledger_refs), settle_ts, total_gross,
                                 total_fee, total_gst, total_net, batch_id=batch_id)
        b = self.add_bank(batch_id, settle_ts, total_net, note="BATCH")
        self.record_gt("batch_n_to_1", ledger_refs, [s], [b], "auto_match",
                        notes=f"n={n} batch_id={batch_id}")

    def scenario_partial_refund(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        method = self.rand_method()
        fee, gst, net = fee_gst_for(gross, method)
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross, status="partially_refunded")
        s1 = self.add_settlement(l, ts, gross, fee, gst, net)
        b1 = self.add_bank(l, ts, net)
        refund_amt = int(gross * random.uniform(0.2, 0.6))
        self.record_refund(l, refund_amt)
        refund_ts = ts + timedelta(days=random.randint(1, 4))
        s2 = self.add_settlement(l, refund_ts, -refund_amt, 0, 0, -refund_amt,
                                  status="refund")
        b2 = self.add_bank(l, refund_ts, -refund_amt, note="REFUND")
        self.record_gt("partial_refund", [l], [s1, s2], [b1, b2], "auto_match",
                        notes=f"refund_amt={refund_amt}")

    def scenario_full_refund(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross, status="refunded")
        s1 = self.add_settlement(l, ts, gross, 0, 0, gross)
        b1 = self.add_bank(l, ts, gross)
        refund_ts = ts + timedelta(days=random.randint(1, 3))
        self.record_refund(l, gross)
        s2 = self.add_settlement(l, refund_ts, -gross, 0, 0, -gross, status="refund")
        b2 = self.add_bank(l, refund_ts, -gross, note="FULL REFUND")
        self.record_gt("full_refund", [l], [s1, s2], [b1, b2], "auto_match")

    def scenario_refund_crosses_cycle(self):
        ts = self.rand_ts(day_offset_range=(0, 30))
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross, status="partially_refunded")
        s1 = self.add_settlement(l, ts, gross, 0, 0, gross)
        b1 = self.add_bank(l, ts, gross)
        refund_amt = int(gross * random.uniform(0.1, 0.5))
        self.record_refund(l, refund_amt)
        # refund lands 15-25 days later -> a different settlement cycle,
        # netted against an UNRELATED later settlement batch.
        refund_ts = ts + timedelta(days=random.randint(15, 25))
        unrelated_batch = f"BATCH-{random.randint(10000,99999)}"
        s2 = self.add_settlement(l, refund_ts, -refund_amt, 0, 0, -refund_amt,
                                  batch_id=unrelated_batch, status="cross_cycle_refund")
        b2 = self.add_bank(unrelated_batch, refund_ts, -refund_amt,
                            note=f"ADJ ref={l}")
        self.record_gt("refund_crosses_cycle", [l], [s1, s2], [b1, b2], "auto_match",
                        notes=f"refund_amt={refund_amt} gap_days>=15")

    def scenario_rounding_diff(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        method = self.rand_method()
        fee, gst, net = fee_gst_for(gross, method)
        drift = random.choice([-2, -1, 1, 2])  # paise-level rounding noise
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, fee, gst, net)
        b = self.add_bank(l, ts, net + drift)
        self.record_gt("rounding_diff", [l], [s], [b], "auto_match",
                        notes=f"drift_paise={drift}")

    def scenario_duplicate_row(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, 0, 0, gross)
        b = self.add_bank(l, ts, gross)
        # duplicate the bank credit only, as a distinct row with a new ref
        b_dupe = self.add_bank(l, ts, gross, note="DUP")
        self.record_gt("duplicate_row", [l], [s], [b, b_dupe], "exception",
                        notes="bank has a duplicate credit for one true payment")

    def scenario_missing_ledger(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        fake_ref = f"MISSING-{random.randint(100000,999999)}"
        s = self.add_settlement(fake_ref, ts, gross, 0, 0, gross)
        b = self.add_bank(fake_ref, ts, gross)
        self.record_gt("missing_ledger", [], [s], [b], "exception",
                        notes="Razorpay/bank show a payment with no ledger order")

    def scenario_missing_settlement(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross, status="captured")
        # no settlement row generated at all
        self.record_gt("missing_settlement", [l], [], [], "exception",
                        notes="ledger says paid, no settlement record exists")

    def scenario_missing_bank(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, 0, 0, gross, status="settled")
        # bank credit never arrives -> high priority exception
        self.record_gt("missing_bank", [l], [s], [], "exception",
                        notes="settled but expected bank credit is missing")

    def scenario_ambiguous_candidate(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id1 = f"ORD{random.randint(100000,999999)}"
        order_id2 = f"ORD{random.randint(100000,999999)}"
        ts2 = ts + timedelta(minutes=random.randint(5, 40))
        l1 = self.add_ledger(order_id1, ts, gross)
        l2 = self.add_ledger(order_id2, ts2, gross)  # same amount, close time
        # Neither downstream source identifies the paid order. Both candidates
        # remain plausible even though the evaluator privately knows l1 paid.
        settle_ts = ts2 + timedelta(days=1)
        fee, gst, net = fee_gst_for(gross, 'CARD')
        s = self.add_settlement('', settle_ts, gross, fee, gst, net)
        b = self.add_bank('', settle_ts, net, note='PAYMENT SETTLEMENT')
        self.record_gt('ambiguous_candidate', [l1, l2], [s], [b], 'exception',
                       notes='Two equal-gross orders in the same window; no identifying downstream reference.')
        self.ground_truth[-1].update(expected_category='ambiguous_candidate', true_ledger_refs=[l1],
            candidate_sets=[{'ledger_refs': [ref], 'settlement_refs': [s], 'bank_refs': [b]} for ref in (l1, l2)])

    def candidate_fixture(self, kind):
        ts, gross = self.rand_ts(), self.rand_amount()
        order_id = f'ORDER-{self.ref.n["ledger"] + 1:06d}'
        ledger = self.add_ledger(order_id, ts, gross)
        fee, gst, net = fee_gst_for(gross, 'CARD')
        broken_ref = ledger[:-1] + 'X' if kind == 'corrupted_references' else ''
        settlement = self.add_settlement(broken_ref, ts + timedelta(days=2), gross, fee, gst, net)
        bank = self.add_bank(broken_ref, ts + timedelta(days=2, hours=2), net, note='PAYMENT SETTLEMENT')
        if kind != 'amount_only_candidate':
            # Optional metadata from the feeds, NOT ground-truth event IDs.
            customer = f'CUSTOMER-{self.ref.n["ledger"]:06d}'
            self.ledger_rows[-1].update(customer_id=customer, payment_method='CARD')
            self.settlement_rows[-1].update(customer_id=customer, payment_method='CARD',
                order_id=order_id if kind == 'missing_references' else '', payout_ref=f'PAYOUT-{settlement}')
            self.bank_rows[-1].update(payout_ref=f'PAYOUT-{settlement}', payment_method='CARD')
        self.record_gt(kind, [ledger], [settlement], [bank],
                       'exception' if kind == 'amount_only_candidate' else 'auto_match')
        self.ground_truth[-1]['candidate_sets'] = [{'ledger_refs': [ledger], 'settlement_refs': [settlement], 'bank_refs': [bank]}]
        if kind == 'amount_only_candidate':
            self.ground_truth[-1]['expected_category'] = 'ambiguous_candidate'

    def scenario_missing_references(self):
        self.candidate_fixture('missing_references')

    def scenario_corrupted_references(self):
        self.candidate_fixture('corrupted_references')

    def scenario_amount_only_candidate(self):
        self.candidate_fixture('amount_only_candidate')

    def scenario_unexplained_discrepancy(self):
        ts = self.rand_ts()
        gross = self.rand_amount()
        order_id = f"ORD{random.randint(100000,999999)}"
        l = self.add_ledger(order_id, ts, gross)
        s = self.add_settlement(l, ts, gross, 0, 0, gross)
        # genuine unexplained shortfall — not fee, not gst, not refund, not rounding
        noise = random.randint(500, 5000)  # ₹5 - ₹50, too big to be rounding
        b = self.add_bank(l, ts, gross - noise, note="SHORTFALL")
        self.record_gt("unexplained_discrepancy", [l], [s], [b], "exception",
                        notes=f"unexplained_shortfall_paise={noise}")

    SCENARIO_FUNCS = {
        "exact_match": scenario_exact_match,
        "fee_gst": scenario_fee_gst,
        "settlement_delay": scenario_settlement_delay,
        "batch_n_to_1": scenario_batch_n_to_1,
        "partial_refund": scenario_partial_refund,
        "full_refund": scenario_full_refund,
        "refund_crosses_cycle": scenario_refund_crosses_cycle,
        "rounding_diff": scenario_rounding_diff,
        "duplicate_row": scenario_duplicate_row,
        "missing_ledger": scenario_missing_ledger,
        "missing_settlement": scenario_missing_settlement,
        "missing_bank": scenario_missing_bank,
        "ambiguous_candidate": scenario_ambiguous_candidate,
        "unexplained_discrepancy": scenario_unexplained_discrepancy,
        "missing_references": scenario_missing_references,
        "corrupted_references": scenario_corrupted_references,
        "amount_only_candidate": scenario_amount_only_candidate,
    }

    def generate(self, count):
        scenarios = list(SCENARIO_WEIGHTS.keys())
        weights = list(SCENARIO_WEIGHTS.values())
        for _ in range(count):
            choice = random.choices(scenarios, weights=weights)[0]
            self.SCENARIO_FUNCS[choice](self)

    def write(self, outdir):
        for name in ('ledger.csv', 'settlement.csv', 'bank.csv', 'ground_truth.json'):
            if (Path(outdir) / name).exists():
                raise FileExistsError('Source files already exist; choose a fresh output directory.')
        def write_csv(path, rows):
            if not rows:
                return
            with open(path, "x", newline="", encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)

        random.shuffle(self.ledger_rows)
        random.shuffle(self.settlement_rows)
        random.shuffle(self.bank_rows)

        write_csv(f"{outdir}/ledger.csv", self.ledger_rows)
        write_csv(f"{outdir}/settlement.csv", self.settlement_rows)
        write_csv(f"{outdir}/bank.csv", self.bank_rows)
        with open(f"{outdir}/ground_truth.json", "x", encoding='utf-8') as f:
            json.dump(self.ground_truth, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=200, help="number of business events")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--outdir", type=str, default="../data")
    args = ap.parse_args()

    gen = Generator(seed=args.seed)
    gen.generate(args.count)
    gen.write(args.outdir)

    print(f"Generated {args.count} events -> "
          f"{len(gen.ledger_rows)} ledger rows, "
          f"{len(gen.settlement_rows)} settlement rows, "
          f"{len(gen.bank_rows)} bank rows")
    print(f"Ground truth events: {len(gen.ground_truth)}")
    scenario_counts = {}
    for e in gen.ground_truth:
        scenario_counts[e["event_type"]] = scenario_counts.get(e["event_type"], 0) + 1
    for k, v in sorted(scenario_counts.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()

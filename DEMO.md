# Buildathon demo walkthrough

The project has two safe launch modes. Both create a new isolated database and
preserve every prior run. `showcase` forces mock mode and makes no external
calls; `showcase:live` requires a Gemini key and makes a real provider call
only when AI investigation is explicitly confirmed.

## Judge presentation: five prepared cases

Run `npm.cmd run showcase` from the project root, then open [localhost:5173](http://localhost:5173/#dashboard).

To demonstrate the real Gemini integration, set `GEMINI_API_KEY` in the
current environment and run `npm.cmd run showcase:live` instead. The live
launcher refuses to start without a key. It sends only the minimized evidence
payload documented below; the normal `showcase` command remains offline and
forces mock mode.

The Overview shows a **Presentation mode** rail. Each card opens the real reconciled record and its source evidence:

1. **Fee + GST waterfall:** ₹10,000 gross − ₹200 fee − ₹36 GST = ₹9,764 net.
2. **Four orders, one payout:** four ledger rows become one ₹14,646 settlement and bank credit.
3. **Partial refund:** a ₹1,500 refund remains linked to its original ₹8,000 payment.
4. **T+2 settlement:** a legitimate two-day delay still reconciles with explicit timing evidence.
5. **Unexplained shortfall:** ₹19,420 expected versus ₹19,170 observed. The ₹250 gap remains an exception instead of receiving an invented explanation.

This compact batch contains 20 source records, four correct automatic matches, and one correct exception. Its evaluator requires exact source-row membership and valid financial arithmetic. Expected result: 100% precision, 100% recall, zero false matches, and zero missed matches.

For a fresh offline backup, keep the showcase running and execute `npm.cmd run evidence`. The timestamped folder under `demo-evidence/` contains eleven screenshots, the exact verified report, the showcase manifest, and these presentation notes.

## Five-minute live Gemini video script

Before recording, stop any existing launcher and run:

```powershell
cd D:\razerpay\recon-agent
npm.cmd run showcase:live
```

Open [localhost:5173](http://localhost:5173/#dashboard). Start from a fresh
run so the **AI investigation** button has not already been used.

### 0:00-0:35 — Product and AI mode

**Open:** Overview.

**Say:** “This is ReconAgent, an AI-assisted finance controller for Razorpay
reconciliation. It compares the merchant ledger, Razorpay settlement report,
and bank statement. This recording uses the live Gemini provider: Gemini
investigates exceptions and returns a structured hypothesis. The normal
`showcase` command deliberately forces mock mode for an offline, private and
zero-cost fallback; `showcase:live` requires a key and makes a real provider
call. In both modes, Gemini never creates a match or approves money.”

### 0:35-1:00 — How a decision is made

**Point to:** the Overview totals and Presentation mode cards.

**Say:** “References first connect the correct records. Deterministic code then
recalculates gross minus fees, GST and refunds, and compares that result with
the settlement and bank. All money uses integer paise with a five-paise
rounding tolerance. Safe groups close automatically; incomplete or
inconsistent evidence becomes an exception.”

**Condition:** every automatic match needs supported INR lifecycle evidence,
unique references, chronological downstream postings, and every arithmetic
difference within five paise.

### 1:00-1:30 — Fee and GST

**Open:** Fee + GST waterfall → Open evidence. Select Merchant ledger,
Settlement report and Bank statement.

**Say:** “The ledger records ten thousand rupees gross. The declared fee is two
hundred rupees and GST is thirty-six, so the independently expected net is
nine thousand seven hundred and sixty-four rupees. Both settlement and bank
equal that amount.”

**Condition:** `₹10,000 − ₹200 − ₹36 = ₹9,764`, and expected net equals both
reported settlement and observed bank total.

### 1:30-1:55 — Many orders, one payout

**Close the panel, then open:** Four orders, one payout.

**Say:** “Four orders total fifteen thousand rupees. Their payment references
and batch ID connect them to one settlement and one bank credit. After a
three-hundred-rupee fee and fifty-four rupees GST, the net is fourteen thousand
six hundred and forty-six rupees.”

**Condition:** the exact four ledger references form one indivisible group;
`₹15,000 − ₹300 − ₹54 = ₹14,646`; no source row is reused.

### 1:55-2:25 — Partial refund

**Close the panel, then open:** Partial refund across records.

**Say:** “An eight-thousand-rupee sale later receives a one-thousand-five-
hundred-rupee partial refund. The refund stays linked to the original order,
two settlement rows and two bank rows.”

**Condition:** partial-refund status must agree with a declared refund greater
than zero and less than the order value. Merchant and settlement refund totals
must agree. `₹8,000 − ₹160 − ₹28.80 − ₹1,500 = ₹6,311.20`.

### 2:25-2:50 — T+2 timing

**Close the panel, then open:** T+2 settlement timing.

**Say:** “This six-thousand-five-hundred-rupee payment settles two days later.
Because trusted references connect it, the arithmetic passes and downstream
timestamps do not predate the order, it is not mistaken for a missing payout.”

**Condition:** `₹6,500 − ₹130 − ₹23.40 = ₹6,346.60`. Reference-linked groups
must be chronological. The stricter 72-hour settlement and 48-hour bank
windows apply only when recovering broken references.

### 2:50-3:30 — Honest exception

**Close the panel, then open:** Unexplained ₹250 shortfall.

**Say:** “Here, twenty thousand rupees less five hundred fee and eighty GST
should produce nineteen thousand four hundred and twenty. The bank received
only nineteen thousand one hundred and seventy. The unexplained two-hundred-
and-fifty-rupee difference is far above the five-paise tolerance, so the
controller refuses to invent an adjustment and opens an amount-discrepancy
case.”

**Condition:** `abs(₹19,170 − ₹19,420) = ₹250 > ₹0.05`, therefore no match.

### 3:30-4:15 — Real Gemini investigation

**Close the panel. Open:** Review queue → AI investigation → Confirm
investigation. Open the shortfall case after the response returns.

**Say:** “Now the backend sends Gemini only minimized numeric and timing
evidence—no customer ID, transaction reference, record ID or raw source row.
Gemini returns a schema-validated explanation, confidence and suggested
category. A deterministic post-check downgrades any explanation whose claimed
mechanism is not supported by the numbers. The case moves to In Review, not to
Matched.”

**Condition:** AI runs only on open amount-discrepancy or ambiguous-candidate
cases. AI output can add a hypothesis and change status to In Review, but
cannot create a match, choose an ambiguous identity, change evidence or
approve itself.

### 4:15-4:35 — Human control and audit

**Point to:** Human Review, then open Audit trail.

**Say:** “Human approval still reruns every financial rule and is refused
while this shortfall remains. Every system classification, AI assessment and
human action is preserved in the audit trail with its actor, timestamp and
evidence.”

### 4:35-5:00 — Measured result and closing

**Open:** Overview → Record-level accuracy.

**Say:** “This showcase contains twenty source records, four correct automatic
matches and one correct exception. The evaluator checks exact source-row
membership and reruns the financial verifier. On this deterministic synthetic
batch, precision and recall are one hundred percent, with zero false or missed
matches. That is a test-batch result, not a production-accuracy claim.
ReconAgent’s principle is: references connect the records, rules verify the
money, Gemini investigates uncertainty, and humans make the final decision.”

## Full benchmark mode

Run `npm.cmd run demo` to generate a fresh 200-event benchmark containing all 17 scenario families plus seeded variations. The exact totals are printed in the new run's `report.json`; IDs and timings change on every run. The regression suite also validates the complete scenario set across three independent seeds.

Do not claim that mock behavior demonstrates live LLM reasoning. A live-provider evaluation is a separate task. Production readiness still requires authenticated roles, real feed contracts, tariff validation against commercial agreements, security hardening, and a live-provider evaluation.

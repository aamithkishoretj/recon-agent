# Buildathon demo walkthrough

The project has two safe launch modes. Both create a new isolated database, preserve every prior run, force AI to mock mode, and make no external calls.

## Judge presentation: five prepared cases

Run `npm.cmd run showcase` from the project root, then open [localhost:5173](http://localhost:5173/#dashboard).

The Overview shows a **Presentation mode** rail. Each card opens the real reconciled record and its source evidence:

1. **Fee + GST waterfall:** ₹10,000 gross − ₹200 fee − ₹36 GST = ₹9,764 net.
2. **Four orders, one payout:** four ledger rows become one ₹14,646 settlement and bank credit.
3. **Partial refund:** a ₹1,500 refund remains linked to its original ₹8,000 payment.
4. **T+2 settlement:** a legitimate two-day delay still reconciles with explicit timing evidence.
5. **Unexplained shortfall:** ₹19,420 expected versus ₹19,170 observed. The ₹250 gap remains an exception instead of receiving an invented explanation.

This compact batch contains 20 source records, four correct automatic matches, and one correct exception. Its evaluator requires exact source-row membership and valid financial arithmetic. Expected result: 100% precision, 100% recall, zero false matches, and zero missed matches.

For a fresh offline backup, keep the showcase running and execute `npm.cmd run evidence`. The timestamped folder under `demo-evidence/` contains eleven screenshots, the exact verified report, the showcase manifest, and these presentation notes.

## Suggested three-minute walkthrough

1. Start on **Overview** and point out that the controller closes four cases but deliberately leaves one unresolved.
2. Open **Fee + GST waterfall**. Move through ledger, settlement, and bank evidence. Show that the net is recomputed rather than trusted.
3. Open **Four orders, one payout**. Explain that the N:1 data model handles batches without manufacturing four bank credits.
4. Open **Partial refund** or **T+2 settlement** to demonstrate lifecycle and timing handling.
5. Open **Unexplained ₹250 shortfall**. Show its arithmetic evidence and the human review gate. The system refuses unsafe approval while the source numbers disagree.
6. Expand **Record-level accuracy** and finish on the audit trail: AI proposes, deterministic verification checks, and humans decide.

## Full benchmark mode

Run `npm.cmd run demo` to generate a fresh 200-event benchmark containing all 17 scenario families plus seeded variations. The exact totals are printed in the new run's `report.json`; IDs and timings change on every run. The regression suite also validates the complete scenario set across three independent seeds.

Do not claim that mock behavior demonstrates live LLM reasoning. A live-provider evaluation is a separate task. Production readiness still requires authenticated roles, real feed contracts, tariff validation against commercial agreements, security hardening, and a live-provider evaluation.

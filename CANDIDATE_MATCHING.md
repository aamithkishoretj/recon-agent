# Missing-reference recovery and genuine ambiguity

Implemented scope: deterministic candidate recovery, adversarial evaluation, a read-only comparison workflow, and optional post-match AI assessment. No database reset or candidate-selection/override action is used.

## How matching works

1. Build the existing exact-reference graph. Malformed reference strings are no longer treated as exact references, and a valid-looking prefix inside a longer corrupted string is not extracted.
2. Preserve complete groups, duplicates and multi-row source components. Only incomplete captured INR groups with at most one row from each source enter fallback search. Components are never split.
3. Find ledger rows within five paise of settlement gross and bank rows within five paise of settlement net using sorted amount indexes. Settlement must be 0–72 hours after the ledger; bank posting must be 0–48 hours after settlement. These are configurable code constants for this synthetic contract, not a Razorpay business-calendar claim.
4. Reject contradictory order/customer/payment-method metadata and contradictory payout/batch metadata. Rerun every ledger, fee/GST, settlement-row and bank arithmetic check.
5. Score the surviving complete assignments with explicit rule points:

| Signal | Maximum points |
| --- | ---: |
| Arithmetic verified | 40 |
| Settlement and bank timing | 10 |
| Ledger linkage | 25 |
| Bank linkage | 20 |
| Payment method agrees | 5 |

Ledger identity requires an existing exact component, matching order metadata, or a damaged payment reference with similarity at least 0.88 corroborated by both customer and method. Reference similarity by itself never qualifies. Bank identity requires an existing component or matching payout, batch or order metadata. Description similarity is only weak supporting evidence.

6. Auto-recover only when the score is at least 90, both identity checks pass, and the score exceeds every overlapping rival by at least 10 points. A 100-vs-95 contest stays unresolved. A single amount-only candidate also stays unresolved.
7. Combine remaining overlapping alternatives into one `ambiguous_candidate` investigation. Each source record belongs to exactly one final match or exception; it cannot be used to settle two payments. No candidate-search truncation is allowed to manufacture a unique winner: exceeding 100 amount neighbors or 10,000 combinations disables automatic fallback for that run and records a limit warning.

Recovered matches use the existing `fuzzy` type with `explanation.matching_method = candidate_recovery`. Candidate scores are **not calibrated probabilities**. Ranked alternatives, signal breakdowns and arithmetic evidence are stored in flagged audit events and returned by the existing exception API under `system_evidence.evidence.candidates`.

The review dialog now presents two alternatives side by side. Reviewers can switch the displayed candidates, filter to differing evidence, and expand rule-score, cross-source linkage, timing, financial-proof and exact-record sections. The comparison is deliberately read-only: displaying a candidate does not select it, source rows shared by alternatives are called out, `false` evidence is labelled “not established” rather than “conflicting,” and money is shown only when every candidate record has one known currency. The aggregate source-flow diagram is hidden for candidate cases so competing ledger rows are not visually added together. No candidate-choice or override endpoint exists. Approval of unresolved candidate cases is disabled in the UI and blocked by the backend; rejection still keeps them unresolved.

AI investigation is available only after the deterministic engine has created the exception. The provider receives candidate numbers, rule scores, boolean linkage signals, timing values, arithmetic status, and overlap counts. References, record IDs, source rows, customer data, and evaluator truth are excluded. The prompt forbids choosing or ranking a winner, and the backend forcibly converts any provider response claiming to resolve candidate identity into an unresolved assessment with confidence capped at 30%. This adds investigative context without weakening the existing human-control boundary.

## New dataset behavior

- `missing_references`: no ledger reference downstream; unique order and payout metadata corroborate a recovery.
- `corrupted_references`: damaged payment reference; customer/method and payout evidence corroborate a recovery.
- `ambiguous_candidate`: two equal-value orders close in time; settlement and generic bank descriptions identify neither. Both plausible assignments are expected in one unresolved case.
- `amount_only_candidate`: one mathematically plausible assignment with no identity support; must remain unresolved.

The new sidecar truth includes candidate sets and, for genuine ambiguity, a private true-order label. Neither the matcher nor the candidate module reads these. Exact record membership and category are evaluated after matching. Older saved ground truth with the old decoy-in-notes format remains supported.

## Verified results

Recorded benchmark: seed 42, 200 generated events across all 17 scenarios:

| Measure | Result |
| --- | ---: |
| Source records | 700 |
| Correct automatic matches | 159 |
| Missing-reference recoveries | 10 |
| Corrupted-reference recoveries | 6 |
| Unresolved cases | 41 |
| Genuine two-order ambiguity cases | 11 |
| Amount-only cases correctly withheld | 5 |
| False / missed matches | 0 / 0 |
| Match precision / recall | 100% / 100% on this synthetic batch |
| Automatic group coverage | 79.5% |
| Merchant gross value coverage | 79.51% |

59 backend tests pass, including 23 candidate tests. Existing scenario regressions pass for seeds 42, 7 and 2026. Tests cover identity conflicts, close scores, equal bank credits, shared bank claims, stale reviews, protected exact components, search limits, shuffled record order, evaluator-only truth, anonymized AI payloads, and forced rejection of an AI-selected candidate identity. The frontend suite has 40 passing tests, including candidate presentation tests for missing evidence, zero values, currency safety, record-membership differences, equal scores, AI eligibility, and private-truth exclusion.

## Run it

Create a new report without changing the currently served database:

```powershell
.\venv\Scripts\python.exe backend/scripts/prepare_demo.py --count 200 --seed 42
```

To serve a new candidate-enabled demo, stop the previous local launcher, then run `npm.cmd run demo`. Existing source files and databases are preserved. The current browser may still be showing an older saved dataset until you start a new demo.

This is bounded, explainable recovery—not general fuzzy N:M reconciliation, verified tariff logic, FX support or proof of production accuracy. Refund and batch arithmetic remains supported through exact references; reference-free refund chains and batch subset search are deliberately not guessed.

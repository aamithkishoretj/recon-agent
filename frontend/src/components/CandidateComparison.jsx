import { useId, useState } from 'react';
import { candidateEvidence, candidatesFor, candidateRecordIds, comparisonIndexes, comparisonRows, evidenceState, finiteNumber } from '../lib/candidates.js';
import './CandidateComparison.css';

function ComparisonTable({ candidates, indexes, transactions, section, differencesOnly, caption }) {
  const rows = comparisonRows(candidates, transactions, section, differencesOnly);
  if (!rows.length) return <p className="candidate-empty">No differences in this section for the two displayed candidates. Turn off “Differences only” to see all evidence.</p>;
  return <div className="candidate-table-scroll" tabIndex={0} role="region" aria-label={`${caption} comparison`}>
    <table className="candidate-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Evidence</th>{indexes.map(index => <th scope="col" key={index}>Candidate {index + 1}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} className={row.different ? 'candidate-row-different' : ''}>
        <th scope="row">{row.label}{row.different && <span className="candidate-difference-label">Differs</span>}</th>
        {row.values.map((value, index) => <td key={indexes[index]}>{value}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function CandidateComparison({ exception }) {
  const id = useId();
  const evidence = candidateEvidence(exception), candidates = candidatesFor(exception);
  const [requested, setRequested] = useState([0, 1]);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const indexes = comparisonIndexes(candidates.length, requested);
  const selected = indexes.map(index => candidates[index]);
  const transactions = exception.transactions || [];
  const hasPair = selected.length === 2;
  const gap = hasPair && selected.every(candidate => finiteNumber(candidate.score)) ? Math.abs(selected[0].score - selected[1].score) : null;
  const shared = hasPair ? new Set(candidateRecordIds(selected[0]).filter(recordId => candidateRecordIds(selected[1]).includes(recordId))).size : 0;
  const reason = evidence.reason || exception.system_evidence?.notes || 'This case requires review. Detailed candidate evidence was not recorded for this saved run.';
  const number = value => finiteNumber(value) ? value : 'Not recorded';
  const tableProps = { candidates: selected, indexes, transactions, differencesOnly: hasPair && differencesOnly };

  return <section className="candidate-comparison" aria-labelledby={`${id}-title`}>
    <div className="candidate-heading"><div><span className="candidate-eyebrow">Record assignment · read only</span><h3 id={`${id}-title`}>Compare possible matches</h3></div><span className="badge badge-warning">No accepted candidate</span></div>
    <div className="candidate-withheld"><strong>Why matching was withheld</strong><p>{reason}</p>
      {evidence.search_limit_reached === true && <p>The search was capped. An empty list does not mean there are no possible matches.</p>}
    </div>
    {!candidates.length ? <p className="candidate-empty">No candidate comparisons are available in this saved case. Linked source records remain available below; no winner is inferred.</p> : <>
      <div className="candidate-policy" aria-label="Recorded automatic recovery policy">
        <span>Required score <strong>{number(evidence.auto_threshold)} points</strong></span>
        <span>Required lead <strong>{number(evidence.minimum_margin)} points</strong></span>
        <span>Identity <strong>Both links required</strong></span>
      </div>
      <p className="candidate-note">{candidates.length} recorded {candidates.length === 1 ? 'candidate' : 'candidates'}. Scores are rule points, not probabilities. Comparing an alternative does not select or approve a match.</p>
      <div className="candidate-cards">
        {selected.map((candidate, slot) => <article className="candidate-summary" key={slot}>
          <label htmlFor={`${id}-candidate-${slot}`}>Compare {slot === 0 ? 'left' : 'right'}</label>
          <select id={`${id}-candidate-${slot}`} value={indexes[slot]} onChange={event => {
            const next = [...indexes], choice = Number(event.target.value);
            if (hasPair && choice === next[1 - slot]) next[1 - slot] = next[slot];
            next[slot] = choice; setRequested(next);
          }}>
            {candidates.map((item, index) => <option value={index} key={index}>Candidate {index + 1} · {number(item.score)} points</option>)}
          </select>
          <div className="candidate-score"><strong>{number(candidate.score)}</strong><span>rule points / 100</span></div>
          <dl><div><dt>Identity evidence</dt><dd>{evidenceState(candidate.identity_verified)}</dd></div>
            <div><dt>Arithmetic only</dt><dd>{candidate.arithmetic?.financially_verified === true ? 'Verified' : candidate.arithmetic?.financially_verified === false ? 'Not verified' : 'Not recorded'}</dd></div></dl>
        </article>)}
      </div>
      <div className="candidate-comparison-tools">
        <p aria-live="polite">{gap === 0 ? 'Equal scores · no lead between these two.' : gap !== null ? `Displayed score gap: ${gap} points. This is not a match decision.` : 'No second candidate to compare.'}
          {shared > 0 && <span>These alternatives share {shared} source {shared === 1 ? 'record' : 'records'} and cannot both be accepted.</span>}</p>
        {hasPair && <label><input type="checkbox" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)}/> Differences only</label>}
      </div>
      <ComparisonTable {...tableProps} section="summary" caption="Source references and money flow"/>
      <p className="candidate-note">Matching amounts alone do not establish which payment belongs to a settlement. Alternatives are not added together.</p>
      <details className="candidate-details"><summary>Score breakdown <span>6 rule signals</span></summary>
        <p>{evidence.score_basis || 'Recorded rule points. This score is not calibrated confidence.'}</p>
        <ComparisonTable {...tableProps} section="score" caption="Rule points by signal"/>
      </details>
      <details className="candidate-details"><summary>Link evidence & timing <span>Identity checks</span></summary>
        <p>“Not established” means a link was not supported, not that metadata necessarily conflicts. Hard-conflict candidates are excluded by the backend. Similarity alone does not establish identity.</p>
        <p>Recorded windows: ledger → settlement {number(evidence.settlement_window_hours)} hours; settlement → bank {number(evidence.bank_window_hours)} hours.</p>
        <ComparisonTable {...tableProps} section="links" caption="Cross-source evidence"/>
      </details>
      <details className="candidate-details"><summary>Financial checks <span>Backend verification</span></summary>
        <p>Expected net = ledger gross − declared fee − declared GST − refunds. All amounts and differences below come from the backend; this screen does not rerun or override verification.</p>
        <ComparisonTable {...tableProps} section="financial" caption="Recorded arithmetic checks"/>
      </details>
      <details className="candidate-details"><summary>Exact source records <span>Audit identifiers</span></summary>
        <div className="candidate-record-columns">{selected.map((candidate, slot) => <div key={indexes[slot]}><h4>Candidate {indexes[slot] + 1}</h4>
          {['ledger', 'settlement', 'bank'].map(source => <div key={source}><strong>{source}</strong>
            {(candidate.record_ids?.[source] || []).map(recordId => <div key={recordId} className="candidate-record-id"><span>{transactions.find(row => row.record_id === recordId)?.external_ref || 'Reference unavailable'}</span><code>{recordId}</code></div>)}
          </div>)}
        </div>)}</div>
      </details>
    </>}
    <div className="candidate-guardrail">Approval is unavailable for candidate-review cases. A clear source assignment must be established and independently verified; this comparison cannot force a match.</div>
  </section>;
}

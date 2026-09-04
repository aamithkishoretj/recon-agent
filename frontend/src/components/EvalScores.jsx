import { useState, useEffect } from 'react';
import { getEvalScores } from '../api';
import { scorePercent } from '../lib/evaluation';

export default function EvalScores({ refreshKey = 0 }) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${refreshKey}:${retry}`;
  const [result, setResult] = useState({ key: null, scores: null, error: null });

  useEffect(() => {
    let active = true;
    getEvalScores()
      .then(scores => { if (active) setResult({ key: requestKey, scores, error: null }); })
      .catch(error => { if (active) setResult(current => ({ key: requestKey, scores: current.scores, error: error.message })); });
    return () => { active = false; };
  }, [requestKey]);

  const loading = result.key !== requestKey;
  const scores = result.scores;
  const error = result.key === requestKey ? result.error : null;

  if (error) return <div className="callout" role="alert"><span>Accuracy unavailable: {error}</span><button className="btn btn-ghost btn-sm" onClick={() => setRetry(v => v + 1)}>Retry evaluation</button></div>;
  if (!scores) return <p role="status">Evaluating source records…</p>;

  const items = [
    ['Match precision', scorePercent(scores.match_precision), 'Correct auto-matches / all auto-matches'],
    ['Match recall', scorePercent(scores.match_recall), 'Correct auto-matches / expected matches'],
    ['False matches', scores.false_positives, 'Wrong membership or failed arithmetic'],
    ['Missed matches', scores.false_negatives, 'Expected matches not correctly produced'],
  ];
  return <section className="evaluation-results" aria-label="Record-level evaluation" aria-busy={loading}>
    <div className="evaluation-heading"><span className={'badge ' + (scores.all_checks_passed ? 'badge-success' : 'badge-danger')}>{loading ? 'Refreshing…' : scores.all_checks_passed ? 'All checks passed' : 'Checks need attention'}</span><span>{scores.total_ground_truth_events} synthetic events · {scores.expected_groups} expected groups</span></div>
    <div className="evaluation-grid">{items.map(([label, value, hint]) => <div key={label} className="evaluation-stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
    {!scores.dataset_aligned && <p className="callout" role="alert">Source data does not match this ground truth: {scores.missing_source_refs.length} missing, {scores.unexpected_source_refs.length} unexpected, {scores.duplicate_source_refs} repeated references. These scores are not a valid benchmark for this dataset.</p>}
    {scores.financial_validation_failures > 0 && <p className="callout" role="alert">{scores.financial_validation_failures} stored automatic matches fail the current money-flow checks.</p>}
    {scores.legacy_auto_matches > 0 && <p className="callout">{scores.legacy_auto_matches} stored matches predate the current rules. Evaluate a fresh demo before presenting its results.</p>}
    <div className="table-wrap"><table><caption>Exception accuracy — exact records and correct category</caption><thead><tr><th>Category</th><th>Expected</th><th>Detected</th><th>Correct</th></tr></thead><tbody>
      {Object.entries(scores.exception_breakdown).map(([category, row]) => <tr key={category}><td>{category.replaceAll('_', ' ')}</td><td>{row.expected}</td><td>{row.actual}</td><td className={row.match ? 'positive' : 'negative'}>{row.correct}</td></tr>)}
    </tbody></table></div>
    <p className="evaluation-note">Exception precision {scorePercent(scores.exception_precision)} · Exception recall {scorePercent(scores.exception_recall)} · False-match rate {scorePercent(scores.false_match_rate)}.</p>
    {scores.errors.length > 0 && <details className="evaluation-errors"><summary>Inspect {scores.errors.length} evaluation findings</summary><ul>{scores.errors.map((entry, i) => <li key={i}><strong>{entry.kind.replaceAll('_', ' ')}</strong>{entry.reason && <p>{entry.reason}</p>}<code>{entry.references.map(([source, ref]) => source + ': ' + ref).join(' · ')}</code></li>)}</ul></details>}
    <p className="evaluation-note">{scores.definition} Results describe this synthetic batch only; they do not establish production accuracy.</p>
  </section>;
}

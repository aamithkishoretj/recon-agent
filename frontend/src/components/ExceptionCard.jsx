import React, { useState } from 'react';
import StatusBadge from './StatusBadge';
import { reviewException } from '../api';
import CandidateComparison from './CandidateComparison';
import { isCandidateCase } from '../lib/candidates.js';

const formatAmt = (paise) => {
  if (paise == null) return '—';
  return `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

function EvidenceTable({ evidence }) {
  if (!evidence) return null;
  const rows = Object.entries(evidence).filter(([k]) => k !== 'evidence_fields');
  return (
    <div style={{ marginTop: 12 }}>
      <div className="section-label">Evidence Breakdown</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {rows.map(([key, val]) => (
          <div key={key} style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
          }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
              {key.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {typeof val === 'number' && (key.includes('paise') || ['gross_ledger_amount', 'fee', 'gst', 'refunds', 'expected_settlement', 'reported_settlement', 'observed_bank_total'].includes(key)) ? formatAmt(val) : typeof val === 'object' ? JSON.stringify(val) : String(val)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransactionTable({ transactions }) {
  if (!transactions?.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-label">Linked Transactions</div>
      <div className="table-wrap" style={{ marginTop: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Source</th>
              <th>Ref</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.record_id}>
                <td><StatusBadge value={t.role} showDot={false} /></td>
                <td style={{ textTransform: 'capitalize', color: 'var(--text-primary)', fontWeight: 500 }}>{t.source_type}</td>
                <td className="font-mono text-xs">{t.external_ref || '—'}</td>
                <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatAmt(t.amount_minor_units)}</td>
                <td><StatusBadge value={t.status} showDot={false} /></td>
                <td className="text-xs text-muted">{formatDate(t.timestamp_utc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AIHypothesisPanel({ hypothesis }) {
  if (!hypothesis) return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px dashed var(--border)',
      borderRadius: 8,
      padding: '16px 20px',
      fontSize: '0.8rem',
      color: 'var(--text-muted)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    }}>
      <span>🤖</span>
      <span>No AI assessment is attached. AI investigation supports open amount-discrepancy and ambiguous-candidate cases.</span>
    </div>
  );

  const conf = Math.round((hypothesis.confidence || 0) * 100);
  const confColor = conf >= 70 ? 'var(--success)' : conf >= 40 ? 'var(--warning)' : 'var(--danger)';
  const candidateAssessment = hypothesis.analysis_kind === 'ambiguous_candidate';
  const heading = hypothesis.explanation?.startsWith('[MOCK')
    ? `Mock ${candidateAssessment ? 'candidate assessment' : 'hypothesis'} · no model call`
    : candidateAssessment ? 'AI candidate assessment · no winner selected' : 'AI hypothesis · not verified';

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${hypothesis.resolved ? 'rgba(16,185,129,0.2)' : 'rgba(139,92,246,0.2)'}`,
      borderRadius: 8,
      padding: '18px 20px',
      marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.1rem' }}>🤖</span>
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{heading}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hypothesis.resolved
            ? <span className="badge badge-success">✓ Explainable</span>
            : <span className="badge badge-purple">? {candidateAssessment ? 'Identity unresolved' : 'Insufficient Evidence'}</span>
          }
          {hypothesis.suggested_category && (
            <span className="badge badge-info">{hypothesis.suggested_category}</span>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          <span style={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Confidence</span>
          <span style={{ fontWeight: 700, color: confColor }}>{conf}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${conf}%`, background: confColor }} />
        </div>
      </div>

      {/* Explanation */}
      <div style={{
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 6,
        padding: '12px 14px',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)',
        lineHeight: 1.65,
        marginBottom: hypothesis.evidence_fields_used?.length ? 12 : 0,
        fontStyle: hypothesis.explanation?.startsWith('[MOCK') ? 'italic' : 'normal',
      }}>
        {hypothesis.explanation}
      </div>

      {/* Evidence fields used */}
      {hypothesis.evidence_fields_used?.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Evidence Used
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {hypothesis.evidence_fields_used.map((f) => (
              <span key={f} className="badge badge-neutral" style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Evidence sent to AI */}
      {hypothesis.evidence_sent && (
        <div style={{ marginTop: 12 }}>
          <EvidenceTable evidence={hypothesis.evidence_sent} />
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ exception, onReviewed }) {
  const [action, setAction]     = useState(null); // 'approve' | 'reject'
  const [reviewer, setReviewer] = useState('');
  const [notes, setNotes]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  if (exception.status === 'resolved') {
    return (
      <div style={{
        background: 'var(--success-bg)',
        border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: 8,
        padding: '14px 18px',
        fontSize: '0.8rem',
        color: 'var(--success)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
      }}>
        ✅ This exception has been resolved.
        {exception.resolved_at && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            at {formatDate(exception.resolved_at)}
          </span>
        )}
      </div>
    );
  }

  const submit = async () => {
    if (action === 'approve' && isCandidateCase(exception)) { setError('Candidate-review cases cannot be approved from this screen.'); return; }
    if (!reviewer.trim()) { setError('Reviewer name is required'); return; }
    if (!notes.trim()) { setError('Audit notes are required'); return; }
    setLoading(true); setError(null);
    try {
      await reviewException(exception.exception_id, { action, reviewer_name: reviewer.trim(), notes: notes.trim(), expected_status: exception.status });
      onReviewed();
      setAction(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-label">Human Review</div>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 18px',
        marginTop: 8,
      }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          {isCandidateCase(exception) ? 'Approval is unavailable while candidate assignment is unresolved. Comparing candidates does not choose a match. Rejection keeps the case unresolved.' : 'Approval reruns every money-flow check. An AI hypothesis or reviewer confidence cannot override missing or inconsistent source evidence. Rejection keeps the case unresolved.'}
        </p>

        {/* Action selector */}
        {!action ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-success" disabled={isCandidateCase(exception)} onClick={() => setAction('approve')}>
              <span>✓</span> Approve verified match
            </button>
            <button className="btn btn-danger" disabled={exception.status === 'reopened'} onClick={() => setAction('reject')}>
              <span>✕</span> Reject
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 6,
              background: action === 'approve' ? 'var(--success-bg)' : 'var(--danger-bg)',
              fontSize: '0.8rem',
              color: action === 'approve' ? 'var(--success)' : 'var(--danger)',
              fontWeight: 600,
            }}>
              {action === 'approve' ? '✓ Approval creates a match only if the source checks pass' : '✕ Rejection reopens the exception; it stays unresolved'}
              <button aria-label="Cancel review action" disabled={loading} onClick={() => setAction(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem', opacity: 0.6 }}>✕</button>
            </div>

            <div>
              <label htmlFor="reviewer-name" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Your Name <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                id="reviewer-name"
                required maxLength={100} disabled={loading}
                className="input"
                placeholder="e.g. Priya Sharma"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                style={{ maxWidth: 280 }}
              />
            </div>

            <div>
              <label htmlFor="review-notes" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Notes <span style={{ color: 'var(--text-muted)' }}>(required for audit)</span>
              </label>
              <textarea
                id="review-notes"
                required maxLength={4000} disabled={loading}
                className="input"
                placeholder="Add context for the audit log…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>

            {error && (
              <div role="alert" style={{ fontSize: '0.8rem', color: 'var(--danger)', background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                id={`confirm-${action}`}
                className={`btn ${action === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={submit}
                disabled={loading}
              >
                {loading ? 'Submitting…' : `Confirm ${action === 'approve' ? 'Approval' : 'Rejection'}`}
              </button>
              <button className="btn btn-ghost" onClick={() => setAction(null)} disabled={loading}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExceptionCard({ exception, onReviewed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 4 }}>
            {exception.exception_id}
          </div>
          <StatusBadge value={exception.category} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <StatusBadge value={exception.status} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Priority</span>
            <div style={{
              background: exception.priority_score > 5000 ? 'var(--danger-bg)' : exception.priority_score > 1000 ? 'var(--warning-bg)' : 'var(--bg-hover)',
              color: exception.priority_score > 5000 ? 'var(--danger)' : exception.priority_score > 1000 ? 'var(--warning)' : 'var(--text-muted)',
              padding: '2px 8px',
              borderRadius: 100,
              fontSize: '0.72rem',
              fontWeight: 700,
            }}>
              {exception.priority_score.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="divider" />

      {/* Metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Created</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDate(exception.created_at)}</div>
        </div>
        {exception.resolved_at && (
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Resolved</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDate(exception.resolved_at)}</div>
          </div>
        )}
      </div>

      <div className="divider" />

      {/* AI Hypothesis */}
      {isCandidateCase(exception) ? <CandidateComparison exception={exception}/> : exception.system_evidence && <details className="system-evidence" open><summary>Why this case needs review</summary><p>{exception.system_evidence.notes}</p><EvidenceTable evidence={exception.system_evidence.evidence}/></details>}
      <div>
        <div className="section-label">AI Hypothesis</div>
        <AIHypothesisPanel hypothesis={exception.ai_hypothesis} />
      </div>

      <div className="divider" />

      {/* Transactions */}
      <TransactionTable transactions={exception.transactions} />

      {/* Review */}
      <ReviewPanel exception={exception} onReviewed={onReviewed} />
    </div>
  );
}

import React from 'react';
import StatusBadge from './StatusBadge';

const formatAmt = (paise) => {
  if (paise == null) return '—';
  return `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

function EvidenceGrid({ explanation }) {
  if (!explanation) return null;
  const fields = Object.entries(explanation).filter(([k]) => !['evidence_fields', 'human_notes'].includes(k));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginTop: 12 }}>
      {fields.map(([key, val]) => (
        <div key={key} style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 12px',
        }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
            {key.replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {typeof val === 'number' && (key.includes('paise') || key.includes('amount') || ['fee', 'gst', 'refunds', 'expected_settlement', 'reported_settlement', 'observed_bank_total'].includes(key))
              ? formatAmt(val)
              : typeof val === 'number' && key.includes('hours')
              ? `${val}h`
              : val !== null && typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionTable({ transactions }) {
  if (!transactions?.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-label">Transactions</div>
      <div className="table-wrap" style={{ marginTop: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
        <table>
          <thead>
            <tr>
              <th>Role</th><th>Source</th><th>Ref</th>
              <th>Amount</th><th>Status</th><th>Date</th>
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

export default function MatchCard({ match }) {
  const conf = Math.round((match.confidence || 0) * 100);
  const confColor = conf >= 95 ? 'var(--success)' : conf >= 80 ? 'var(--info)' : 'var(--warning)';

  const humanNotes = match.explanation?.human_notes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 6 }}>
            {match.match_id}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge value={match.match_type} />
            <StatusBadge value={match.status} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Rule score</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: confColor }}>{conf}%</div>
        </div>
      </div>

      {/* Confidence bar */}
      <p className="evaluation-note">Rule score is not a calibrated probability. Fees and GST are declared source amounts, not independently verified tariffs.</p>
      <div className="progress-bar" style={{ marginBottom: 16 }}>
        <div className="progress-fill" style={{ width: `${conf}%`, background: confColor }} />
      </div>

      {/* Metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Created</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDate(match.created_at)}</div>
        </div>
        {match.reviewed_at && (
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Reviewed</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDate(match.reviewed_at)}</div>
          </div>
        )}
      </div>

      {humanNotes && (
        <div style={{ marginTop: 12, background: 'var(--primary-glow)', border: '1px solid rgba(59,126,248,0.2)', borderRadius: 8, padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--primary-light)' }}>Reviewer Notes: </span>
          {humanNotes}
        </div>
      )}

      <div className="divider" />

      {/* Evidence */}
      {match.explanation && (
        <div>
          <div className="section-label">Match Evidence</div>
          <EvidenceGrid explanation={match.explanation} />
          {match.explanation.evidence_fields?.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {match.explanation.evidence_fields.map((f, i) => (
                <span key={i} className="badge badge-neutral" style={{ fontFamily: 'monospace', fontSize: '0.65rem' }}>{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="divider" />

      {/* Transactions */}
      <TransactionTable transactions={match.transactions} />
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { getExceptions, runAIReasoning } from '../api';
import StatusBadge from './StatusBadge';
import ExceptionCard from './ExceptionCard';

const CATEGORIES = [
  '', 'missing_ledger', 'missing_settlement', 'missing_bank_credit',
  'duplicate', 'amount_discrepancy', 'timing_discrepancy',
  'unknown_adjustment', 'ambiguous_candidate', 'refund_mismatch', 'currency_mismatch',
];

const formatAmt = (paise) => {
  if (paise == null) return '—';
  return `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
};

function ExceptionRow({ exc, onSelect, isSelected }) {
  const maxAmt = exc.transactions?.reduce((m, t) => Math.max(m, Math.abs(t.amount_minor_units || 0)), 0) || 0;

  return (
    <tr
      id={`exc-row-${exc.exception_id.slice(0, 8)}`}
      onClick={() => onSelect(exc)}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'var(--primary-glow)' : undefined,
      }}
    >
      <td>
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {exc.exception_id.slice(0, 8)}…
        </span>
      </td>
      <td><StatusBadge value={exc.category} /></td>
      <td>
        <div style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 100,
          fontSize: '0.72rem', fontWeight: 700,
          background: exc.priority_score > 5000 ? 'var(--danger-bg)' : exc.priority_score > 1000 ? 'var(--warning-bg)' : 'var(--bg-hover)',
          color: exc.priority_score > 5000 ? 'var(--danger)' : exc.priority_score > 1000 ? 'var(--warning)' : 'var(--text-muted)',
        }}>
          {exc.priority_score.toLocaleString()}
        </div>
      </td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatAmt(maxAmt)}</td>
      <td><StatusBadge value={exc.status} /></td>
      <td>
        {exc.ai_hypothesis ? (
          <span style={{ fontSize: '0.72rem', color: exc.ai_hypothesis.resolved ? 'var(--success)' : 'var(--purple)' }}>
            {exc.ai_hypothesis.resolved ? '✓ Explainable' : '? Insufficient'}
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              ({Math.round((exc.ai_hypothesis.confidence || 0) * 100)}%)
            </span>
          </span>
        ) : (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pending</span>
        )}
      </td>
      <td className="text-xs text-muted">{formatDate(exc.created_at)}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--primary-light)', fontSize: '0.75rem' }}>
          Review <span style={{ opacity: 0.6 }}>→</span>
        </div>
      </td>
    </tr>
  );
}

export default function ExceptionQueue({ onCountChange }) {
  const [result, setResult] = useState({ key: null, exceptions: [], error: null });
  const [statusFilter,   setStatusFilter]   = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected,       setSelected]       = useState(null);
  const [toast,          setToast]          = useState(null);
  const [page,           setPage]           = useState(0);
  const [aiRunning,      setAiRunning]      = useState(false);
  const [refresh,        setRefresh]        = useState(0);

  const PAGE_SIZE = 20;
  const requestKey = `${statusFilter}:${categoryFilter}:${page}:${refresh}`;

  useEffect(() => {
    let active = true;
    getExceptions({
        status:   statusFilter   || undefined,
        category: categoryFilter || undefined,
        limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      })
      .then(exceptions => {
        if (!active) return;
        setResult({ key: requestKey, exceptions, error: null });
        onCountChange?.(exceptions.filter(e => e.status === 'open').length);
      })
      .catch(error => { if (active) setResult({ key: requestKey, exceptions: [], error: error.message }); });
    return () => { active = false; };
  }, [requestKey, statusFilter, categoryFilter, page, onCountChange]);

  const loading = result.key !== requestKey;
  const exceptions = result.key === requestKey ? result.exceptions : [];
  const error = result.key === requestKey ? result.error : null;
  const load = () => setRefresh(value => value + 1);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const handleReviewed = async () => {
    showToast('Review submitted! Exception resolved.');
    setSelected(null);
    load();
  };

  const handleRunAI = async () => {
    setAiRunning(true);
    try {
      const result = await runAIReasoning();
      if (result.total_processed === 0) {
        showToast('No open amount-discrepancy or candidate-ambiguity cases remain.', 'success');
      } else {
        showToast(
          `🤖 ${result.mode.toUpperCase()} MODE — ${result.total_processed} exceptions processed. ` +
          `${result.resolved_hypothesis} explainable · ${result.declined_hypothesis} declined.`,
          'success'
        );
      }
      load();
    } catch (e) {
      showToast(`AI reasoning failed: ${e.message}`, 'error');
    } finally {
      setAiRunning(false);
    }
  };

  const openCount     = exceptions.filter(e => e.status === 'open').length;
  const reviewCount   = exceptions.filter(e => e.status === 'in_review').length;
  const resolvedCount = exceptions.filter(e => e.status === 'resolved').length;

  return (
    <div className="fade-in-up">
      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.msg}
        </div>
      )}

      {/* Drawer */}
      {selected && (
        <>
          <div className="drawer-overlay" onClick={() => setSelected(null)} />
          <div className="drawer">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Exception Detail</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕ Close</button>
            </div>
            <ExceptionCard exception={selected} onReviewed={handleReviewed} />
          </div>
        </>
      )}

      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Exception Queue</h1>
          <p className="page-subtitle">AI proposes — you decide. Review flagged discrepancies and resolve them.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* ★ Run AI Analysis button */}
          <button
            id="run-ai-btn"
            className="btn btn-primary"
            onClick={handleRunAI}
            disabled={aiRunning}
            style={{ gap: 8 }}
          >
            {aiRunning ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                Running Gemini…
              </>
            ) : (
              <>🤖 Run AI Analysis</>
            )}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* AI info banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,126,248,0.08))',
        border: '1px solid rgba(139,92,246,0.2)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 18px',
        marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: '0.8rem', color: 'var(--text-secondary)',
      }}>
        <span style={{ fontSize: '1.2rem' }}>🤖</span>
        <div>
          <strong style={{ color: 'var(--purple)' }}>"AI proposes, human decides"</strong>
          {' '}— Click <strong>Run AI Analysis</strong> to send all open <em>Amount Discrepancy</em> exceptions to Gemini for hypothesis generation.
          The AI writes its reasoning but <em>never</em> creates a Match — only your Approve/Reject does.
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Open',      count: openCount,     color: 'var(--danger)',  filter: 'open' },
          { label: 'In Review', count: reviewCount,   color: 'var(--warning)', filter: 'in_review' },
          { label: 'Resolved',  count: resolvedCount, color: 'var(--success)', filter: 'resolved' },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => { setStatusFilter(statusFilter === item.filter ? '' : item.filter); setPage(0); }}
            style={{
              background: statusFilter === item.filter ? `${item.color}15` : 'var(--bg-card)',
              border: `1px solid ${statusFilter === item.filter ? item.color : 'var(--border)'}`,
              borderRadius: 8, padding: '10px 18px',
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer', transition: 'all var(--transition)', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: item.color }}>{item.count}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <select id="filter-status" className="input" style={{ maxWidth: 180 }} value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}>
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
          <option value="reopened">Reopened</option>
        </select>
        <select id="filter-category" className="input" style={{ maxWidth: 220 }} value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c ? c.replace(/_/g, ' ') : 'All Categories'}</option>
          ))}
        </select>
        {(statusFilter || categoryFilter) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setStatusFilter(''); setCategoryFilter(''); setPage(0); }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {error ? (
        <div className="card" style={{ background: 'var(--danger-bg)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--danger)' }}>
          ⚠️ {error} — make sure the backend is running at port 8000.
        </div>
      ) : loading ? (
        <div className="card">
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="skeleton" style={{ height: 16, width: 80 }} />
              <div className="skeleton" style={{ height: 22, width: 130, borderRadius: 100 }} />
              <div className="skeleton" style={{ height: 16, width: 50 }} />
              <div className="skeleton" style={{ height: 16, width: 70 }} />
            </div>
          ))}
        </div>
      ) : exceptions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No exceptions found</div>
            <div style={{ fontSize: '0.8rem' }}>Try adjusting filters or run the pipeline to generate data.</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Category</th><th>Priority</th>
                  <th>Amount</th><th>Status</th><th>AI Verdict</th><th>Created</th><th></th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map(exc => (
                  <ExceptionRow key={exc.exception_id} exc={exc} onSelect={setSelected}
                    isSelected={selected?.exception_id === exc.exception_id} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Showing {exceptions.length} exceptions (page {page + 1})
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => p + 1)} disabled={exceptions.length < PAGE_SIZE}>Next →</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

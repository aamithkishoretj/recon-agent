import React, { useState, useEffect } from 'react';
import { getMatches } from '../api';
import StatusBadge from './StatusBadge';
import MatchCard from './MatchCard';

const MATCH_TYPES = ['', 'deterministic', 'fuzzy', 'ai', 'human'];

const formatAmt = (paise) => {
  if (paise == null) return '—';
  return `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
};

function MatchRow({ match, onSelect, isSelected }) {
  const maxAmt = match.transactions?.reduce((m, t) => Math.max(m, Math.abs(t.amount_minor_units || 0)), 0) || 0;
  const conf = Math.round((match.confidence || 0) * 100);
  const confColor = conf >= 95 ? 'var(--success)' : conf >= 80 ? 'var(--info)' : 'var(--warning)';

  return (
    <tr
      id={`match-row-${match.match_id.slice(0, 8)}`}
      onClick={() => onSelect(match)}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'var(--primary-glow)' : undefined,
      }}
    >
      <td>
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {match.match_id.slice(0, 8)}…
        </span>
      </td>
      <td><StatusBadge value={match.match_type} /></td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="progress-bar" style={{ width: 60, height: 4 }}>
            <div className="progress-fill" style={{ width: `${conf}%`, background: confColor }} />
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: confColor }}>{conf}%</span>
        </div>
      </td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatAmt(maxAmt)}</td>
      <td>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {match.transactions?.length || 0} txns
        </span>
      </td>
      <td><StatusBadge value={match.status} /></td>
      <td className="text-xs text-muted">{formatDate(match.created_at)}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--primary-light)', fontSize: '0.75rem' }}>
          Detail <span style={{ opacity: 0.6 }}>→</span>
        </div>
      </td>
    </tr>
  );
}

export default function MatchList() {
  const [result, setResult] = useState({ key: null, matches: [], error: null });
  const [typeFilter, setTypeFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [page,     setPage]     = useState(0);
  const [search,   setSearch]   = useState('');
  const [refresh, setRefresh] = useState(0);

  const PAGE_SIZE = 20;
  const requestKey = `${typeFilter}:${page}:${refresh}`;

  useEffect(() => {
    let active = true;
    getMatches({
        match_type: typeFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(matches => { if (active) setResult({ key: requestKey, matches, error: null }); })
      .catch(error => { if (active) setResult({ key: requestKey, matches: [], error: error.message }); });
    return () => { active = false; };
  }, [requestKey, typeFilter, page]);

  const loading = result.key !== requestKey;
  const matches = result.key === requestKey ? result.matches : [];
  const error = result.key === requestKey ? result.error : null;
  const load = () => setRefresh(value => value + 1);

  const filtered = search.trim()
    ? matches.filter(m =>
        m.match_id.includes(search) ||
        m.transactions?.some(t => (t.external_ref || '').includes(search))
      )
    : matches;

  // Type breakdown
  const typeCounts = matches.reduce((acc, m) => {
    acc[m.match_type] = (acc[m.match_type] || 0) + 1;
    return acc;
  }, {});

  const TYPE_COLORS = {
    deterministic: 'var(--success)',
    fuzzy:         'var(--info)',
    ai:            'var(--purple)',
    human:         'var(--primary)',
  };

  return (
    <div className="fade-in-up">
      {/* Drawer */}
      {selected && (
        <>
          <div className="drawer-overlay" onClick={() => setSelected(null)} />
          <div className="drawer">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Match Detail</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕ Close</button>
            </div>
            <MatchCard match={selected} />
          </div>
        </>
      )}

      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Matches</h1>
          <p className="page-subtitle">Automatically reconciled transaction groups — deterministic, fuzzy, AI, and human-verified.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Type pill filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {MATCH_TYPES.map(type => (
          <button
            key={type || 'all'}
            onClick={() => { setTypeFilter(type); setPage(0); }}
            style={{
              background: typeFilter === type ? `${TYPE_COLORS[type] || 'var(--primary)'}15` : 'var(--bg-card)',
              border: `1px solid ${typeFilter === type ? (TYPE_COLORS[type] || 'var(--primary)') : 'var(--border)'}`,
              borderRadius: 100,
              padding: '6px 16px',
              fontSize: '0.8rem',
              fontFamily: 'inherit',
              fontWeight: 500,
              color: typeFilter === type ? (TYPE_COLORS[type] || 'var(--primary)') : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all var(--transition)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {type ? `${type.charAt(0).toUpperCase() + type.slice(1)}` : 'All'}
            {type && typeCounts[type] > 0 && (
              <span style={{ fontWeight: 700 }}>({typeCounts[type]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          id="match-search"
          className="input"
          style={{ maxWidth: 360 }}
          placeholder="Search by match ID or transaction ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              <div className="skeleton" style={{ height: 22, width: 100, borderRadius: 100 }} />
              <div className="skeleton" style={{ height: 8, width: 80, borderRadius: 100 }} />
              <div className="skeleton" style={{ height: 16, width: 70 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No matches found</div>
            <div style={{ fontSize: '0.8rem' }}>Try adjusting your filters or run the pipeline to generate data.</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Confidence</th>
                  <th>Amount</th>
                  <th>Transactions</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((match) => (
                  <MatchRow
                    key={match.match_id}
                    match={match}
                    onSelect={setSelected}
                    isSelected={selected?.match_id === match.match_id}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Showing {filtered.length} matches (page {page + 1})
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => p + 1)} disabled={matches.length < PAGE_SIZE}>Next →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

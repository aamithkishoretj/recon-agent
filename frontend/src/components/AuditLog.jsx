import { useEffect, useMemo, useState } from 'react';
import { getAuditLog } from '../api';
import { fetchAll, titleCase } from '../lib/workspace';
import Icon from './Icon';
const actionTitle = value => value === 'human_rejectd' ? 'Human rejected' : titleCase(value);
export default function AuditLog({ refreshKey, onOpenEntity }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [actor, setActor] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    let current = true;
    fetchAll(getAuditLog).then(data => { if (current) { setLogs(data); setError(null); } })
      .catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refreshKey, version]);
  const filtered = useMemo(() => logs.filter(log => (!actor || (actor === 'human' ? !['system', 'ai'].includes(log.actor) : log.actor === actor))
    && (!type || log.entity_type === type)
    && [log.entity_id, log.actor, log.action, JSON.stringify(log.details)].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [logs, actor, type, query]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  const visible = filtered.slice(safePage * 20, (safePage + 1) * 20);
  const count = kind => logs.filter(l => !kind || (kind === 'human' ? !['system', 'ai'].includes(l.actor) : l.actor === kind)).length;
  return <section className="audit-workspace page-enter">
    <div className="workspace-page-heading"><div><div className="overline">EVERY ACTION, ACCOUNTED FOR</div><h1>Audit trail<span className="heading-count">{logs.length}</span></h1><p>Follow the chain from system detection to human decision.</p></div><button className="btn btn-ghost" onClick={() => setVersion(v => v + 1)}><Icon name="refresh" size={15}/>Refresh activity</button></div>
    <div className="record-tabs">{[['', 'All activity'], ['system', 'System'], ['ai', 'AI investigation'], ['human', 'Human decisions']].map(([key, label]) => <button key={key} aria-pressed={actor === key} className={actor === key ? 'active' : ''} onClick={() => { setActor(key); setPage(0); }}>{label}<span>{count(key)}</span></button>)}</div>
    <div className="workbench-panel"><div className="table-toolbar"><label className="search-field"><Icon name="search" size={16}/><input aria-label="Search audit activity" placeholder="Search entity ID, actor, or event…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label><label className="select-field"><Icon name="filter" size={15}/><select aria-label="Filter audit entity" value={type} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">All entities</option><option value="exception">Exceptions</option><option value="match">Matches</option></select></label></div>
      {error && <p className="workspace-error" role="alert">{error} · {logs.length ? 'Showing the last loaded entries.' : 'Try refreshing the activity.'}</p>}
      {loading ? <div className="workspace-empty" role="status">Loading audit events…</div> : <div className="audit-timeline">{visible.map(log => <details className="audit-event" key={log.audit_id}>
        <summary><span className={'audit-avatar ' + (log.actor === 'ai' ? 'violet' : log.actor === 'system' ? 'blue' : 'green')}><Icon name={log.actor === 'ai' ? 'zap' : log.actor === 'system' ? 'layers' : 'check'} size={16}/></span><span className="audit-event-content"><strong>{actionTitle(log.action)}</strong><small><span>{log.actor === 'ai' ? 'AI' : log.actor}</span><span>·</span>{titleCase(log.entity_type)}<span className="font-mono">{log.entity_id.slice(0, 8)}</span></small></span><time dateTime={log.created_at}>{new Date(log.created_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(log.created_at) ? log.created_at : log.created_at + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><Icon name="down" size={14}/></summary>
        <div className="audit-event-details"><div><span className="eyebrow">RECORDED EVIDENCE</span><button className="text-button" onClick={() => onOpenEntity(log.entity_id)}>Open linked record<Icon name="arrow" size={13}/></button></div><pre>{JSON.stringify(log.details || { note: 'No additional details recorded.' }, null, 2)}</pre><small className="font-mono">{log.audit_id}</small></div>
      </details>)}</div>}
      {!loading && !filtered.length && <div className="workspace-empty"><Icon name="activity" size={28}/><h3>No activity in this view</h3><p>{actor === 'human' ? 'Human decisions appear here after a review is submitted.' : 'Try another search or filter.'}</p><button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setActor(''); setType(''); setPage(0); }}>Show all activity</button></div>}
      <div className="table-pagination"><span>{filtered.length ? safePage * 20 + 1 : 0}–{Math.min((safePage + 1) * 20, filtered.length)} of {filtered.length} events</span><div><button className="icon-button" aria-label="Previous audit page" disabled={!safePage} onClick={() => setPage(safePage - 1)}><Icon name="chevron" className="rotate-180" size={15}/></button><span>{safePage + 1} / {Math.max(1, Math.ceil(filtered.length / 20))}</span><button className="icon-button" aria-label="Next audit page" disabled={(safePage + 1) * 20 >= filtered.length} onClick={() => setPage(safePage + 1)}><Icon name="chevron" size={15}/></button></div></div>
    </div><p className="table-footnote"><Icon name="shield" size={14}/>Read-only activity feed. Expand an event to inspect its recorded details.</p>
  </section>;
}

import { useMemo, useState } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import Modal from './Modal';
import { runAIReasoning } from '../api';
import { filterRecords, sortRecords, recordId, recordRef, recordAmount, money, titleCase, exportRecords } from '../lib/workspace';
import { isAIInvestigable } from '../lib/candidates';

export default function RecordWorkbench({ kind, records, initialFilters, favorites, onFavorite, onOpen, onRefresh, notify }) {
  const isExceptions = kind === 'exceptions';
  const [filters, setFilters] = useState({ search: initialFilters.search || '', status: initialFilters.status || '', category: initialFilters.category || '', type: initialFilters.type || '', starred: initialFilters.starred === 'true' });
  const [sort, setSort] = useState(isExceptions ? 'priority' : 'created');
  const [direction, setDirection] = useState('desc');
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState([]);
  const [confirmAI, setConfirmAI] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState('');
  const size = 15;
  const filtered = useMemo(() => sortRecords(filterRecords(records, filters, favorites), sort, direction), [records, filters, favorites, sort, direction]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  const visible = filtered.slice(safePage * size, (safePage + 1) * size);
  const selectedRows = filtered.filter(r => selected.includes(recordId(r)));
  const allOnPage = visible.length > 0 && visible.every(r => selected.includes(recordId(r)));
  const categories = [...new Set(records.map(r => r.category))].filter(Boolean).sort();
  const openAI = records.filter(isAIInvestigable).length;
  const change = patch => { setFilters(current => ({ ...current, ...patch })); setPage(0); setSelected([]); };
  const reset = () => change({ search: '', status: '', category: '', type: '', starred: false });
  const toggleSelected = id => setSelected(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]);
  const sortBy = value => { if (sort === value) setDirection(v => v === 'desc' ? 'asc' : 'desc'); else { setSort(value); setDirection('desc'); } setPage(0); };
  const tabs = isExceptions ? [['', 'All cases'], ['active', 'Needs attention'], ['in_review', 'In review'], ['resolved', 'Resolved']]
    : [['', 'All matches'], ['deterministic', 'Deterministic'], ['fuzzy', 'Rounding / fuzzy'], ['human', 'Human reviewed']];
  const tabKey = isExceptions ? 'status' : 'type';
  const tabCount = value => records.filter(r => !value || (value === 'active' ? r.status !== 'resolved' : r[isExceptions ? 'status' : 'match_type'] === value)).length;
  const sortHeader = (label, value) => <th aria-sort={sort === value ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button className={'sort-heading ' + (sort === value ? 'active' : '')} onClick={() => sortBy(value)}>{label}<span>{sort === value ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>;
  const runAI = async () => {
    setAiRunning(true); setAiError('');
    try {
      const result = await runAIReasoning(); setConfirmAI(false); await onRefresh();
      const byCategory = result.processed_by_category || {};
      notify(`${result.total_processed} cases analysed · ${byCategory.amount_discrepancy || 0} amount · ${byCategory.ambiguous_candidate || 0} candidate · ${result.mode} mode. Human review still required.`);
    }
    catch (e) { setAiError(e.message); }
    finally { setAiRunning(false); }
  };
  return <section className="workbench page-enter">
    <div className="workspace-page-heading"><div><h1>{isExceptions ? 'Review queue' : 'Reconciled matches'}<span className="heading-count">{records.length}</span></h1><p>{isExceptions ? 'Investigate the exceptions. Make the call with evidence.' : 'Every matched group, with the records behind it.'}</p></div>
      <div className="heading-actions"><button className="btn btn-ghost" disabled={!filtered.length} onClick={() => { exportRecords(selectedRows.length ? selectedRows : filtered, kind + '.csv'); notify('Exported ' + (selectedRows.length || filtered.length) + ' records'); }}><Icon name="download" size={16}/>Export{selectedRows.length ? ' selected' : ''}</button>
        {isExceptions && <button className="btn btn-primary" disabled={!openAI || aiRunning} onClick={() => setConfirmAI(true)}><Icon name="zap" size={16}/>AI investigation<span className="button-count">{openAI}</span></button>}</div></div>
    <div className="record-tabs">{tabs.map(([value, label]) => <button key={value} className={filters[tabKey] === value ? 'active' : ''} aria-pressed={filters[tabKey] === value} onClick={() => change({ [tabKey]: value })}>{label}<span>{tabCount(value)}</span></button>)}</div>
    <div className="workbench-panel">
      <div className="table-toolbar"><label className="search-field"><Icon name="search" size={17}/><input aria-label="Search all records" placeholder="Search reference, ID, or category…" value={filters.search} onChange={e => change({ search: e.target.value })}/>{filters.search && <button aria-label="Clear search" onClick={() => change({ search: '' })}><Icon name="close" size={14}/></button>}</label>
        <div className="table-controls">{isExceptions && <label className="select-field"><Icon name="filter" size={15}/><select aria-label="Filter category" value={filters.category} onChange={e => change({ category: e.target.value })}><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>}
          <button className={'btn btn-ghost btn-sm ' + (filters.starred ? 'is-starred' : '')} aria-pressed={filters.starred} onClick={() => change({ starred: !filters.starred })}><Icon name="star" size={15}/>Bookmarks</button>
          <button className="icon-button" aria-label={compact ? 'Use comfortable rows' : 'Use compact rows'} aria-pressed={compact} onClick={() => setCompact(v => !v)} title="Toggle row density"><Icon name="menu" size={16}/></button></div></div>
      {Object.values(filters).some(Boolean) && <div className="filter-summary"><span>{filtered.length} of {records.length} records</span>{filters.category && <span className="filter-chip">{titleCase(filters.category)}<button aria-label="Remove category filter" onClick={() => change({ category: '' })}>×</button></span>}<button className="text-button" onClick={reset}>Clear filters</button></div>}
      {selectedRows.length > 0 && <div className="selection-bar"><Icon name="check" size={16}/><strong>{selectedRows.length} selected</strong><span>Selection is local to this view</span><button className="text-button" onClick={() => { selectedRows.forEach(r => { if (!favorites.includes(recordId(r))) onFavorite(recordId(r)); }); notify('Selection bookmarked on this device'); }}>Bookmark selected</button><button className="text-button" onClick={() => setSelected([])}>Clear</button></div>}
      <div className={'table-wrap record-table ' + (compact ? 'compact' : '')}><table><thead><tr>
        <th className="check-cell"><input type="checkbox" aria-label="Select all records on this page" checked={allOnPage} disabled={!visible.length} onChange={() => setSelected(current => allOnPage ? current.filter(id => !visible.some(r => recordId(r) === id)) : [...new Set([...current, ...visible.map(recordId)])])}/></th>
        {sortHeader('Reference', 'reference')}<th>{isExceptions ? 'Exception category' : 'Match method'}</th>{sortHeader('Largest transaction', 'amount')}
        {sortHeader(isExceptions ? 'Priority' : 'Confidence', isExceptions ? 'priority' : 'confidence')}<th>Status</th><th className="bookmark-cell"><span className="sr-only">Bookmark</span></th><th><span className="sr-only">Open</span></th>
      </tr></thead><tbody>{visible.map(r => {
        const id = recordId(r); const star = favorites.includes(id); const checked = selected.includes(id);
        return <tr key={id} className={checked ? 'selected-row' : ''} onClick={() => onOpen(r)}>
          <td className="check-cell" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={'Select ' + recordRef(r)} checked={checked} onChange={() => toggleSelected(id)}/></td>
          <td><button className="record-ref" onClick={e => { e.stopPropagation(); onOpen(r); }}>{recordRef(r)}</button><small className="record-subline">{id.slice(0, 8)} · {r.transactions.length} records</small></td>
          <td><StatusBadge value={isExceptions ? r.category : r.match_type}/></td>
          <td className="amount-cell">{money(recordAmount(r))}</td>
          <td>{isExceptions ? <span className={'priority-pill ' + (r.priority_score > 5000 ? 'high' : '')}><span/>{r.priority_score.toLocaleString('en-IN')}</span> : <div className="table-confidence"><span className="confidence-track"><span style={{ width: Math.min(100, Math.max(0, r.confidence * 100)) + '%' }}/></span>{Math.round(r.confidence * 100)}%</div>}</td>
          <td><StatusBadge value={r.status}/></td>
          <td onClick={e => e.stopPropagation()}><button className={'icon-button bookmark-button ' + (star ? 'is-starred' : '')} aria-label={(star ? 'Remove bookmark ' : 'Bookmark ') + recordRef(r)} aria-pressed={star} onClick={() => onFavorite(id)}><Icon name="star" size={16}/></button></td>
          <td><Icon name="arrow" size={16} className="row-arrow"/></td>
        </tr>;
      })}</tbody></table></div>
      {!filtered.length && <div className="workspace-empty"><Icon name={filters.starred ? 'star' : 'search'} size={30}/><h3>{filters.starred ? 'No bookmarked records here' : 'No records match this view'}</h3><p>{records.length ? 'Try another search or clear the filters to start again.' : 'Run the reconciliation pipeline to populate this workspace.'}</p>{records.length > 0 && <button className="btn btn-ghost btn-sm" onClick={reset}>Clear filters</button>}</div>}
      <div className="table-pagination"><span>{filtered.length ? safePage * size + 1 : 0}–{Math.min((safePage + 1) * size, filtered.length)} of {filtered.length} records</span><span className="local-bookmarks">Bookmarks are saved on this device</span>
        <div><button className="icon-button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><Icon name="chevron" className="rotate-180" size={15}/></button><span>{safePage + 1} / {Math.max(1, Math.ceil(filtered.length / size))}</span><button className="icon-button" aria-label="Next page" disabled={(safePage + 1) * size >= filtered.length} onClick={() => setPage(safePage + 1)}><Icon name="chevron" size={15}/></button></div></div>
    </div>
    <p className="table-footnote"><Icon name="shield" size={14}/>{isExceptions ? 'Opening, selecting and bookmarking a case never approves it. Approval still requires your explicit review.' : 'Amounts shown are the largest individual transaction in each group, not the reconciled group value.'}</p>
    {confirmAI && <Modal title="Run AI investigation?" onClose={() => { if (!aiRunning) setConfirmAI(false); }}>
      <p className="confirm-copy">Investigate <strong>{openAI} open amount-discrepancy or candidate-ambiguity cases</strong>. In live mode, minimized numeric and timing evidence or anonymized candidate signals go to the configured AI provider. The demo launcher forces mock mode with no external call, even if a key is configured.</p>
      <div className="callout"><Icon name="shield"/><span>The AI adds assessments and moves cases into review. It never creates matches or selects a candidate identity.</span></div>
      {aiError && <p className="negative" role="alert">{aiError}</p>}<div className="confirm-actions"><button className="btn btn-ghost" disabled={aiRunning} onClick={() => setConfirmAI(false)}>Cancel</button><button className="btn btn-primary" disabled={aiRunning} onClick={runAI}>{aiRunning ? 'Investigating…' : 'Confirm investigation'}</button></div>
    </Modal>}
  </section>;
}

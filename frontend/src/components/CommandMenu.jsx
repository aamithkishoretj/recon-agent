import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { recordId, recordRef, searchRecord, titleCase } from '../lib/workspace';
export default function CommandMenu({ onClose, onNavigate, onOpen, matches, exceptions, onRefresh }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const actions = [
    { label: 'Go to overview', icon: 'grid', action: () => onNavigate('dashboard') },
    { label: 'Start a reconciliation run', icon: 'database', action: () => onNavigate('imports') },
    { label: 'Open review queue', icon: 'alert', action: () => onNavigate('exceptions') },
    { label: 'Browse reconciled matches', icon: 'check', action: () => onNavigate('matches') },
    { label: 'View audit trail', icon: 'activity', action: () => onNavigate('auditlog') },
    { label: 'Refresh workspace data', icon: 'refresh', action: onRefresh },
  ].filter(item => item.label.toLowerCase().includes(query.toLowerCase()));
  const records = query.trim() ? [...exceptions, ...matches].filter(r => searchRecord(r, query)).slice(0, 8).map(r => ({
    label: recordRef(r), hint: titleCase(r.category || r.match_type) + ' · ' + recordId(r).slice(0, 8),
    icon: r.exception_id ? 'alert' : 'check', action: () => onOpen(r),
  })) : [];
  const items = [...actions, ...records];
  const selected = Math.min(active, Math.max(0, items.length - 1));
  const run = item => { onClose(); item.action(); };
  return <Modal title="Search your workspace" onClose={onClose} className="command-dialog" initialFocusSelector="input"
    footer={<><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>Enter</kbd> to open <kbd>Esc</kbd> to close</span></>}>
    <div className="command-search"><Icon name="search" size={21}/><input autoFocus placeholder="Search references, exceptions, or commands…"
      aria-label="Search commands and records" role="combobox" aria-expanded="true" aria-controls="command-results"
      aria-activedescendant={items.length ? 'command-' + selected : undefined} value={query}
      onChange={e => { setQuery(e.target.value); setActive(0); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1)); }
        if (e.key === 'Enter' && items[selected]) { e.preventDefault(); run(items[selected]); }
      }}/></div>
    <div className="command-results" id="command-results" role="listbox" aria-label="Commands and records">
      <div className="eyebrow">{query ? 'RESULTS' : 'QUICK ACTIONS'}</div>
      {items.map((item, index) => <div id={'command-' + index} role="option" aria-selected={selected === index}
        key={item.label + (item.hint || '')} className={'command-option ' + (selected === index ? 'selected' : '')}
        onMouseEnter={() => setActive(index)} onClick={() => run(item)}>
        <span className="command-icon"><Icon name={item.icon}/></span><span>{item.label}{item.hint && <small>{item.hint}</small>}</span><Icon name="arrow" size={16}/>
      </div>)}
      {!items.length && <div className="workspace-empty"><Icon name="search" size={28}/><h3>No results found</h3><p>Try a ledger reference, category, or navigation command.</p></div>}
    </div>
  </Modal>;
}

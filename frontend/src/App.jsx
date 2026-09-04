import { useState, useEffect, useCallback, useRef } from 'react';
import ProductNavigation from './components/ProductNavigation';
import Dashboard from './components/Dashboard';
import RecordWorkbench from './components/RecordWorkbench';
import AuditLog from './components/AuditLog';
import ExceptionCard from './components/ExceptionCard';
import MatchCard from './components/MatchCard';
import CommandMenu from './components/CommandMenu';
import EvidenceFlow from './components/EvidenceFlow';
import Modal from './components/Modal';
import Icon from './components/Icon';
import DataIngestion from './components/DataIngestion';
import { getMetrics, getMatches, getExceptions, getDemoCases } from './api';
import { fetchAll, recordId, exportRecords } from './lib/workspace';
import { isCandidateCase } from './lib/candidates.js';
import './workspace.css';
import './product.css';

const pageNames = { dashboard: 'Overview', imports: 'New run', exceptions: 'Review queue', matches: 'Reconciled matches', auditlog: 'Audit trail' };
function readRoute() {
  const [page, query] = window.location.hash.slice(1).split('?');
  return { ...Object.fromEntries(new URLSearchParams(query)), page: pageNames[page] ? page : 'dashboard' };
}
function preference(key, fallback) {
  try { return JSON.parse(localStorage.getItem('recon.' + key)) ?? fallback; } catch { return fallback; }
}
export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [favorites, setFavorites] = useState(() => { const value = preference('favorites', []); return Array.isArray(value) ? value : []; });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);
  const busy = useRef(null);
  const toastTimer = useRef(null);
  const notify = useCallback(message => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(null), 4500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => { try { localStorage.setItem('recon.favorites', JSON.stringify(favorites)); } catch { /* Preferences are optional. */ } }, [favorites]);
  const refresh = useCallback(() => {
    if (busy.current) return busy.current;
    setRefreshing(true);
    busy.current = Promise.all([getMetrics(), fetchAll(getMatches), fetchAll(getExceptions), getDemoCases()])
      .then(([metrics, matches, exceptions, demoCases]) => { setData({ metrics, matches, exceptions, demoCases }); setError(null); setLastUpdated(new Date()); })
      .catch(e => { setError(e.message || 'Could not connect to the backend.'); })
      .finally(() => { busy.current = null; setRefreshing(false); });
    return busy.current;
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = event => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);
  useEffect(() => { if (!autoRefresh) return; const timer = setInterval(refresh, 30000); return () => clearInterval(timer); }, [autoRefresh, refresh]);
  useEffect(() => {
    const change = () => { setRoute(readRoute()); setSelected(null); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const shortcut = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]') && !commandOpen) return;
        e.preventDefault(); setCommandOpen(v => !v);
      }
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [commandOpen]);
  const navigate = (page, filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    const next = { page, ...filters };
    setRoute(next); setSelected(null); setMobileOpen(false);
    window.location.hash = page + (params ? '?' + params : '');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const toggleFavorite = id => setFavorites(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]);
  const pending = data?.exceptions.filter(e => e.status !== 'resolved').length || 0;
  const selectedRecord = selected && [...(data?.matches || []), ...(data?.exceptions || [])].find(r => recordId(r) === selected);
  const openRecord = record => { setCommandOpen(false); setSelected(recordId(record)); };
  const copyId = async () => { try { await navigator.clipboard.writeText(selected); notify('Record ID copied'); } catch { notify('Clipboard unavailable. Select the record ID to copy it.'); } };
  return <div className="app-layout workspace-app product-app">
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); document.getElementById('workspace-main')?.focus(); }}>Skip to content</a>
    <ProductNavigation active={route.page} onNavigate={navigate} pending={pending}
      onCommand={() => setCommandOpen(true)} connected={Boolean(data && !error)} connectionError={Boolean(error)} mobileOpen={mobileOpen} onMenu={() => setMobileOpen(v => !v)}/>
    <div className="workspace-main">
      <main id="workspace-main" className="workspace-content" tabIndex={-1}>
        <div className="workspace-toolbar"><span className="workspace-breadcrumb">WORKSPACE <span>/</span> {pageNames[route.page].toUpperCase()}</span>
          <div className="sync-controls"><button className={'live-toggle ' + (autoRefresh ? 'enabled' : '')} role="switch" aria-checked={autoRefresh} onClick={() => setAutoRefresh(v => !v)}><span className="toggle-track"><span/></span>Auto-refresh</button>
            <button className="icon-button" aria-label="Refresh all data" disabled={refreshing} onClick={refresh}><Icon name="refresh" className={refreshing ? 'is-spinning' : ''}/></button></div></div>
        {error && <div className="workspace-error" role="alert"><Icon name="alert"/><span>{data ? 'Showing the last loaded data. ' : ''}{error} Start both servers with npm run dev from the project root.</span><button className="btn btn-ghost btn-sm" onClick={refresh}>Retry</button></div>}
        {!data && !error && <div className="workspace-loading" role="status"><Icon name="layers" size={36}/><h2>Connecting the dots…</h2><p>Loading your ledger, settlements and bank records.</p><div className="loading-line"/></div>}
        {data && route.page === 'dashboard' && <Dashboard {...data} refreshKey={lastUpdated?.getTime() || 0} onNavigate={navigate} onOpen={openRecord} onExport={() => { exportRecords([...data.matches, ...data.exceptions], 'recon-workspace.csv'); notify('Workspace snapshot exported'); }}/>}
        {data && route.page === 'imports' && <DataIngestion onActivated={refresh} notify={notify}/>}
        {data && ['matches', 'exceptions'].includes(route.page) && <RecordWorkbench key={JSON.stringify(route)} kind={route.page} records={route.page === 'matches' ? data.matches : data.exceptions}
          initialFilters={route} favorites={favorites} onFavorite={toggleFavorite} onOpen={openRecord} onRefresh={refresh} notify={notify}/>}
        {route.page === 'auditlog' && <AuditLog refreshKey={lastUpdated?.getTime() || 0} onOpenEntity={id => {
          const record = [...(data?.matches || []), ...(data?.exceptions || [])].find(r => recordId(r) === id);
          if (record) openRecord(record); else notify('This record is no longer available in the loaded dataset.');
        }}/>}
        <footer className="workspace-footer"><span><Icon name="shield" size={13}/>AI proposes. Humans decide.</span><span>{lastUpdated ? 'Last synced ' + lastUpdated.toLocaleTimeString('en-IN') : 'Waiting for connection'} · Local workspace</span></footer>
      </main>
    </div>
    {commandOpen && <CommandMenu onClose={() => setCommandOpen(false)} onNavigate={navigate} onOpen={openRecord} matches={data?.matches || []} exceptions={data?.exceptions || []} onRefresh={refresh}/>}
    {selectedRecord && <Modal title={selectedRecord.exception_id ? 'Exception investigation' : 'Match investigation'} onClose={() => setSelected(null)} className="record-dialog"
      footer={<><span className="muted">No financial actions are taken when exploring a record.</span><button className="btn btn-ghost btn-sm" onClick={copyId}><Icon name="copy" size={14}/>Copy ID</button></>}>
      <div className="record-tools"><span className="font-mono">{recordId(selectedRecord)}</span><button className={'btn btn-ghost btn-sm ' + (favorites.includes(selected) ? 'is-starred' : '')} onClick={() => toggleFavorite(selected)} aria-pressed={favorites.includes(selected)}><Icon name="star" size={15}/>{favorites.includes(selected) ? 'Bookmarked' : 'Bookmark'}</button></div>
      {!isCandidateCase(selectedRecord) && <EvidenceFlow transactions={selectedRecord.transactions}/>}
      <div className="existing-detail">{selectedRecord.exception_id
        ? <ExceptionCard key={selected} exception={selectedRecord} onReviewed={async () => { setSelected(null); await refresh(); notify('Review submitted. Workspace refreshed.'); }}/>
        : <MatchCard match={selectedRecord}/>}</div>
    </Modal>}
    {toast && <div className="workspace-toast" role="status"><Icon name="check"/>{toast}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={14}/></button></div>}
  </div>;
}

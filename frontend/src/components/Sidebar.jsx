import Icon from './Icon';
const links = [['dashboard', 'Overview', 'grid'], ['exceptions', 'Review queue', 'alert'],
  ['matches', 'Reconciled matches', 'check'], ['auditlog', 'Audit trail', 'activity']];
export default function Sidebar({ active, onNav, pending = 0, collapsed, onCollapse, onCommand, connected, mobileOpen, onMobileClose }) {
  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onMobileClose}/>}
    <aside className={'workspace-sidebar' + (collapsed ? ' is-collapsed' : '') + (mobileOpen ? ' mobile-open' : '')}>
      <a className="workspace-brand" href="#dashboard" aria-label="ReconAgent overview" onClick={() => onNav('dashboard')}>
        <span className="brand-mark"><Icon name="layers" size={23}/></span><span className="sidebar-copy">recon<span className="brand-weight">agent</span><small>FINANCE OPERATIONS</small></span>
      </a>
      <div className="workspace-switch sidebar-copy"><span className="workspace-avatar">R</span><div>Buildathon workspace<small>Razorpay · Track 04</small></div><span className="demo-tag">DEMO</span></div>
      <button className="sidebar-search" onClick={onCommand} title="Search workspace (Ctrl+K)"><Icon name="search"/><span className="sidebar-copy">Quick search</span><kbd className="sidebar-copy">⌘ K</kbd></button>
      <span className="nav-caption sidebar-copy">WORKSPACE</span>
      <nav aria-label="Main navigation">{links.map(([id, label, icon]) => <button key={id} title={label}
        className={'workspace-nav ' + (active === id ? 'active' : '')} aria-current={active === id ? 'page' : undefined}
        onClick={() => { onNav(id); onMobileClose(); }}>
        <Icon name={icon}/><span className="sidebar-copy">{label}</span>{id === 'exceptions' && pending > 0 && <span className="nav-count sidebar-copy">{pending}</span>}
      </button>)}</nav>
      <div className="sidebar-note sidebar-copy"><Icon name="shield" size={20}/><strong>Confidence, with control.</strong><p>AI investigates. You make the final call.</p><span>Synthetic dataset</span></div>
      <div className="sidebar-bottom"><span className={'connection-light ' + (connected ? 'online' : '')}/><span className="sidebar-copy">{connected ? 'Backend connected' : 'Backend not connected'}</span>
        <button className="icon-button collapse-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}><Icon name="panel" size={16}/></button></div>
    </aside>
  </>;
}

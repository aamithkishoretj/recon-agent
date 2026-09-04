import Icon from './Icon';

const links = [['dashboard', 'Overview'], ['imports', 'New run'], ['matches', 'Reconciliation'], ['exceptions', 'Review queue'], ['auditlog', 'Audit trail']];

export default function ProductNavigation({ active, onNavigate, pending, onCommand, connected, connectionError, mobileOpen, onMenu }) {
  return <>
    <div className="product-announcement"><div><span>RAZORPAY BUILDATHON <b>/</b> TRACK 04</span><span>AI Finance Controller <i>·</i> Synthetic data workspace</span><span className="product-connection"><span className={'connection-light ' + (connected ? 'online' : '')}/>{connected ? 'Backend connected' : connectionError ? 'Backend unavailable' : 'Connecting to backend'}</span></div></div>
    <header className="product-header"><div className="product-header-inner">
      <a className="product-brand" href="#dashboard" onClick={event => { event.preventDefault(); onNavigate('dashboard'); }} aria-label="ReconAgent overview"><span className="product-brand-icon"><Icon name="layers" size={27}/></span>recon<span>agent</span><sup>↗</sup></a>
      <nav id="product-navigation" className={'product-links ' + (mobileOpen ? 'is-open' : '')} aria-label="Main navigation">{links.map(([page, label]) => <button key={page} onClick={() => onNavigate(page)} aria-current={active === page ? 'page' : undefined}>{label}{page === 'exceptions' && <span>{pending}</span>}</button>)}</nav>
      <div className="product-nav-actions"><button className="product-search" onClick={onCommand} aria-label="Open command menu"><Icon name="search" size={18}/><kbd>Ctrl K</kbd></button><span className="local-label"><Icon name="shield" size={15}/>Local demo</span><button className="icon-button product-menu" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-controls="product-navigation" aria-expanded={mobileOpen} onClick={onMenu}><Icon name={mobileOpen ? 'close' : 'menu'}/></button></div>
    </div></header>
  </>;
}

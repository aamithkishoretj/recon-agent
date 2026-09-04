import { useState } from 'react';
import Icon from './Icon';
import { explorerGroups, sourceSummary, money, recordRef, titleCase } from '../lib/workspace';
import './ReconciliationPreview.css';

const journeys = [
  { label: 'Matched payments', eyebrow: '01 / RECONCILE', headline: <>Follow the money.<br/><em>Find the match.</em></>, description: 'From your merchant ledger to the bank. Explore the records behind every matched payment.', action: 'Explore matches', page: 'matches', filters: {}, icon: 'check' },
  { label: 'Exceptions', eyebrow: '02 / INVESTIGATE', headline: <>See the mismatch.<br/><em>Know what’s next.</em></>, description: 'Missing credits, duplicate entries, or a number that doesn’t add up. Start with the evidence.', action: 'Open review queue', page: 'exceptions', filters: { status: 'active' }, icon: 'alert' },
  { label: 'AI hypotheses', eyebrow: '03 / REVIEW', headline: <>AI investigates.<br/><em>You make the call.</em></>, description: 'Explore recorded hypotheses alongside their source records. Every decision stays in your hands.', action: 'Review hypotheses', page: 'exceptions', filters: { status: 'in_review' }, icon: 'shield' },
];
const sources = [['ledger', 'Ledger', 'database'], ['settlement', 'Settlement', 'layers'], ['bank', 'Bank', 'check']];

export default function ReconciliationHero({ matches, exceptions, onNavigate, onOpen }) {
  const [journey, setJourney] = useState(0);
  const [source, setSource] = useState('ledger');
  const [sampleIndex, setSampleIndex] = useState(0);
  const current = journeys[journey];
  const groups = explorerGroups(matches, exceptions, journey);
  const safeIndex = groups.length ? sampleIndex % groups.length : 0;
  const record = groups[safeIndex];
  const { rows, amount } = sourceSummary(record?.transactions, source);
  const chooseJourney = index => { setJourney(index); setSource('ledger'); setSampleIndex(0); };

  return <section className="recon-hero" aria-label="Interactive reconciliation explorer">
    <div className="hero-layout">
      <div className="hero-copy" key={journey}>
        <div className="hero-eyebrow"><span/>{current.eyebrow}</div>
        <h1>{current.headline}</h1><p>{current.description}</p>
        <div className="hero-actions"><button className="btn btn-primary" onClick={() => onNavigate(current.page, current.filters)}>{current.action}<Icon name="arrow" size={18}/></button><button className="hero-secondary" disabled={!record} onClick={() => onOpen(record)}>Inspect this group<Icon name="arrow" size={16}/></button></div>
        <div className="hero-reassurance"><Icon name="shield" size={15}/>Read-only exploration. No money movement.</div>
      </div>
      <div className="reconciliation-preview">
        <div className="preview-batch">
          <span className="preview-batch-label"><span/>Synthetic batch</span>
          <div className="preview-batch-count"><strong>{groups.length.toLocaleString('en-IN')}</strong><span>{journey === 0 ? 'matched groups' : journey === 1 ? 'unresolved cases' : 'hypotheses to review'}</span></div>
        </div>
        <div className="preview-evidence">
          <div className="preview-heading"><span><Icon name={current.icon} size={17}/>{journey === 0 ? 'Matched group' : journey === 1 ? 'Exception group' : 'Human review required'}</span><span className={'preview-status ' + (journey ? 'needs-review' : '')}>{record ? titleCase(record.category || record.match_type) : 'No records'}</span></div>
          <div className="preview-reference"><span>Reference</span><strong>{record ? recordRef(record) : 'Nothing in this view'}</strong></div>
          <div className="preview-sources" aria-label="Explore group sources">{sources.map(([key, label, icon]) => <button key={key} aria-pressed={source === key} onClick={() => setSource(key)}><Icon name={icon} size={16}/><span>{label}</span></button>)}</div>
          <div className="preview-total" aria-live="polite"><div><span>{sources.find(([key]) => key === source)[1]} source total</span><strong>{amount}</strong></div><span className="preview-record-count">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span></div>
          <div className="preview-records">{rows.slice(0, 2).map(row => <div key={row.record_id}><span title={row.external_ref || row.record_id}>{row.external_ref || row.record_id.slice(0, 8)}</span><span>{money(row.amount_minor_units, row.currency)}</span></div>)}{!rows.length && <p>No {source} records are linked to this group.</p>}{rows.length > 2 && <p>+ {rows.length - 2} more in the full evidence view</p>}</div>
          <div className="preview-note"><span>Source totals ≠ proof of reconciliation</span><button onClick={() => onOpen(record)} disabled={!record} aria-label="Open full group evidence"><Icon name="arrow" size={18}/></button></div>
        </div>
        <div className="preview-pagination"><span>Group <strong>{groups.length ? safeIndex + 1 : 0}</strong> of {groups.length}</span><div><button disabled={groups.length < 2} aria-label="Previous sample group" onClick={() => setSampleIndex((safeIndex - 1 + groups.length) % groups.length)}><Icon name="arrow" className="rotate-180" size={18}/></button><button disabled={groups.length < 2} aria-label="Next sample group" onClick={() => setSampleIndex((safeIndex + 1) % groups.length)}><Icon name="arrow" size={18}/></button></div></div>
      </div>
    </div>
    <div className="hero-journeys"><span>WHAT’S ON YOUR DESK?</span><div>{journeys.map((item, index) => <button key={item.label} aria-pressed={journey === index} onClick={() => chooseJourney(index)}><Icon name={item.icon} size={16}/>{item.label}<Icon name="arrow" size={15}/></button>)}</div><span className="hero-step-count">0{journey + 1}<i>/ 03</i></span></div>
  </section>;
}

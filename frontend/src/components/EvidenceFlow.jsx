import { useState } from 'react';
import Icon from './Icon';
import { money } from '../lib/workspace';
const sources = [['ledger', 'Merchant ledger', 'database'], ['settlement', 'Settlement report', 'layers'], ['bank', 'Bank statement', 'check']];
export default function EvidenceFlow({ transactions = [] }) {
  const [selected, setSelected] = useState('ledger');
  const currencies = [...new Set(transactions.map(t => t.currency))];
  const sameCurrency = currencies.length <= 1;
  const currency = currencies[0] || 'INR';
  const rows = transactions.filter(t => t.source_type === selected);
  return <section className="evidence-flow">
    <div className="panel-heading"><div><span className="eyebrow">FOLLOW THE MONEY</span><h3>Source explorer</h3></div><span className="muted">Select a source</span></div>
    <div className="flow-nodes">{sources.map(([key, label, icon], index) => {
      const txns = transactions.filter(t => t.source_type === key);
      return <div className="flow-node-wrap" key={key}><button className={'flow-node ' + (selected === key ? 'selected' : '')}
        aria-pressed={selected === key} onClick={() => setSelected(key)}>
        <span><Icon name={icon}/>{label}</span><strong>{!txns.length ? 'Missing' : sameCurrency ? money(txns.reduce((n, t) => n + t.amount_minor_units, 0), currency) : 'Mixed currencies'}</strong>
        <small>{txns.length} source record{txns.length !== 1 ? 's' : ''}</small>
      </button>{index < 2 && <Icon name="arrow" size={16} className="flow-connector"/>}</div>;
    })}</div>
    <div className="flow-records">{rows.length ? rows.map(t => <div key={t.record_id}><span className="font-mono">{t.external_ref || t.record_id.slice(0, 8)}</span><span>{t.timestamp_utc.slice(0, 10)}</span><strong className={t.amount_minor_units < 0 ? 'negative' : ''}>{money(t.amount_minor_units, t.currency)}</strong></div>) : <p>No linked records from this source.</p>}</div>
    <p className="evidence-note">Source totals, not a proof of reconciliation. Fees, refunds and timing can make these amounts differ.</p>
  </section>;
}

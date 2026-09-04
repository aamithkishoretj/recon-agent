import Icon from './Icon';
import { recordId } from '../lib/workspace';

export default function DemoCases({ showcase, records, onOpen }) {
  if (!showcase?.available || !showcase.cases?.length) return null;
  const indexed = new Map(records.map(record => [recordId(record), record]));
  return <section className="showcase-section" aria-labelledby="showcase-title">
    <div className="showcase-heading">
      <div><span className="overline">PRESENTATION MODE</span><h2 id="showcase-title">{showcase.title}</h2><p>{showcase.summary}</p></div>
      <span className="showcase-proof"><Icon name="shield" size={15}/>5 reconciled cases</span>
    </div>
    <div className="showcase-grid">{showcase.cases.map(item => {
      const record = indexed.get(item.entity_id);
      return <button className={'showcase-card tone-' + item.tone} key={item.number} onClick={() => record && onOpen(record)} disabled={!record}>
        <span className="showcase-card-top"><span className="showcase-number">CASE {item.number}</span><span className="showcase-outcome">{item.outcome}<Icon name={item.entity_type === 'match' ? 'check' : 'alert'} size={13}/></span></span>
        <strong>{item.title}</strong><p>{item.summary}</p>
        <span className="showcase-facts">{item.facts.map(fact => <span key={fact.label}><small>{fact.label}</small><b>{fact.value}</b></span>)}</span>
        <span className="showcase-talking-point">{item.talking_point}</span>
        <span className="showcase-open">Open evidence <Icon name="arrow" size={14}/></span>
      </button>;
    })}</div>
  </section>;
}

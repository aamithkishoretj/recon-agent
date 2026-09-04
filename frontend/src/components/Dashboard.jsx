import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import EvalScores from './EvalScores';
import ReconciliationHero from './ReconciliationHero';
import DemoCases from './DemoCases';
import { bankActivity, recordRef, titleCase } from '../lib/workspace';

const colors = { deterministic: '#6d9dff', fuzzy: '#46cfb1', human: '#b9a0ff', ai: '#f2bc64' };
const compact = n => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const shortDate = day => new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Dashboard({ metrics, matches, exceptions, demoCases, onNavigate, onOpen, onExport, refreshKey }) {
  const [chartMode, setChartMode] = useState('value');
  const [windowSize, setWindowSize] = useState('all');
  const activity = useMemo(() => bankActivity([...matches, ...exceptions]), [matches, exceptions]);
  const chartData = windowSize === 'all' ? activity : activity.slice(-14);
  const pending = exceptions.filter(e => e.status !== 'resolved');
  const attention = [...pending].sort((a, b) => b.priority_score - a.priority_score).slice(0, 4);
  const mix = Object.entries(metrics.matches_by_type).map(([name, value]) => ({ name, value }));
  const categories = Object.entries(metrics.exceptions_by_category).sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(1, ...categories.map(([, count]) => count));
  const sourceCounts = useMemo(() => {
    const unique = new Map();
    [...matches, ...exceptions].forEach(r => r.transactions.forEach(t => unique.set(t.record_id, t)));
    const counts = { ledger: 0, settlement: 0, bank: 0 };
    unique.forEach(t => { counts[t.source_type] = (counts[t.source_type] || 0) + 1; });
    return counts;
  }, [matches, exceptions]);
  const autoMatches = matches.filter(m => ['deterministic', 'fuzzy'].includes(m.match_type)).length;
  const tiles = [
    { label: 'Source records', value: metrics.total_transactions.toLocaleString('en-IN'), icon: 'database', hint: 'Across three source files', tone: 'blue' },
    { label: 'Auto-matched groups', value: autoMatches, icon: 'check', hint: 'Explore matching evidence', tone: 'green', action: () => onNavigate('matches') },
    { label: 'Needs attention', value: pending.length, icon: 'alert', hint: 'Open, in-review and reopened cases', tone: 'amber', action: () => onNavigate('exceptions', { status: 'active' }) },
    { label: 'Straight-through rate', value: ((metrics.straight_through_rate || 0) * 100).toFixed(1) + '%', icon: 'zap', hint: 'Unique groups; reviews counted once', tone: 'violet' },
  ];
  return <div className="overview page-enter">
    {metrics.legacy_auto_matches > 0 && <p className="callout" role="alert">{metrics.legacy_auto_matches} stored automatic matches predate the new verification rules. The displayed match totals are historical; check record-level accuracy below or start a fresh demo.</p>}
    <ReconciliationHero matches={matches} exceptions={exceptions} onNavigate={onNavigate} onOpen={onOpen}/>
    <DemoCases showcase={demoCases} records={[...matches, ...exceptions]} onOpen={onOpen}/>
    <div className="batch-section-heading"><div><span className="overline">THE BIG PICTURE</span><h2>Your books, <em>at a glance.</em></h2></div><button className="btn btn-ghost" onClick={onExport}><Icon name="download" size={16}/>Export snapshot</button></div>
    <div className="source-strip"><span className="source-caption">SOURCE FILES</span>{[['ledger', 'Merchant ledger', 'database'], ['settlement', 'Settlement report', 'layers'], ['bank', 'Bank statement', 'check']].map(([key, label, icon], index) => <div className="source-item" key={key}>{index > 0 && <span className="source-connector">/</span>}<Icon name={icon} size={15}/><span>{label}</span><strong>{sourceCounts[key]}</strong><span className="source-dot"/></div>)}<span className="source-batch">Synthetic batch</span></div>
    <div className="metric-grid">{tiles.map((tile, index) => {
      const body = <><div className="metric-top"><span>{tile.label}</span><span className={'metric-icon ' + tile.tone}><Icon name={tile.icon} size={17}/></span></div><div className="metric-value">{tile.value}</div><div className="metric-bottom"><span>{tile.hint}</span>{tile.action && <Icon name="arrow" size={14}/>}</div><div className={'metric-accent ' + tile.tone}/></>;
      return tile.action ? <button key={tile.label} className="metric-tile interactive" onClick={tile.action} style={{ animationDelay: index * 45 + 'ms' }}>{body}</button>
        : <div key={tile.label} className="metric-tile" style={{ animationDelay: index * 45 + 'ms' }}>{body}</div>;
    })}</div>
    {Object.entries(metrics.currency_values || {}).map(([currency, values]) => <section className="workspace-panel monetary-panel" key={currency} aria-label={currency + ' merchant value coverage'}><div className="panel-heading"><div><h2>Merchant value coverage · {currency}</h2><p>Positive ledger gross, counted once per source record — not net bank exposure.</p></div></div><div className="evaluation-grid">{[
      ['Ledger gross', values.ledger_gross_paise], ['Auto-reconciled gross', values.auto_reconciled_paise], ['Unresolved gross', values.requiring_review_paise],
    ].map(([label, amount]) => <div className="evaluation-stat" key={label}><span>{label}</span><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount / 100)}</strong></div>)}<div className="evaluation-stat"><span>Automatic value coverage</span><strong>{values.monetary_coverage == null ? 'N/A' : (values.monetary_coverage * 100).toFixed(2) + '%'}</strong></div></div></section>)}
    <div className="overview-primary-grid">
      <section className="workspace-panel activity-panel"><div className="panel-heading"><div><h2>Bank activity</h2><p>Actual source records, grouped by transaction date</p></div><select aria-label="Chart date range" className="small-select" value={windowSize} onChange={e => setWindowSize(e.target.value)}><option value="all">All recorded days</option><option value="14">Last 14 recorded days</option></select></div>
        <div className="chart-summary"><div><span className="chart-total">{chartMode === 'value' ? '₹' + compact(chartData.reduce((n, d) => n + d.value, 0)) : chartData.reduce((n, d) => n + d.records, 0)}<small>{chartMode === 'value' ? 'net bank credits' : 'bank records'}</small></span><span className="chart-period">{chartData.length ? shortDate(chartData[0].day) + ' — ' + shortDate(chartData.at(-1).day) : 'No bank activity'}</span></div><div className="segmented-control">{['value', 'records'].map(mode => <button key={mode} className={chartMode === mode ? 'active' : ''} aria-pressed={chartMode === mode} onClick={() => setChartMode(mode)}>{titleCase(mode)}</button>)}</div></div>
        <div className="activity-chart" role="img" aria-label={'Bank activity chart displaying ' + chartMode + ' for ' + chartData.length + ' recorded days'}>
          {chartData.length ? <ResponsiveContainer width="100%" height={222}><AreaChart data={chartData} margin={{ top: 12, left: 0, right: 12, bottom: 0 }}>
            <defs><linearGradient id="bank-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6495fa" stopOpacity={0.27}/><stop offset="100%" stopColor="#6495fa" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#ffffff09" strokeDasharray="3 5"/><XAxis dataKey="day" tickFormatter={shortDate} minTickGap={40} tick={{ fill: '#7e8da6', fontSize: 10 }} axisLine={false} tickLine={false} dy={8}/>
            <YAxis width={48} tickFormatter={compact} tick={{ fill: '#7e8da6', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <Tooltip labelFormatter={shortDate} formatter={value => [chartMode === 'value' ? '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value, chartMode === 'value' ? 'Net bank credits' : 'Records']} contentStyle={{ background: '#192335', border: '1px solid #34415b', borderRadius: 10, color: '#f4f7ff', fontSize: 12 }} labelStyle={{ color: '#9facbf', marginBottom: 5 }}/>
            <Area type="monotone" dataKey={chartMode} stroke="#7ba6ff" strokeWidth={2.3} fill="url(#bank-fill)" activeDot={{ r: 5, stroke: '#101724', strokeWidth: 3 }} animationDuration={500}/>
          </AreaChart></ResponsiveContainer> : <div className="workspace-empty">No bank records in this dataset.</div>}
        </div><div className="chart-caption"><span className="chart-legend"><i/>Bank statement</span><span>Includes signed refunds · Hover to inspect</span></div>
      </section>
      <section className="workspace-panel attention-panel"><div className="panel-heading"><div><div className="attention-eyebrow"><span/>ACTION REQUIRED</div><h2>Your next best actions</h2></div><span className="count-bubble">{pending.length}</span></div>
        <p className="attention-description">Start with the highest-priority cases in your queue.</p>
        <div className="attention-list">{attention.map(record => <button className="attention-item" key={record.exception_id} onClick={() => onOpen(record)}><span className="attention-item-icon"><Icon name={record.category === 'duplicate' ? 'copy' : 'alert'} size={16}/></span><span><strong>{recordRef(record)}</strong><small>{titleCase(record.category)}</small></span><Icon name="chevron" size={15}/></button>)}
          {!attention.length && <div className="workspace-empty"><Icon name="check" size={28}/><h3>Queue clear</h3><p>There are no unresolved cases.</p></div>}</div>
        <button className="attention-footer" onClick={() => onNavigate('exceptions', { status: 'active' })}>Open review workspace<Icon name="arrow" size={15}/></button>
      </section>
    </div>
    <div className="overview-secondary-grid">
      <section className="workspace-panel"><div className="panel-heading"><div><h2>Exception breakdown</h2><p>Click a category to investigate its records</p></div><Icon name="filter" size={18}/></div>
        <div className="category-bars">{categories.map(([name, count], index) => <button key={name} onClick={() => onNavigate('exceptions', { category: name })}><span className="category-label">{titleCase(name)}</span><span className="category-track"><span style={{ width: count / maxCategory * 100 + '%', background: ['#7b9bff', '#a695e8', '#54baa9', '#d2ac70', '#7e9cb0'][index % 5] }}/></span><strong>{count}</strong><Icon name="arrow" size={13}/></button>)}</div>
        <div className="panel-footnote">Includes open, in-review and resolved exceptions.</div>
      </section>
      <section className="workspace-panel"><div className="panel-heading"><div><h2>How matches happened</h2><p>Explore the evidence behind each method</p></div><Icon name="layers" size={18}/></div>
        <div className="match-mix"><div className="mix-chart"><ResponsiveContainer width="100%" height={170}><PieChart><Pie data={mix} dataKey="value" nameKey="name" innerRadius={57} outerRadius={72} paddingAngle={4} stroke="none" onClick={entry => onNavigate('matches', { type: entry.name })} style={{ cursor: 'pointer' }} animationDuration={500}>{mix.map(item => <Cell key={item.name} fill={colors[item.name] || '#8ca2bc'}/>)}</Pie><Tooltip contentStyle={{ background: '#192335', border: '1px solid #34415b', borderRadius: 10, color: '#fff' }}/></PieChart></ResponsiveContainer><div className="mix-center"><strong>{matches.length}</strong><small>MATCHED GROUPS</small></div></div>
          <div className="mix-legend">{mix.map(item => <button key={item.name} onClick={() => onNavigate('matches', { type: item.name })}><span style={{ background: colors[item.name] || '#8ca2bc' }}/><span>{titleCase(item.name)}</span><strong>{item.value}</strong><Icon name="chevron" size={12}/></button>)}</div></div>
        <div className="panel-footnote"><Icon name="shield" size={13}/>AI hypotheses only become matches after human approval.</div>
      </section>
    </div>
    <details className="dataset-checks" open><summary><span><Icon name="shield" size={17}/><strong>Record-level accuracy</strong><span>Exact source sets + financial arithmetic</span></span><Icon name="down" size={16}/></summary><div className="dataset-checks-body"><EvalScores refreshKey={refreshKey}/></div></details>
    <div className="overview-bottom-note"><StatusBadge value="in_review"/><span>{metrics.exceptions_in_review} cases have AI hypotheses ready for a human decision.</span><button className="text-button" onClick={() => onNavigate('exceptions', { status: 'in_review' })}>Review hypotheses<Icon name="arrow" size={14}/></button></div>
  </div>;
}

export const recordId = r => r.exception_id || r.match_id;
export const titleCase = (v = '') => v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const money = (paise = 0, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
export const recordAmount = r => Math.max(0, ...(r.transactions || []).map(t => Math.abs(t.amount_minor_units)));
export const recordRef = r => r.transactions?.find(t => t.source_type === 'ledger')?.external_ref || r.transactions?.[0]?.external_ref || recordId(r).slice(0, 8);

// Explorer views only select existing records; they never run reconciliation.
export function explorerGroups(matches, exceptions, journey) {
  if (journey === 0) return matches;
  if (journey === 2) return exceptions.filter(r => r.status === 'in_review' && r.ai_hypothesis);
  return exceptions.filter(r => r.status !== 'resolved').sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
}
export function sourceSummary(transactions = [], source) {
  const rows = transactions.filter(t => t.source_type === source);
  const currencies = [...new Set(rows.map(row => row.currency))];
  return {
    rows,
    amount: !rows.length ? 'No linked record' : currencies.length > 1 ? 'Mixed currencies'
      : money(rows.reduce((sum, row) => sum + row.amount_minor_units, 0), currencies[0]),
  };
}

export function searchRecord(r, query) {
  const haystack = [recordId(r), r.category, r.match_type, r.status, ...(r.transactions || []).map(t => t.external_ref)].join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(term => haystack.includes(term));
}
export function filterRecords(records, { search = '', status = '', category = '', type = '', starred = false } = {}, favorites = []) {
  return records.filter(r => (!search || searchRecord(r, search))
    && (!status || (status === 'active' ? r.status !== 'resolved' : r.status === status))
    && (!category || r.category === category) && (!type || r.match_type === type)
    && (!starred || favorites.includes(recordId(r))));
}
export function sortRecords(records, sort = 'amount', direction = 'desc') {
  return [...records].sort((a, b) => {
    const value = r => sort === 'amount' ? recordAmount(r) : sort === 'priority' ? r.priority_score || 0
      : sort === 'confidence' ? r.confidence ?? r.ai_hypothesis?.confidence ?? -1
      : sort === 'reference' ? recordRef(r) : new Date(r.created_at).getTime();
    const left = value(a), right = value(b);
    const diff = typeof left === 'string' ? left.localeCompare(right) : left - right;
    return (diff || recordId(a).localeCompare(recordId(b))) * (direction === 'asc' ? 1 : -1);
  });
}
export function csvText(records) {
  const cell = value => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = records.map(r => [recordId(r), recordRef(r), r.category || r.match_type, r.status,
    recordAmount(r), r.confidence ?? r.ai_hypothesis?.confidence ?? '', r.created_at]);
  return [['id', 'reference', 'category_or_type', 'status', 'largest_transaction_paise', 'confidence', 'created_at'], ...rows]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
export function exportRecords(records, filename) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(records)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function bankActivity(records) {
  const unique = new Map();
  records.forEach(r => (r.transactions || []).forEach(t => { if (t.source_type === 'bank') unique.set(t.record_id, t); }));
  const days = new Map();
  unique.forEach(t => {
    const day = t.timestamp_utc.slice(0, 10);
    const point = days.get(day) || { day, records: 0, value: 0 };
    point.records += 1; point.value += t.amount_minor_units / 100; days.set(day, point);
  });
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export async function fetchAll(fetchPage) {
  const records = [];
  for (let offset = 0; offset < 50000; offset += 500) {
    const page = await fetchPage({ limit: 500, offset });
    if (!Array.isArray(page)) throw new Error('Unexpected records response from backend.');
    records.push(...page);
    if (page.length < 500) return records;
  }
  throw new Error('This workspace supports fewer than 50,000 loaded groups. Narrow the backend dataset before loading.');
}

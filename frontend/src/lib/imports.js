export const IMPORT_SOURCES = [
  { key: 'ledger', label: 'Merchant ledger', hint: 'Orders, amount, date and status' },
  { key: 'settlement', label: 'Razorpay settlement', hint: 'Gross, fee, GST and reported net' },
  { key: 'bank', label: 'Bank statement', hint: 'Credits, value dates and descriptions' },
];
export const MAX_IMPORT_BYTES = 2_000_000;

export function validateImportFile(file) {
  if (!file) return 'Choose a CSV file.';
  if (!file.name?.toLowerCase().endsWith('.csv')) return 'Only .csv files are accepted.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The CSV file is empty.';
  if (file.size > MAX_IMPORT_BYTES) return 'The CSV exceeds the 2 MB local-demo limit.';
  return null;
}

export function filesReady(files) {
  return IMPORT_SOURCES.every(({ key }) => files[key] && !validateImportFile(files[key]));
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export function pipelineStages(status) {
  const uploaded = ['uploaded', 'running', 'completed'].includes(status);
  const running = status === 'running', completed = status === 'completed';
  return [
    { label: 'Uploaded', state: uploaded ? 'done' : 'waiting' },
    { label: 'Normalized', state: uploaded ? 'done' : 'waiting' },
    { label: 'Candidate matching', state: completed ? 'done' : running ? 'active' : 'waiting' },
    { label: 'Deterministic reconciliation', state: completed ? 'done' : running ? 'active' : 'waiting' },
    { label: 'Exception classification', state: completed ? 'done' : running ? 'active' : 'waiting' },
    { label: 'Completed', state: completed ? 'done' : 'waiting' },
  ];
}

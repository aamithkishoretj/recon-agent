import { useState } from 'react';
import Icon from './Icon';
import { previewImport, reconcileImport } from '../api';
import { filesReady, formatFileSize, IMPORT_SOURCES, pipelineStages, validateImportFile } from '../lib/imports';
import './DataIngestion.css';

function SourceUpload({ source, file, summary, disabled, onFile }) {
  const [dragging, setDragging] = useState(false);
  const set = next => { const error = validateImportFile(next); onFile(error ? null : next, error); };
  return <section className={'source-upload ' + (file ? 'has-file ' : '') + (dragging ? 'is-dragging' : '')}>
    <div className="source-upload-top"><span className="source-upload-icon"><Icon name={source.key === 'bank' ? 'database' : 'download'}/></span>
      <div><h2>{source.label}</h2><p>{source.hint}</p></div><span className="source-number">0{IMPORT_SOURCES.findIndex(item => item.key === source.key) + 1}</span></div>
    <label className={'file-drop ' + (disabled ? 'is-disabled' : '')}
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) set(event.dataTransfer.files?.[0]); }}>
      <input type="file" accept=".csv,text/csv" disabled={disabled} aria-label={`Choose ${source.label} CSV`}
        onChange={event => { const chosen = event.target.files?.[0]; set(chosen); if (validateImportFile(chosen)) event.target.value = ''; }}/>
      {file ? <><Icon name="check"/><strong>{file.name}</strong><span>{formatFileSize(file.size)}{summary ? ` · ${summary.rows.toLocaleString()} rows` : ''}</span></>
        : <><Icon name="download"/><strong>Drop CSV here</strong><span>or choose a file · 2 MB maximum</span></>}
    </label>
  </section>;
}

function Pipeline({ status }) {
  return <ol className="run-pipeline" aria-label="Reconciliation progress">{pipelineStages(status).map((stage, index) => <li key={stage.label} className={stage.state}>
    <span className="pipeline-marker">{stage.state === 'done' ? <Icon name="check" size={14}/> : String(index + 1).padStart(2, '0')}</span>
    <span>{stage.label}</span>{index < 5 && <i/>}
  </li>)}</ol>;
}

export default function DataIngestion({ onActivated, notify }) {
  const [files, setFiles] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('waiting');
  const [error, setError] = useState(null);
  const busy = status === 'uploading' || status === 'running';
  const updateFile = (key, file, validationError) => {
    setFiles(current => ({ ...current, [key]: file })); setPreview(null); setResult(null); setStatus('waiting');
    setError(validationError ? `${IMPORT_SOURCES.find(item => item.key === key).label}: ${validationError}` : null);
  };
  const validate = async () => {
    if (!filesReady(files)) { setError('Choose one valid CSV for every source.'); return; }
    setStatus('uploading'); setError(null);
    try {
      const payload = Object.fromEntries(await Promise.all(IMPORT_SOURCES.map(async ({ key }) => [key, { filename: files[key].name, content: await files[key].text() }])));
      const next = await previewImport(payload); setPreview(next); setStatus('uploaded'); notify('Three source files validated');
    } catch (cause) { setStatus('waiting'); setError(cause.message); }
  };
  const run = async () => {
    setStatus('running'); setError(null);
    try {
      const completed = await reconcileImport(preview.run_id); setResult(completed); setStatus('completed');
      await onActivated(); notify('New reconciliation run is active');
    } catch (cause) { setStatus('uploaded'); setError(cause.message); }
  };
  const report = result?.report, metrics = report?.metrics;
  return <div className="ingestion-workspace">
    <div className="workspace-page-heading"><div><span className="eyebrow">ISOLATED DATASET</span><h1>Start a reconciliation run<span className="title-dot">.</span></h1>
      <p>Validate three source exports, then reconcile them into a new local workspace. Existing runs are never overwritten.</p></div>
      <div className="run-safety"><Icon name="shield"/><span><strong>Local processing</strong>No AI call during reconciliation</span></div></div>

    <div className="source-upload-grid">{IMPORT_SOURCES.map(source => <SourceUpload key={source.key} source={source} file={files[source.key]}
      summary={preview?.sources?.[source.key]} disabled={busy || Boolean(result)} onFile={(file, issue) => updateFile(source.key, file, issue)}/>)}</div>

    {error && <div className="import-error" role="alert"><Icon name="alert"/><span><strong>Could not continue</strong>{error}</span></div>}

    <section className="run-console">
      <div className="run-console-copy"><span className="eyebrow">PIPELINE</span><h2>{status === 'completed' ? 'Run completed' : preview ? 'Files are normalized' : 'Ready when all three files are selected'}</h2>
        <p>{status === 'completed' ? 'This isolated run is now powering the overview, matches and review queue.' : preview ? 'Review the row counts, then run deterministic matching and exception classification.' : 'Validation checks required columns, monetary values, dates, statuses and currencies before any database is created.'}</p></div>
      <Pipeline status={status}/>
      <div className="run-actions">
        <button className="btn btn-ghost" disabled={busy || Boolean(result) || !filesReady(files)} onClick={validate}><Icon name="download"/>{status === 'uploading' ? 'Validating…' : preview ? 'Validate again' : 'Upload & validate'}</button>
        <button className="btn btn-primary" disabled={busy || !preview || Boolean(result)} onClick={run}><Icon name="zap"/>{status === 'running' ? 'Reconciling…' : 'Run reconciliation'}</button>
      </div>
    </section>

    {report && <section className="run-results" aria-live="polite"><div className="run-result-heading"><div><span className="eyebrow">ACTIVE WORKSPACE</span><h2>Batch result</h2></div><span className="badge badge-success"><Icon name="check" size={13}/> Completed</span></div>
      <div className="run-result-grid">
        <div><span>Records processed</span><strong>{Object.values(report.ingested).reduce((sum, value) => sum + value, 0).toLocaleString()}</strong></div>
        <div><span>Reconciliation groups</span><strong>{report.groups.toLocaleString()}</strong></div>
        <div><span>Auto-reconciled</span><strong>{report.results.match.toLocaleString()}</strong></div>
        <div><span>Exceptions</span><strong>{report.results.exception.toLocaleString()}</strong></div>
        <div><span>Group coverage</span><strong>{(metrics.match_rate * 100).toFixed(1)}%</strong></div>
        <div><span>Runtime</span><strong>{report.elapsed_seconds.toFixed(3)}s</strong></div>
      </div>
      <div className="run-result-actions"><button className="btn btn-primary" onClick={() => location.hash = 'dashboard'}>Open overview <Icon name="arrow"/></button>
        <button className="btn btn-ghost" onClick={() => location.hash = 'exceptions'}>Review {report.results.exception} exceptions</button></div>
      {!report.evaluation && <p className="run-ground-truth-note"><Icon name="shield"/>Accuracy scores are not shown for uploaded files because no evaluator-only ground truth was supplied. Match and exception counts are operational results, not proof of accuracy.</p>}
    </section>}
  </div>;
}

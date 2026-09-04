/**
 * API client — single source of truth for all backend calls.
 * Backend runs at http://localhost:8000 (proxied via /api in Vite dev).
 */

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map(item => item.msg).join('; ') : body.detail;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// Health
export const getHealth = () => request('/health');
export const getDemoCases = () => request('/demo-cases');

export const previewImport = files => request('/import-runs/preview', { method: 'POST', body: JSON.stringify(files) });
export const reconcileImport = runId => request(`/import-runs/${encodeURIComponent(runId)}/reconcile`, { method: 'POST' });

// Metrics
export const getMetrics = () => request('/metrics');

// Matches
export const getMatches = ({ match_type, limit = 50, offset = 0 } = {}) => {
  const params = new URLSearchParams({ limit, offset });
  if (match_type) params.set('match_type', match_type);
  return request(`/matches?${params}`);
};

export const getMatch = (id) => request(`/matches/${id}`);

// Exceptions
export const getExceptions = ({ status, category, limit = 50, offset = 0 } = {}) => {
  const params = new URLSearchParams({ limit, offset });
  if (status)   params.set('status', status);
  if (category) params.set('category', category);
  return request(`/exceptions?${params}`);
};

export const getException = (id) => request(`/exceptions/${id}`);

export const reviewException = (id, { action, reviewer_name, notes, expected_status }) =>
  request(`/exceptions/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, reviewer_name, notes, expected_status }),
  });

// ---------- Phase 6 ----------

export const runAIReasoning = () =>
  request('/run-ai-reasoning', { method: 'POST' });

export const getAuditLog = ({ entity_id, entity_type, actor, limit = 50, offset = 0 } = {}) => {
  const params = new URLSearchParams({ limit, offset });
  if (entity_id)   params.set('entity_id', entity_id);
  if (entity_type) params.set('entity_type', entity_type);
  if (actor)       params.set('actor', actor);
  return request(`/audit-log?${params}`);
};

export const getEvalScores = () => request('/eval-scores');

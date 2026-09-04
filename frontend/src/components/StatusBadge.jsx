import React from 'react';

/**
 * Reusable status/category badge pill.
 * Automatically picks the right color class based on the value.
 */

const STATUS_MAP = {
  // Exception statuses
  open:        { cls: 'badge-danger',   dot: '#ef4444', label: 'Open' },
  in_review:   { cls: 'badge-warning',  dot: '#f59e0b', label: 'In Review' },
  resolved:    { cls: 'badge-success',  dot: '#10b981', label: 'Resolved' },
  reopened:    { cls: 'badge-purple',   dot: '#8b5cf6', label: 'Reopened' },

  // Match statuses
  auto_matched:    { cls: 'badge-success', dot: '#10b981', label: 'Auto Matched' },
  pending_review:  { cls: 'badge-warning', dot: '#f59e0b', label: 'Pending Review' },
  approved:        { cls: 'badge-success', dot: '#10b981', label: 'Approved' },
  rejected:        { cls: 'badge-danger',  dot: '#ef4444', label: 'Rejected' },

  // Match types
  deterministic: { cls: 'badge-success', dot: '#10b981', label: 'Deterministic' },
  fuzzy:         { cls: 'badge-info',    dot: '#06b6d4', label: 'Fuzzy' },
  ai:            { cls: 'badge-purple',  dot: '#8b5cf6', label: 'AI' },
  human:         { cls: 'badge-primary', dot: '#3b7ef8', label: 'Human' },

  // Exception categories
  missing_ledger:      { cls: 'badge-danger',  dot: '#ef4444', label: 'Missing Ledger' },
  missing_settlement:  { cls: 'badge-warning', dot: '#f59e0b', label: 'Missing Settlement' },
  missing_bank_credit: { cls: 'badge-warning', dot: '#f59e0b', label: 'Missing Bank Credit' },
  duplicate:           { cls: 'badge-danger',  dot: '#ef4444', label: 'Duplicate' },
  amount_discrepancy:  { cls: 'badge-purple',  dot: '#8b5cf6', label: 'Amount Discrepancy' },
  timing_discrepancy:  { cls: 'badge-info',    dot: '#06b6d4', label: 'Timing Discrepancy' },
  unknown_adjustment:  { cls: 'badge-neutral', dot: '#6b7280', label: 'Unknown Adjustment' },
  ambiguous_candidate: { cls: 'badge-warning', dot: '#f59e0b', label: 'Ambiguous Candidate' },
  refund_mismatch:     { cls: 'badge-danger',  dot: '#ef4444', label: 'Refund Mismatch' },
  currency_mismatch:   { cls: 'badge-danger',  dot: '#ef4444', label: 'Currency Mismatch' },
};

export default function StatusBadge({ value, showDot = true }) {
  const key = (value || '').toLowerCase();
  const cfg = STATUS_MAP[key] || { cls: 'badge-neutral', dot: '#6b7280', label: value };

  return (
    <span className={`badge ${cfg.cls}`}>
      {showDot && <span className="badge-dot" style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
}

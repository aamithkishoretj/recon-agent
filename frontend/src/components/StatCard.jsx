import React, { useState, useEffect, useRef } from 'react';

/**
 * Animated metric card that counts up to the final value on mount.
 */
export default function StatCard({ label, value, prefix = '', suffix = '', color = 'var(--primary)', icon, trend, delay = 0 }) {
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof value !== 'number') return;
    const duration = 900;
    const start = performance.now();
    const from = 0;
    const to = value;

    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };

    const timer = setTimeout(() => {
      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, delay]);

  const displayValue = typeof value === 'number'
    ? displayed
    : value;

  const formatValue = (v) => {
    if (typeof v === 'number' && v >= 1000) {
      return v.toLocaleString();
    }
    return v;
  };

  return (
    <div className="stat-card fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="stat-card-header">
        {icon && (
          <div className="stat-card-icon" style={{ background: `${color}20`, color }}>
            {icon}
          </div>
        )}
        <span className="stat-card-label">{label}</span>
      </div>
      <div className="stat-card-value stat-animate">
        {prefix}
        <span>{formatValue(displayValue)}</span>
        {suffix}
      </div>
      {trend && (
        <div className="stat-card-trend">
          <span className={`trend-badge ${trend.up ? 'trend-up' : 'trend-down'}`}>
            {trend.up ? '↑' : '↓'} {trend.label}
          </span>
        </div>
      )}
      <div className="stat-card-bar" style={{ background: `${color}15` }}>
        <div className="stat-card-bar-fill" style={{ width: '100%', background: color }} />
      </div>

      <style>{`
        .stat-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 22px 24px;
          position: relative;
          overflow: hidden;
          transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
          cursor: default;
        }
        .stat-card:hover {
          border-color: ${color}40;
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .stat-card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .stat-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          flex-shrink: 0;
        }
        .stat-card-label {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-secondary);
          letter-spacing: 0.02em;
        }
        .stat-card-value {
          font-size: 2rem;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.03em;
          line-height: 1;
          margin-bottom: 12px;
        }
        .stat-card-trend { margin-bottom: 14px; }
        .trend-badge {
          font-size: 0.72rem;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 100px;
        }
        .trend-up   { color: var(--success); background: var(--success-bg); }
        .trend-down { color: var(--danger);  background: var(--danger-bg); }
        .stat-card-bar {
          height: 3px;
          border-radius: 100px;
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
        }
        .stat-card-bar-fill {
          height: 100%;
          border-radius: 100px;
          transition: width 1s ease-out;
        }
      `}</style>
    </div>
  );
}

/**
 * Vinpro HRMS — AI Compliance Agent Dashboard
 * Drop into your existing React app at: src/components/ComplianceDashboard.jsx
 * Route: /admin/compliance (super admin only)
 * 
 * Requires: your existing apiJson helper from src/api/liveClient.js
 */

import React, { useState, useEffect, useCallback } from 'react';

const SEVERITY_CONFIG = {
  critical: { color: '#dc2626', bg: '#fef2f2', label: 'Critical', icon: '🚨' },
  high:     { color: '#d97706', bg: '#fffbeb', label: 'High',     icon: '⚠️' },
  medium:   { color: '#2563eb', bg: '#eff6ff', label: 'Medium',   icon: 'ℹ️' },
  low:      { color: '#16a34a', bg: '#f0fdf4', label: 'Low',      icon: '✅' },
};

const MODULE_LABELS = {
  pf: 'Provident Fund (PF)',
  esi: 'ESI',
  tds: 'TDS / Income Tax',
  professional_tax: 'Professional Tax',
  minimum_wage: 'Minimum Wages',
  gratuity: 'Gratuity',
  bonus: 'Bonus Act',
  maternity: 'Maternity Benefit',
  labour_welfare_fund: 'Labour Welfare Fund',
  payroll_settings: 'Payroll Settings',
};

const PROVIDERS = {
  groq: { label: 'Groq Llama 3.3 (Free)', badge: '🟢 Free' },
  openai: { label: 'OpenAI GPT-4o', badge: '💰 Paid' },
  anthropic: { label: 'Claude 3.5 Sonnet', badge: '💰 Paid' },
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ComplianceDashboard({ apiJson, authToken }) {
  const [changes, setChanges] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState('groq');
  const [filter, setFilter] = useState({ status: 'pending_review', module: '', severity: '' });
  const [selected, setSelected] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [notification, setNotification] = useState(null);

  const notify = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(filter).filter(([, v]) => v))
      );
      const data = await apiJson(`/compliance/changes?${params}`, { token: authToken });
      setChanges(data.changes || []);
      setSummary({ total: data.total, pending: data.pending });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, authToken]);

  const fetchProvider = useCallback(async () => {
    try {
      const data = await apiJson('/compliance/provider', { token: authToken });
      setProvider(data.current);
    } catch {}
  }, [authToken]);

  useEffect(() => {
    fetchChanges();
    fetchProvider();
  }, [fetchChanges, fetchProvider]);

  const triggerPipeline = async () => {
    setRunning(true);
    try {
      await apiJson('/compliance/scrape-and-analyse', { method: 'POST', token: authToken });
      notify('🔄 Pipeline started. This takes 3-5 minutes. Refresh in a bit.');
      setTimeout(() => { setRunning(false); fetchChanges(); }, 10000);
    } catch (e) {
      notify(e.message, 'error');
      setRunning(false);
    }
  };

  const switchProvider = async (p) => {
    try {
      await apiJson('/compliance/provider', { method: 'POST', body: { provider: p }, token: authToken });
      setProvider(p);
      notify(`Switched to ${PROVIDERS[p].label}`);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const approveChange = async (id) => {
    try {
      await apiJson(`/compliance/changes/${id}/approve`, {
        method: 'POST', body: { notes: actionNote }, token: authToken
      });
      notify('✅ Change approved and applied to HRMS!');
      setSelected(null);
      setActionNote('');
      fetchChanges();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const rejectChange = async (id) => {
    if (!actionNote.trim()) return notify('Please enter a reason for rejection', 'error');
    try {
      await apiJson(`/compliance/changes/${id}/reject`, {
        method: 'POST', body: { reason: actionNote }, token: authToken
      });
      notify('Change rejected.');
      setSelected(null);
      setActionNote('');
      fetchChanges();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <div style={styles.page}>
      {/* Notification Toast */}
      {notification && (
        <div style={{ ...styles.toast, background: notification.type === 'error' ? '#dc2626' : '#16a34a' }}>
          {notification.msg}
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>⚖️ AI Compliance Agent</h1>
          <p style={styles.subtitle}>Labour Law Intelligence — Powered by {PROVIDERS[provider]?.label}</p>
        </div>
        <div style={styles.headerActions}>
          <ProviderSelector current={provider} onSwitch={switchProvider} />
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: running ? 0.7 : 1 }}
            onClick={triggerPipeline}
            disabled={running}
          >
            {running ? '🔄 Running...' : '▶ Run Compliance Scan'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryRow}>
        <SummaryCard icon="⏳" label="Pending Review" value={summary.pending || 0} color="#d97706" />
        <SummaryCard icon="🔴" label="Critical Issues" value={changes.filter(c => c.impact_severity === 'critical').length} color="#dc2626" />
        <SummaryCard icon="📊" label="Total Identified" value={summary.total || 0} color="#2563eb" />
        <SummaryCard icon="✅" label="Applied" value={changes.filter(c => c.status === 'applied').length} color="#16a34a" />
      </div>

      {/* Filters */}
      <div style={styles.filterBar}>
        <select style={styles.select} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">All Statuses</option>
          <option value="pending_review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select style={styles.select} value={filter.module} onChange={e => setFilter(f => ({ ...f, module: e.target.value }))}>
          <option value="">All Modules</option>
          {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={styles.select} value={filter.severity} onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))}>
          <option value="">All Severities</option>
          <option value="critical">🚨 Critical</option>
          <option value="high">⚠️ High</option>
          <option value="medium">ℹ️ Medium</option>
          <option value="low">✅ Low</option>
        </select>
        <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={fetchChanges}>Refresh</button>
      </div>

      {/* Changes List */}
      {loading ? (
        <div style={styles.loading}>Scanning compliance database...</div>
      ) : changes.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: 48 }}>⚖️</div>
          <p>No compliance changes found. Run a scan to check for updates.</p>
        </div>
      ) : (
        <div style={styles.changesList}>
          {changes.map(change => (
            <ChangeCard
              key={change.id}
              change={change}
              onSelect={() => setSelected(change)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <ChangeModal
          change={selected}
          note={actionNote}
          setNote={setActionNote}
          onApprove={() => approveChange(selected.id)}
          onReject={() => rejectChange(selected.id)}
          onClose={() => { setSelected(null); setActionNote(''); }}
        />
      )}
    </div>
  );
}

// ─── SUB COMPONENTS ───────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, color }) {
  return (
    <div style={{ ...styles.card, borderTop: `4px solid ${color}`, flex: 1 }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: '#6b7280' }}>{label}</div>
    </div>
  );
}

function ProviderSelector({ current, onSwitch }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => setOpen(o => !o)}>
        🤖 {PROVIDERS[current]?.label} ▾
      </button>
      {open && (
        <div style={styles.dropdown}>
          <div style={styles.dropdownHeader}>Switch AI Provider</div>
          {Object.entries(PROVIDERS).map(([key, p]) => (
            <div
              key={key}
              style={{ ...styles.dropdownItem, background: key === current ? '#f0f9ff' : 'white' }}
              onClick={() => { onSwitch(key); setOpen(false); }}
            >
              <strong>{p.label}</strong>
              <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{p.badge}</span>
              {key === current && <span style={{ marginLeft: 'auto', color: '#16a34a' }}>✓ Active</span>}
            </div>
          ))}
          <div style={styles.dropdownFooter}>
            Set OPENAI_API_KEY or ANTHROPIC_API_KEY env vars to unlock paid providers
          </div>
        </div>
      )}
    </div>
  );
}

function ChangeCard({ change, onSelect }) {
  const sev = SEVERITY_CONFIG[change.impact_severity] || SEVERITY_CONFIG.medium;
  const statusColors = {
    pending_review: '#d97706',
    approved: '#16a34a',
    rejected: '#dc2626',
    applied: '#7c3aed',
  };

  return (
    <div style={styles.card} onClick={onSelect}>
      <div style={styles.cardTop}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...styles.badge, background: sev.bg, color: sev.color }}>
            {sev.icon} {sev.label}
          </span>
          <span style={styles.moduleBadge}>
            {MODULE_LABELS[change.affected_module] || change.affected_module}
          </span>
          {change.state_applicable !== 'ALL' && (
            <span style={{ ...styles.badge, background: '#f3f4f6', color: '#374151' }}>
              📍 {change.state_applicable}
            </span>
          )}
          <span style={{ ...styles.badge, background: '#f3f4f6', color: statusColors[change.status] || '#374151', marginLeft: 'auto' }}>
            {change.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      </div>

      <p style={styles.summary}>{change.summary}</p>

      <div style={styles.cardFooter}>
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          📋 {change.law_reference || 'Reference pending'}
        </span>
        {change.effective_date && (
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            📅 Effective: {new Date(change.effective_date).toLocaleDateString('en-IN')}
          </span>
        )}
        <span style={{ ...styles.btn, ...styles.btnOutline, padding: '4px 12px', fontSize: 12 }}>
          Review →
        </span>
      </div>
    </div>
  );
}

function ChangeModal({ change, note, setNote, onApprove, onReject, onClose }) {
  const sev = SEVERITY_CONFIG[change.impact_severity] || SEVERITY_CONFIG.medium;
  const isPending = change.status === 'pending_review';

  const formatJson = (val) => {
    try {
      const obj = typeof val === 'string' ? JSON.parse(val) : val;
      return JSON.stringify(obj, null, 2);
    } catch { return String(val); }
  };

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>Compliance Change Review</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* Severity + Module */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ ...styles.badge, background: sev.bg, color: sev.color, fontSize: 14, padding: '6px 14px' }}>
              {sev.icon} {sev.label} Impact
            </span>
            <span style={styles.moduleBadge}>
              {MODULE_LABELS[change.affected_module] || change.affected_module}
            </span>
            {change.state_applicable !== 'ALL' && (
              <span style={{ ...styles.badge, background: '#f3f4f6', color: '#374151' }}>
                📍 Applicable to: {change.state_applicable}
              </span>
            )}
          </div>

          {/* Summary */}
          <Section title="📋 Summary">
            <p style={{ margin: 0, lineHeight: 1.6 }}>{change.summary}</p>
          </Section>

          {/* Law Reference */}
          <Section title="⚖️ Law / Notification Reference">
            <p style={{ margin: 0, color: '#2563eb' }}>{change.law_reference || 'Not specified'}</p>
            {change.effective_date && (
              <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13 }}>
                Effective Date: {new Date(change.effective_date).toLocaleDateString('en-IN')}
              </p>
            )}
          </Section>

          {/* Before/After */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Section title="📌 Current Values (Before)">
              <pre style={styles.code}>{formatJson(change.old_value)}</pre>
            </Section>
            <Section title="✅ Proposed New Values (After)">
              <pre style={{ ...styles.code, borderColor: '#16a34a', background: '#f0fdf4' }}>
                {formatJson(change.new_value)}
              </pre>
            </Section>
          </div>

          {/* AI Provider */}
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
            🤖 Analysed by: {PROVIDERS[change.ai_provider]?.label || change.ai_provider} 
            &nbsp;|&nbsp; Confidence: {Math.round((change.confidence || 0) * 100)}%
            &nbsp;|&nbsp; Detected: {new Date(change.created_at).toLocaleString('en-IN')}
          </div>

          {/* Action area */}
          {isPending && (
            <Section title="📝 Review Notes">
              <textarea
                style={styles.textarea}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add notes about this decision (required for rejection)..."
                rows={3}
              />
            </Section>
          )}

          {!isPending && change.admin_notes && (
            <Section title="📝 Admin Decision Notes">
              <p style={{ margin: 0, color: '#6b7280' }}>{change.admin_notes}</p>
            </Section>
          )}
        </div>

        {/* Footer Actions */}
        <div style={styles.modalFooter}>
          <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={onClose}>
            Close
          </button>
          {isPending && (
            <>
              <button
                style={{ ...styles.btn, background: '#dc2626', color: 'white', borderColor: '#dc2626' }}
                onClick={onReject}
              >
                ✕ Reject Change
              </button>
              <button
                style={{ ...styles.btn, background: '#16a34a', color: 'white', borderColor: '#16a34a' }}
                onClick={onApprove}
              >
                ✓ Approve & Apply to HRMS
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 14, color: '#374151', fontWeight: 600 }}>{title}</h4>
      {children}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = {
  page: { padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 },
  title: { margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' },
  subtitle: { margin: '4px 0 0', color: '#6b7280', fontSize: 14 },
  headerActions: { display: 'flex', gap: 12, alignItems: 'center' },
  summaryRow: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  card: { background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'box-shadow 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  cardTop: { marginBottom: 12 },
  summary: { margin: '0 0 12px', color: '#374151', lineHeight: 1.6, fontSize: 14 },
  cardFooter: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  filterBar: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
  select: { padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, background: 'white', color: '#374151', cursor: 'pointer' },
  btn: { padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer', fontSize: 14, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnPrimary: { background: '#1d4ed8', color: 'white', borderColor: '#1d4ed8' },
  btnOutline: { background: 'white', color: '#374151' },
  badge: { padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 },
  moduleBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: '#e0e7ff', color: '#3730a3' },
  loading: { textAlign: 'center', padding: 60, color: '#6b7280', fontSize: 16 },
  empty: { textAlign: 'center', padding: 60, color: '#6b7280' },
  changesList: { display: 'flex', flexDirection: 'column', gap: 12 },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: 'white', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' },
  modalBody: { padding: 24, overflowY: 'auto', flex: 1 },
  modalFooter: { display: 'flex', gap: 12, padding: '16px 24px', borderTop: '1px solid #e5e7eb', justifyContent: 'flex-end' },
  closeBtn: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: 4 },
  code: { margin: 0, padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' },
  textarea: { width: '100%', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  toast: { position: 'fixed', top: 20, right: 20, color: 'white', padding: '12px 20px', borderRadius: 10, zIndex: 2000, fontSize: 14, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  dropdown: { position: 'absolute', top: '100%', right: 0, marginTop: 8, background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 280, zIndex: 100 },
  dropdownHeader: { padding: '12px 16px', fontWeight: 600, fontSize: 13, color: '#6b7280', borderBottom: '1px solid #f3f4f6' },
  dropdownItem: { display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', fontSize: 14 },
  dropdownFooter: { padding: '10px 16px', fontSize: 11, color: '#9ca3af', borderTop: '1px solid #f3f4f6' },
};

// HRMS AI Compliance Agent — Frontend App (Vanilla JS, no build step)
const API = '/api/compliance';

const SEVERITY = {
  critical: { color: '#dc2626', bg: '#fef2f2', label: 'Critical', icon: '\u{1F6A8}' },
  high: { color: '#d97706', bg: '#fffbeb', label: 'High', icon: '\u26A0\uFE0F' },
  medium: { color: '#2563eb', bg: '#eff6ff', label: 'Medium', icon: '\u2139\uFE0F' },
  low: { color: '#16a34a', bg: '#f0fdf4', label: 'Low', icon: '\u2705' },
};

const MODULES = {
  pf: 'Provident Fund (PF)', esi: 'ESI', tds: 'TDS / Income Tax',
  professional_tax: 'Professional Tax', minimum_wage: 'Minimum Wages',
  gratuity: 'Gratuity', bonus: 'Bonus Act', maternity: 'Maternity Benefit',
  labour_welfare_fund: 'Labour Welfare Fund', payroll_settings: 'Payroll Settings',
};


const PROVIDERS = {
  gemini: { label: 'Gemini 2.5 Pro', badge: 'Free' },
  groq: { label: 'Groq Llama 3.3', badge: 'Free' },
  openai: { label: 'GPT-4o', badge: 'Paid' },
  anthropic: { label: 'Claude 3.5 Sonnet', badge: 'Paid' },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {
  changes: [],
  summary: { total: 0, pending: 0 },
  provider: 'gemini',
  filter: { status: 'pending_review', module: '', severity: '' },
  pipelineRunning: false,
  pipelineLogs: [],
  selectedChange: null,
  notification: null,
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo-token' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

function notify(msg, type = 'success') {
  state.notification = { msg, type };
  render();
  setTimeout(() => { state.notification = null; render(); }, 4000);
}


// ─── DATA FETCHING ────────────────────────────────────────────────────────────
async function fetchChanges() {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(state.filter).filter(([, v]) => v))
  );
  const data = await api(`/changes?${params}`);
  state.changes = data.changes || [];
  state.summary = { total: data.total, pending: data.pending };
  render();
}

async function fetchProvider() {
  const data = await api('/provider');
  state.provider = data.current;
  render();
}

// ─── PIPELINE SSE ─────────────────────────────────────────────────────────────
let eventSource = null;

function startPipelineStream() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`${API}/pipeline/stream`);
  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    state.pipelineLogs.push(event);
    if (state.pipelineLogs.length > 50) state.pipelineLogs.shift();
    
    if (event.type === 'complete') {
      state.pipelineRunning = false;
      fetchChanges();
      notify(event.message);
    }
    render();
  };
}

async function triggerPipeline() {
  state.pipelineRunning = true;
  state.pipelineLogs = [];
  render();
  await api('/scrape-and-analyse', { method: 'POST' });
  startPipelineStream();
}


// ─── ACTIONS ──────────────────────────────────────────────────────────────────
async function approveChange(id) {
  const notes = document.getElementById('action-note')?.value || '';
  await api(`/changes/${id}/approve`, { method: 'POST', body: { notes } });
  state.selectedChange = null;
  notify('\u2705 Change approved and applied to HRMS!');
  fetchChanges();
}

async function rejectChange(id) {
  const reason = document.getElementById('action-note')?.value || '';
  if (!reason.trim()) { notify('Please enter a reason for rejection', 'error'); return; }
  await api(`/changes/${id}/reject`, { method: 'POST', body: { reason } });
  state.selectedChange = null;
  notify('Change rejected.');
  fetchChanges();
}

async function switchProvider(p) {
  await api('/provider', { method: 'POST', body: { provider: p } });
  state.provider = p;
  notify(`Switched to ${PROVIDERS[p].label}`);
  render();
}

function setFilter(key, value) {
  state.filter[key] = value;
  fetchChanges();
}

function selectChange(change) {
  state.selectedChange = change;
  render();
}

function closeModal() {
  state.selectedChange = null;
  render();
}


// ─── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderNotification()}
    ${renderHeader()}
    ${renderPipelinePanel()}
    ${renderSummaryCards()}
    ${renderFilters()}
    ${renderChangesList()}
    ${state.selectedChange ? renderModal(state.selectedChange) : ''}
  `;
}

function renderNotification() {
  if (!state.notification) return '';
  const bg = state.notification.type === 'error' ? '#dc2626' : '#16a34a';
  return `<div style="position:fixed;top:20px;right:20px;background:${bg};color:white;padding:12px 20px;border-radius:10px;z-index:2000;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15)">${state.notification.msg}</div>`;
}

function renderHeader() {
  const prov = PROVIDERS[state.provider] || PROVIDERS.gemini;
  return `
    <div class="header">
      <div>
        <h1 class="title">\u2696\uFE0F AI Compliance Agent</h1>
        <p class="subtitle">Labour Law Intelligence \u2014 Powered by ${prov.label} | Vinpro HRMS</p>
      </div>
      <div class="header-actions">
        <select class="btn" onchange="switchProvider(this.value)">
          ${Object.entries(PROVIDERS).map(([k,v]) => `<option value="${k}" ${k===state.provider?'selected':''}>\u{1F916} ${v.label} (${v.badge})</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="triggerPipeline()" ${state.pipelineRunning?'disabled':''}>
          ${state.pipelineRunning ? '\u{1F504} Running...' : '\u25B6 Run Compliance Scan'}
        </button>
      </div>
    </div>`;
}


function renderPipelinePanel() {
  if (!state.pipelineRunning && state.pipelineLogs.length === 0) return '';
  const lastLog = state.pipelineLogs[state.pipelineLogs.length - 1];
  const percent = lastLog?.percent || 0;
  
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;border-left:4px solid #1d4ed8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:16px;font-weight:600">\u{1F50D} Pipeline Progress</h3>
        <span style="font-size:13px;color:#64748b">${percent}% complete</span>
      </div>
      <div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden;margin-bottom:16px">
        <div style="background:linear-gradient(90deg,#1d4ed8,#3b82f6);height:100%;width:${percent}%;transition:width 0.3s;border-radius:8px"></div>
      </div>
      <div style="max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;background:#f8fafc;border-radius:8px;padding:12px">
        ${state.pipelineLogs.slice(-15).map(log => {
          const color = log.type === 'change_found' ? '#d97706' : log.type === 'complete' ? '#16a34a' : '#475569';
          return `<div style="margin-bottom:4px;color:${color}">${log.message || JSON.stringify(log)}</div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderSummaryCards() {
  const critical = state.changes.filter(c => c.impact_severity === 'critical').length;
  const cards = [
    { icon: '\u23F3', label: 'Pending Review', value: state.summary.pending || 0, color: '#d97706' },
    { icon: '\u{1F534}', label: 'Critical Issues', value: critical, color: '#dc2626' },
    { icon: '\u{1F4CA}', label: 'Total Identified', value: state.summary.total || 0, color: '#2563eb' },
    { icon: '\u2705', label: 'Approved', value: state.changes.filter(c => c.status === 'approved').length, color: '#16a34a' },
  ];
  return `
    <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
      ${cards.map(c => `
        <div style="flex:1;min-width:150px;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;border-top:4px solid ${c.color}">
          <div style="font-size:28px;margin-bottom:4px">${c.icon}</div>
          <div style="font-size:32px;font-weight:700;color:${c.color}">${c.value}</div>
          <div style="font-size:13px;color:#64748b">${c.label}</div>
        </div>
      `).join('')}
    </div>`;
}


function renderFilters() {
  return `
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <select class="btn" onchange="setFilter('status',this.value)">
        <option value="">All Statuses</option>
        <option value="pending_review" ${state.filter.status==='pending_review'?'selected':''}>Pending Review</option>
        <option value="approved" ${state.filter.status==='approved'?'selected':''}>Approved</option>
        <option value="rejected" ${state.filter.status==='rejected'?'selected':''}>Rejected</option>
      </select>
      <select class="btn" onchange="setFilter('module',this.value)">
        <option value="">All Modules</option>
        ${Object.entries(MODULES).map(([k,v]) => `<option value="${k}" ${state.filter.module===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <select class="btn" onchange="setFilter('severity',this.value)">
        <option value="">All Severities</option>
        <option value="critical" ${state.filter.severity==='critical'?'selected':''}>\u{1F6A8} Critical</option>
        <option value="high" ${state.filter.severity==='high'?'selected':''}>\u26A0\uFE0F High</option>
        <option value="medium" ${state.filter.severity==='medium'?'selected':''}>\u2139\uFE0F Medium</option>
        <option value="low" ${state.filter.severity==='low'?'selected':''}>\u2705 Low</option>
      </select>
      <button class="btn" onclick="fetchChanges()">\u{1F504} Refresh</button>
    </div>`;
}

function renderChangesList() {
  if (state.changes.length === 0) {
    return `
      <div style="text-align:center;padding:60px;color:#64748b;background:white;border-radius:12px;border:1px solid #e2e8f0">
        <div style="font-size:48px;margin-bottom:12px">\u2696\uFE0F</div>
        <p style="font-size:16px">No compliance changes found.</p>
        <p style="font-size:14px;margin-top:8px">Click <strong>"\u25B6 Run Compliance Scan"</strong> to start scanning government portals for labour law updates.</p>
      </div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${state.changes.map(renderChangeCard).join('')}
  </div>`;
}


function renderChangeCard(change) {
  const sev = SEVERITY[change.impact_severity] || SEVERITY.medium;
  const statusColors = { pending_review: '#d97706', approved: '#16a34a', rejected: '#dc2626' };
  const statusColor = statusColors[change.status] || '#64748b';

  return `
    <div onclick="selectChange(${JSON.stringify(change).replace(/"/g,'&quot;')})" 
         style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;cursor:pointer;transition:box-shadow 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.05)"
         onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)'">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${sev.bg};color:${sev.color}">${sev.icon} ${sev.label}</span>
        <span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:#e0e7ff;color:#3730a3">${MODULES[change.affected_module] || change.affected_module}</span>
        ${change.state_applicable !== 'ALL' ? `<span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:#f3f4f6;color:#374151">\u{1F4CD} ${change.state_applicable}</span>` : ''}
        <span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:#f3f4f6;color:${statusColor};margin-left:auto">${change.status.replace('_',' ').toUpperCase()}</span>
      </div>
      <p style="margin:0 0 12px;color:#374151;line-height:1.6;font-size:14px">${change.summary}</p>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <span style="color:#64748b;font-size:12px">\u{1F4CB} ${change.law_reference || 'Reference pending'}</span>
        ${change.effective_date ? `<span style="color:#64748b;font-size:12px">\u{1F4C5} Effective: ${new Date(change.effective_date).toLocaleDateString('en-IN')}</span>` : ''}
        <span class="btn" style="padding:4px 12px;font-size:12px;margin-left:auto">Review \u2192</span>
      </div>
    </div>`;
}


function renderModal(change) {
  const sev = SEVERITY[change.impact_severity] || SEVERITY.medium;
  const isPending = change.status === 'pending_review';
  const formatJson = (val) => { try { return JSON.stringify(typeof val === 'string' ? JSON.parse(val) : val, null, 2); } catch { return String(val); } };

  return `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px" onclick="if(event.target===this)closeModal()">
      <div style="background:white;border-radius:16px;width:100%;max-width:800px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #e2e8f0">
          <h2 style="font-size:18px;font-weight:700">Compliance Change Review</h2>
          <button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b">\u2715</button>
        </div>
        <div style="padding:24px;overflow-y:auto;flex:1">
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <span style="padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600;background:${sev.bg};color:${sev.color}">${sev.icon} ${sev.label} Impact</span>
            <span style="padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600;background:#e0e7ff;color:#3730a3">${MODULES[change.affected_module] || change.affected_module}</span>
            ${change.state_applicable !== 'ALL' ? `<span style="padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600;background:#f3f4f6;color:#374151">\u{1F4CD} ${change.state_applicable}</span>` : ''}
          </div>

          <div style="margin-bottom:20px">
            <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px">\u{1F4CB} Summary</h4>
            <p style="line-height:1.6;color:#475569">${change.summary}</p>
          </div>

          <div style="margin-bottom:20px">
            <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px">\u2696\uFE0F Law Reference</h4>
            <p style="color:#2563eb">${change.law_reference || 'Not specified'}</p>
            ${change.effective_date ? `<p style="margin-top:8px;color:#64748b;font-size:13px">Effective: ${new Date(change.effective_date).toLocaleDateString('en-IN')}</p>` : ''}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
            <div>
              <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px">\u{1F4CC} Current Values</h4>
              <pre style="padding:12px;background:#f9fafb;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;font-family:monospace">${formatJson(change.old_value)}</pre>
            </div>
            <div>
              <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px">\u2705 Proposed New Values</h4>
              <pre style="padding:12px;background:#f0fdf4;border:1px solid #16a34a;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;font-family:monospace">${formatJson(change.new_value)}</pre>
            </div>
          </div>

          <div style="font-size:12px;color:#94a3b8;margin-bottom:16px">
            \u{1F916} Analysed by: ${PROVIDERS[change.ai_provider]?.label || change.ai_provider} | Confidence: ${Math.round((change.confidence||0)*100)}% | Detected: ${new Date(change.created_at).toLocaleString('en-IN')}
          </div>

          ${isPending ? `
            <div style="margin-bottom:16px">
              <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px">\u{1F4DD} Review Notes</h4>
              <textarea id="action-note" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;resize:vertical;font-family:inherit" rows="3" placeholder="Add notes (required for rejection)..."></textarea>
            </div>` : ''}
        </div>
        <div style="display:flex;gap:12px;padding:16px 24px;border-top:1px solid #e2e8f0;justify-content:flex-end">
          <button class="btn" onclick="closeModal()">Close</button>
          ${isPending ? `
            <button class="btn btn-danger" onclick="rejectChange(${change.id})">\u2715 Reject</button>
            <button class="btn btn-success" onclick="approveChange(${change.id})">\u2713 Approve & Apply</button>
          ` : ''}
        </div>
      </div>
    </div>`;
}


// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  render();
  await fetchProvider();
  await fetchChanges();
  startPipelineStream();
}

init();

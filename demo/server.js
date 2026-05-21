/**
 * HRMS AI Compliance Agent — Realtime Demo Server
 * 
 * This is a self-contained demo that simulates the full compliance pipeline:
 * 1. Scraping government portals (simulated with realistic delays)
 * 2. AI analysis of scraped content (simulated with realistic compliance changes)
 * 3. Admin dashboard to review/approve/reject changes
 * 4. Apply engine that patches HRMS config
 * 
 * No external API keys or database needed — everything runs in-memory.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────

let nextId = 1;
const db = {
  compliance_changes: [],
  raw_updates: [],
  config: {
    pf_employee_rate: 12,
    pf_employer_rate: 12,
    pf_wage_ceiling: 15000,
    esi_employee_rate: 0.75,
    esi_employer_rate: 3.25,
    esi_wage_ceiling: 21000,
    professional_tax_states: ['TN', 'MH', 'KA', 'DL'],
    minimum_wages: { TN: 8660, MH: 12655, KA: 10870, DL: 17494 },
    gratuity_formula: '15/26',
    gratuity_eligibility_years: 5,
    tds_sections: ['192', '194C', '194J'],
    new_tax_regime_default: false,
    bonus_act_ceiling: 21000,
    maternity_benefit_weeks: 26,
  },
  llm_provider: 'gemini',
  pipeline_running: false,
  pipeline_progress: null,
};

// ─── SIMULATED COMPLIANCE CHANGES (Realistic Indian labour law updates) ──────

const SIMULATED_CHANGES = [
  {
    change_type: 'ceiling_change',
    affected_module: 'pf',
    law_reference: 'EPFO Circular No. 2025-C-II/2 dated 15-May-2026',
    state_applicable: 'ALL',
    effective_date: '2026-07-01',
    summary: 'EPFO has raised the PF wage ceiling from ₹15,000 to ₹21,000 per month, effective July 2026. All employers must compute PF on basic wages up to ₹21,000.',
    old_value: { pf_wage_ceiling: 15000 },
    new_value: { pf_wage_ceiling: 21000 },
    impact_severity: 'critical',
    confidence: 0.92,
    source: 'EPFO Circulars',
  },
  {
    change_type: 'rate_change',
    affected_module: 'esi',
    law_reference: 'ESIC Notification S.O. 2341(E) dated 10-May-2026',
    state_applicable: 'ALL',
    effective_date: '2026-07-01',
    summary: 'ESI wage ceiling increased from ₹21,000 to ₹25,000. Employees earning up to ₹25,000/month now eligible for ESI coverage.',
    old_value: { esi_wage_ceiling: 21000 },
    new_value: { esi_wage_ceiling: 25000 },
    impact_severity: 'high',
    confidence: 0.88,
    source: 'ESIC Circulars',
  },
  {
    change_type: 'rate_change',
    affected_module: 'minimum_wage',
    law_reference: 'G.O. Ms. No. 45/2026 Tamil Nadu Labour Dept',
    state_applicable: 'TN',
    effective_date: '2026-06-01',
    summary: 'Tamil Nadu minimum wage for unskilled workers revised from ₹8,660 to ₹9,200 per month under the Minimum Wages Act, 1948.',
    old_value: { minimum_wages_TN: 8660 },
    new_value: { minimum_wages_TN: 9200 },
    impact_severity: 'medium',
    confidence: 0.85,
    source: 'Tamil Nadu Labour Dept',
  },
  {
    change_type: 'rate_change',
    affected_module: 'professional_tax',
    law_reference: 'Karnataka Finance Act 2026, Section 12 Amendment',
    state_applicable: 'KA',
    effective_date: '2026-04-01',
    summary: 'Karnataka Professional Tax maximum monthly deduction increased from ₹200 to ₹250 for employees earning above ₹25,000.',
    old_value: { professional_tax_KA_max: 200 },
    new_value: { professional_tax_KA_max: 250 },
    impact_severity: 'medium',
    confidence: 0.78,
    source: 'Karnataka Labour Dept',
  },
  {
    change_type: 'rate_change',
    affected_module: 'minimum_wage',
    law_reference: 'Notification No. F.1(7)/2026/LE/Lab dated 01-May-2026',
    state_applicable: 'DL',
    effective_date: '2026-05-15',
    summary: 'Delhi minimum wage for unskilled workers increased from ₹17,494 to ₹18,066 per month. Revised semi-annual notification.',
    old_value: { minimum_wages_DL: 17494 },
    new_value: { minimum_wages_DL: 18066 },
    impact_severity: 'medium',
    confidence: 0.82,
    source: 'Delhi Labour Dept',
  },
  {
    change_type: 'new_requirement',
    affected_module: 'tds',
    law_reference: 'Finance Act 2026, Section 192 Amendment',
    state_applicable: 'ALL',
    effective_date: '2026-04-01',
    summary: 'Standard deduction under new tax regime increased from ₹50,000 to ₹75,000 for AY 2027-28. Employers must update TDS computation.',
    old_value: { tds_standard_deduction: 50000 },
    new_value: { tds_standard_deduction: 75000 },
    impact_severity: 'high',
    confidence: 0.95,
    source: 'Income Tax - Notifications',
  },
  {
    change_type: 'ceiling_change',
    affected_module: 'bonus',
    law_reference: 'Payment of Bonus (Amendment) Act, 2026 Notification',
    state_applicable: 'ALL',
    effective_date: '2026-04-01',
    summary: 'Bonus Act eligibility ceiling raised from ₹21,000 to ₹25,000. Employees earning up to ₹25,000 now eligible for statutory bonus.',
    old_value: { bonus_act_ceiling: 21000 },
    new_value: { bonus_act_ceiling: 25000 },
    impact_severity: 'high',
    confidence: 0.80,
    source: 'Ministry of Labour - Notifications',
  },
  {
    change_type: 'rate_change',
    affected_module: 'minimum_wage',
    law_reference: 'Maharashtra Govt Gazette No. MW-2026/CR-19/Lab-7',
    state_applicable: 'MH',
    effective_date: '2026-06-01',
    summary: 'Maharashtra minimum wage for Zone I (Mumbai/Pune) unskilled workers revised from ₹12,655 to ₹13,200 per month.',
    old_value: { minimum_wages_MH: 12655 },
    new_value: { minimum_wages_MH: 13200 },
    impact_severity: 'low',
    confidence: 0.75,
    source: 'Maharashtra Labour Dept',
  },
];

const SCRAPE_SOURCES = [
  { url: 'https://labour.gov.in/latest-news', label: 'Ministry of Labour - News', category: 'central' },
  { url: 'https://labour.gov.in/notifications', label: 'Ministry of Labour - Notifications', category: 'central' },
  { url: 'https://www.epfindia.gov.in/site_en/Circulars.php', label: 'EPFO Circulars', category: 'pf' },
  { url: 'https://www.esic.in/circulars', label: 'ESIC Circulars', category: 'esi' },
  { url: 'https://incometaxindia.gov.in/Pages/notifications.aspx', label: 'Income Tax - Notifications', category: 'tds' },
  { url: 'https://labour.tn.gov.in/', label: 'Tamil Nadu Labour Dept', category: 'state_tn' },
  { url: 'https://mahakamgar.maharashtra.gov.in/', label: 'Maharashtra Labour Dept', category: 'state_mh' },
  { url: 'https://labour.karnataka.gov.in/', label: 'Karnataka Labour Dept', category: 'state_ka' },
  { url: 'https://labour.delhi.gov.in/', label: 'Delhi Labour Dept', category: 'state_dl' },
];

// ─── SIMULATED PIPELINE (with realistic progress events) ─────────────────────

let pipelineSSEClients = [];

function broadcastProgress(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  pipelineSSEClients.forEach(res => res.write(data));
}

async function runSimulatedPipeline() {
  if (db.pipeline_running) return;
  db.pipeline_running = true;
  db.pipeline_progress = { stage: 'starting', source: '', percent: 0 };

  broadcastProgress({ type: 'start', message: 'Compliance pipeline initiated...' });
  await sleep(1000);

  // Phase 1: Scraping
  for (let i = 0; i < SCRAPE_SOURCES.length; i++) {
    const source = SCRAPE_SOURCES[i];
    const percent = Math.round(((i + 1) / SCRAPE_SOURCES.length) * 50);
    
    db.pipeline_progress = { stage: 'scraping', source: source.label, percent };
    broadcastProgress({
      type: 'scraping',
      source: source.label,
      url: source.url,
      percent,
      message: `🔍 Scraping: ${source.label}...`
    });

    await sleep(800 + Math.random() * 1200); // Simulate network delay

    const rawId = nextId++;
    db.raw_updates.push({
      id: rawId,
      source_url: source.url,
      source_label: source.label,
      category: source.category,
      scraped_at: new Date().toISOString(),
      content_size: Math.floor(2000 + Math.random() * 8000),
    });

    broadcastProgress({
      type: 'scraped',
      source: source.label,
      content_size: db.raw_updates[db.raw_updates.length - 1].content_size,
      percent,
      message: `✅ Scraped ${source.label} (${db.raw_updates[db.raw_updates.length - 1].content_size} chars)`
    });

    await sleep(300);
  }

  // Phase 2: AI Analysis
  broadcastProgress({ type: 'analysing', message: '🤖 Running AI analysis on scraped content...', percent: 55 });
  await sleep(2000);

  const changesToAdd = SIMULATED_CHANGES.filter(() => Math.random() > 0.15); // randomly include most changes

  for (let i = 0; i < changesToAdd.length; i++) {
    const change = { ...changesToAdd[i] };
    const percent = 55 + Math.round(((i + 1) / changesToAdd.length) * 40);
    
    db.pipeline_progress = { stage: 'analysing', source: change.source, percent };
    broadcastProgress({
      type: 'change_found',
      change_summary: change.summary,
      severity: change.impact_severity,
      module: change.affected_module,
      percent,
      message: `🔎 Found: ${change.summary.substring(0, 80)}...`
    });

    change.id = nextId++;
    change.status = 'pending_review';
    change.ai_provider = db.llm_provider;
    change.created_at = new Date().toISOString();
    db.compliance_changes.push(change);

    await sleep(600 + Math.random() * 800);
  }

  // Phase 3: Done
  db.pipeline_progress = { stage: 'complete', percent: 100 };
  db.pipeline_running = false;

  broadcastProgress({
    type: 'complete',
    total_changes: changesToAdd.length,
    percent: 100,
    message: `✅ Pipeline complete! Found ${changesToAdd.length} compliance changes pending review.`,
    summary: {
      critical: changesToAdd.filter(c => c.impact_severity === 'critical').length,
      high: changesToAdd.filter(c => c.impact_severity === 'high').length,
      medium: changesToAdd.filter(c => c.impact_severity === 'medium').length,
      low: changesToAdd.filter(c => c.impact_severity === 'low').length,
    }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// SSE endpoint for realtime pipeline progress
app.get('/api/compliance/pipeline/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  pipelineSSEClients.push(res);
  req.on('close', () => {
    pipelineSSEClients = pipelineSSEClients.filter(c => c !== res);
  });
});

// Trigger pipeline
app.post('/api/compliance/scrape-and-analyse', (req, res) => {
  if (db.pipeline_running) {
    return res.json({ message: 'Pipeline already running. Watch the progress stream.' });
  }
  // Clear previous changes for demo reset
  db.compliance_changes = [];
  db.raw_updates = [];
  res.json({ message: 'Compliance pipeline started. Watch the realtime stream for progress.' });
  runSimulatedPipeline();
});

// Get pipeline status
app.get('/api/compliance/pipeline/status', (req, res) => {
  res.json({
    running: db.pipeline_running,
    progress: db.pipeline_progress,
  });
});

// Get changes
app.get('/api/compliance/changes', (req, res) => {
  let { status, module, severity, limit = 50, offset = 0 } = req.query;
  let results = [...db.compliance_changes];

  if (status) results = results.filter(c => c.status === status);
  if (module) results = results.filter(c => c.affected_module === module);
  if (severity) results = results.filter(c => c.impact_severity === severity);

  // Sort by severity
  const sevOrder = { critical: 1, high: 2, medium: 3, low: 4 };
  results.sort((a, b) => (sevOrder[a.impact_severity] || 5) - (sevOrder[b.impact_severity] || 5));

  const pending = db.compliance_changes.filter(c => c.status === 'pending_review').length;

  res.json({
    changes: results.slice(offset, offset + parseInt(limit)),
    total: results.length,
    pending,
  });
});

// Approve
app.post('/api/compliance/changes/:id/approve', (req, res) => {
  const id = parseInt(req.params.id);
  const change = db.compliance_changes.find(c => c.id === id);
  if (!change) return res.status(404).json({ error: 'Change not found' });

  change.status = 'approved';
  change.approved_at = new Date().toISOString();
  change.approved_by = 'super_admin';
  change.admin_notes = req.body.notes || '';

  // Simulate applying to HRMS config
  if (change.new_value) {
    Object.assign(db.config, typeof change.new_value === 'string' ? JSON.parse(change.new_value) : change.new_value);
  }

  res.json({ success: true, message: 'Change approved and applied to HRMS', apply_result: { success: true } });
});

// Reject
app.post('/api/compliance/changes/:id/reject', (req, res) => {
  const id = parseInt(req.params.id);
  const change = db.compliance_changes.find(c => c.id === id);
  if (!change) return res.status(404).json({ error: 'Change not found' });

  change.status = 'rejected';
  change.rejected_at = new Date().toISOString();
  change.rejected_by = 'super_admin';
  change.admin_notes = req.body.reason || '';

  res.json({ success: true, message: 'Change rejected' });
});

// Get raw updates
app.get('/api/compliance/raw-updates', (req, res) => {
  res.json(db.raw_updates);
});

// Provider
app.get('/api/compliance/provider', (req, res) => {
  res.json({
    current: db.llm_provider,
    available: ['gemini', 'groq', 'openai', 'anthropic'],
    descriptions: {
      gemini: 'Google Gemini 2.5 Pro (free — best for legal text)',
      groq: 'Groq Llama 3.3 70B (free — fast)',
      openai: 'OpenAI GPT-4o (paid)',
      anthropic: 'Anthropic Claude 3.5 Sonnet (paid)',
    }
  });
});

app.post('/api/compliance/provider', (req, res) => {
  const { provider } = req.body;
  if (!['gemini', 'groq', 'openai', 'anthropic'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  db.llm_provider = provider;
  res.json({ success: true, provider, message: `Switched to ${provider}` });
});

// Current HRMS config
app.get('/api/compliance/config', (req, res) => {
  res.json(db.config);
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ⚖️  HRMS AI Compliance Agent — REALTIME DEMO`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  🌐 Dashboard:  http://localhost:${PORT}`);
  console.log(`  📡 API Base:   http://localhost:${PORT}/api/compliance`);
  console.log(`  🔄 SSE Stream: http://localhost:${PORT}/api/compliance/pipeline/stream`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  How it works:`);
  console.log(`  1. Click "▶ Run Compliance Scan" to start the pipeline`);
  console.log(`  2. Watch realtime progress as it scrapes govt portals`);
  console.log(`  3. AI analyses content and identifies compliance changes`);
  console.log(`  4. Review each change → Approve or Reject`);
  console.log(`  5. Approved changes auto-apply to HRMS config`);
  console.log(`${'═'.repeat(60)}\n`);
});

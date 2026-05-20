/**
 * Vinpro HRMS — AI Payroll Compliance Agent
 * Backend service: Node.js / Express
 *
 * Monitors TWO regulatory domains:
 *   1. Indian Labour Law  — PF, ESI, PT, Minimum Wages, Gratuity, Bonus, Maternity, LWF
 *   2. Income Tax / TDS   — Section 192 (TDS on salary), standard deduction, regime slabs,
 *                           Section 10 exemptions (HRA/LTA), Chapter VI-A (80C/80D/80G),
 *                           perquisite valuation, Form 16 format, Finance Bill updates
 *
 * ENV VARS REQUIRED:
 *   FIRECRAWL_API_KEY    — from firecrawl.dev
 *   GROQ_API_KEY         — from console.groq.com (free)
 *   LLM_PROVIDER         — "groq" | "openai" | "anthropic" (default: "groq")
 *   OPENAI_API_KEY       — (optional, for future upgrade)
 *   ANTHROPIC_API_KEY    — (optional, for future upgrade)
 *   HRMS_INTERNAL_TOKEN  — your internal service token for HRMS API calls
 *   DB_URL               — your PostgreSQL connection string
 *
 * ROUTES:
 *   POST /compliance/scrape-and-analyse   — trigger full pipeline manually
 *   GET  /compliance/changes              — list pending/all changes
 *   POST /compliance/changes/:id/approve  — super admin approves a change
 *   POST /compliance/changes/:id/reject   — super admin rejects a change
 *   GET  /compliance/raw-updates          — view raw scrape history
 *   GET  /compliance/provider             — get current LLM provider
 *   POST /compliance/provider             — switch LLM provider
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({ connectionString: process.env.DB_URL });
const HRMS_BASE = 'https://hrms.vinproconnect.com';

// ─── LLM PROVIDER ABSTRACTION ─────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt) {
  const provider = process.env.LLM_PROVIDER || 'groq';

  if (provider === 'groq') {
    return callGroq(systemPrompt, userPrompt);
  } else if (provider === 'openai') {
    return callOpenAI(systemPrompt, userPrompt);
  } else if (provider === 'anthropic') {
    return callAnthropic(systemPrompt, userPrompt);
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

async function callGroq(systemPrompt, userPrompt) {
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 4096,
    },
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
  );
  return res.data.choices[0].message.content;
}

async function callOpenAI(systemPrompt, userPrompt) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content;
}

async function callAnthropic(systemPrompt, userPrompt) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      }
    }
  );
  return res.data.content[0].text;
}

// ─── FIRECRAWL SCRAPER ─────────────────────────────────────────────────────────

const SCRAPE_SOURCES = [
  // ── Central labour law portals ───────────────────────────────────────────────
  { url: 'https://labour.gov.in/latest-news', label: 'Ministry of Labour - News', category: 'central' },
  { url: 'https://labour.gov.in/notifications', label: 'Ministry of Labour - Notifications', category: 'central' },
  { url: 'https://www.epfindia.gov.in/site_en/Circulars.php', label: 'EPFO Circulars', category: 'pf' },
  { url: 'https://www.esic.in/ESICWebUI/esicwebui.html#/circulars', label: 'ESIC Circulars', category: 'esi' },
  { url: 'https://www.indiacode.nic.in/handle/123456789/1390', label: 'India Code - Labour Laws', category: 'central' },

  // ── Income Tax / TDS portals (Section 192 + salary deductions) ───────────────
  // Watches for: slab changes, standard deduction, regime updates, Form 16 format,
  //              Section 10 exemptions (HRA/LTA), Chapter VI-A ceilings
  { url: 'https://incometaxindia.gov.in/Pages/press-releases.aspx', label: 'IT Dept - Press Releases', category: 'it_press' },
  { url: 'https://incometaxindia.gov.in/Pages/notifications.aspx', label: 'IT Dept - Notifications (Sec 192 / TDS)', category: 'it_notifications' },
  { url: 'https://incometaxindia.gov.in/Pages/circulars.aspx', label: 'IT Dept - Circulars (employer TDS obligations)', category: 'it_circulars' },
  { url: 'https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx', label: 'Income Tax Act - Sec 10/16/17/80C/80D/80G/192', category: 'it_act' },
  { url: 'https://www.indiabudget.gov.in/', label: 'Union Budget / Finance Bill announcements', category: 'finance_bill' },

  // ── State labour portals ─────────────────────────────────────────────────────
  { url: 'https://labour.tn.gov.in/', label: 'Tamil Nadu Labour Dept', category: 'state_tn' },
  { url: 'https://mahakamgar.maharashtra.gov.in/', label: 'Maharashtra Labour Dept', category: 'state_mh' },
  { url: 'https://labour.karnataka.gov.in/', label: 'Karnataka Labour Dept', category: 'state_ka' },
  { url: 'https://labour.delhi.gov.in/', label: 'Delhi Labour Dept', category: 'state_dl' },
];

async function scrapeWithFirecrawl(url) {
  try {
    const res = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 30000,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    return res.data?.data?.markdown || '';
  } catch (err) {
    console.error(`Firecrawl error for ${url}:`, err.message);
    return '';
  }
}

// ─── DATABASE HELPERS ─────────────────────────────────────────────────────────

async function saveRawUpdate(source, content, category) {
  const q = `
    INSERT INTO compliance_raw_updates (source_url, source_label, category, raw_content, scraped_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id
  `;
  const res = await pool.query(q, [source.url, source.label, category, content]);
  return res.rows[0].id;
}

async function saveComplianceChange(change) {
  const q = `
    INSERT INTO compliance_changes (
      raw_update_id, change_type, affected_module, law_reference,
      state_applicable, effective_date, summary, old_value, new_value,
      impact_severity, status, ai_provider, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review',$11,NOW())
    RETURNING id
  `;
  const res = await pool.query(q, [
    change.raw_update_id,
    change.change_type,
    change.affected_module,
    change.law_reference,
    change.state_applicable,
    change.effective_date,
    change.summary,
    JSON.stringify(change.old_value),
    JSON.stringify(change.new_value),
    change.impact_severity,
    process.env.LLM_PROVIDER || 'groq',
  ]);
  return res.rows[0].id;
}

// ─── FETCH CURRENT HRMS CONFIG ────────────────────────────────────────────────

async function fetchCurrentHRMSConfig() {
  try {
    const res = await axios.get(`${HRMS_BASE}/api/employer/payroll/settings`, {
      headers: { Authorization: `Bearer ${process.env.HRMS_INTERNAL_TOKEN}` }
    });
    return res.data;
  } catch {
    // Return known config structure if API unavailable.
    // IMPORTANT: These are baseline values as originally configured.
    // The agent will detect where the live law has moved ahead of these baselines
    // and flag the delta as a compliance change requiring super-admin approval.
    return {
      // ── Statutory deductions ─────────────────────────────────────────────────
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
      bonus_act_ceiling: 21000,
      maternity_benefit_weeks: 26,

      // ── Income Tax / TDS config (Section 192 — TDS on salary) ────────────────
      // Standard deduction under Section 16(ia)
      // NOTE: Finance Act 2024 raised this to ₹75,000 for new regime.
      //       Old regime remains ₹50,000. Agent will flag this if not updated.
      tds_standard_deduction: 50000,

      // Default regime selection for new employees
      tds_regime_default: 'new',

      // Old Regime slabs (unchanged since FY 2023-24)
      tds_old_regime_slabs: [
        { from: 0,       to: 250000,  rate: 0  },
        { from: 250001,  to: 500000,  rate: 5  },
        { from: 500001,  to: 1000000, rate: 20 },
        { from: 1000001, to: null,    rate: 30 },
      ],

      // New Regime slabs as originally configured (FY 2023-24 baseline).
      // Budget 2025 changed these significantly — agent should detect and flag
      // if the live IT portal announces updated slabs.
      tds_new_regime_slabs: [
        { from: 0,       to: 300000,  rate: 0  },
        { from: 300001,  to: 600000,  rate: 5  },
        { from: 600001,  to: 900000,  rate: 10 },
        { from: 900001,  to: 1200000, rate: 15 },
        { from: 1200001, to: 1500000, rate: 20 },
        { from: 1500001, to: null,    rate: 30 },
      ],

      // Chapter VI-A deduction ceilings
      tds_section_80c_ceiling: 150000,
      tds_section_80d_self: 25000,
      tds_section_80d_senior_parent: 50000,

      // Section 10 exemption parameters
      tds_hra_metro_pct: 50,          // HRA exemption % for metro cities
      tds_hra_nonmetro_pct: 40,       // HRA exemption % for non-metro
      tds_lta_exemption_enabled: true,

      // 87A rebate limit for new regime (₹7L baseline; Budget 2025 raised to ₹12L)
      tds_new_regime_rebate_ceiling: 700000,

      // Surcharge threshold (₹50L — where 10% surcharge kicks in)
      tds_surcharge_threshold: 5000000,
    };
  }
}

// ─── AI ANALYSIS ENGINE ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Indian payroll and tax compliance analyst covering both labour law and income tax law as they affect employer salary computations.

Your job is to:
1. Analyse scraped content from official government portals (labour law AND Income Tax Department) about regulatory updates
2. Compare these updates against the current HRMS payroll configuration
3. Identify specific changes that need to be made to the payroll system to stay compliant
4. Output ONLY a valid JSON array of compliance change objects — nothing else

Each change object must have:
{
  "change_type": "rate_change" | "ceiling_change" | "new_requirement" | "deadline_change" | "exemption_change" | "form_change" | "slab_change" | "regime_change",
  "affected_module": one of the values listed below,
  "law_reference": "exact act/notification/circular reference (e.g. 'Finance Act 2025 s.2(3)', 'CBDT Circular No.04/2025', 'EPFO Circular WSU/40/15/1/2024')",
  "state_applicable": "ALL" | "TN" | "MH" | "KA" | "DL" | etc,
  "effective_date": "YYYY-MM-DD or null",
  "summary": "1-2 sentence plain English explanation of the change and its payroll impact",
  "old_value": { ... current config values that need changing ... },
  "new_value": { ... what they should change to ... },
  "impact_severity": "critical" | "high" | "medium" | "low",
  "confidence": 0.0-1.0
}

AFFECTED MODULE VALUES — Labour Law:
  "pf"                  — PF/EPF rate or wage ceiling changes (EPFO)
  "esi"                 — ESI rate or wage ceiling changes (ESIC)
  "professional_tax"    — PT rate or slab changes (state-specific)
  "minimum_wage"        — Minimum wage revision (state-specific)
  "gratuity"            — Gratuity formula, eligibility or ceiling changes
  "bonus"               — Bonus Act ceiling or eligibility changes
  "maternity"           — Maternity Benefit Act changes
  "labour_welfare_fund" — LWF rate or applicability changes
  "payroll_settings"    — General payroll config changes not covered above

AFFECTED MODULE VALUES — Income Tax / TDS (Section 192):
  "tds_slab"              — Income tax slab rate changes (either regime)
  "tds_standard_deduction"— Standard deduction limit under Section 16(ia)
  "tds_section_10"        — Section 10 exemptions: HRA (10(13A)), LTA (10(5)), children education allowance (10(14))
  "tds_section_80c"       — 80C deduction ceiling: PF, PPF, LIC, ELSS, tuition fees, home loan principal
  "tds_section_80d"       — 80D: medical insurance premium deduction ceiling
  "tds_section_80g"       — 80G: donations and charitable contribution deductions
  "tds_perquisites"       — Perquisite valuation rule changes: company car, ESOP, rent-free accommodation
  "tds_form16"            — Structural changes to Form 16 Part A or Part B format
  "tds_new_regime"        — New tax regime slab changes, rebate ceiling, standard deduction (Budget announcements)
  "tds_old_regime"        — Old tax regime specific changes (slab rates, exemptions)
  "tds_declaration_window"— IT declaration / proof of investment submission window dates

INCOME TAX ANALYSIS GUIDANCE:
- Pay special attention to Finance Bill / Finance Act announcements — these change slab rates every year
- Standard deduction changes affect ALL salaried employees — always mark as impact_severity: "high" or "critical"
- Regime slab changes affect how TDS is computed for new vs old regime employees
- Section 80C ceiling changes affect the maximum deduction employees can claim
- 87A rebate ceiling changes affect whether employees pay zero tax (current new regime: ₹12L rebate ceiling as of Budget 2025)
- HRA exemption formula (min of 3 rules) is unchanged but metro city classification may change
- New regime made default from FY 2024-25 onwards — flag if any circular changes this

SEVERITY GUIDELINES:
  critical — affects TDS computation formula or rate directly (slab changes, standard deduction, rebate ceiling)
  high     — affects deduction ceilings or exemption rules (80C, 80D, HRA%)
  medium   — affects form formats, declaration windows, clarifications
  low      — interpretive circulars, FAQ-type notifications with no config impact

Only output changes where confidence >= 0.6. If nothing changed, return [].
Do NOT invent changes. Only report what the scraped content EXPLICITLY mentions.
For income tax content: only flag changes from FY 2024-25 onwards (earlier FY changes are already known).`;

async function analyseContent(rawContent, currentConfig, rawUpdateId) {
  const userPrompt = `
SCRAPED CONTENT FROM GOVERNMENT PORTAL:
${rawContent.substring(0, 6000)}

CURRENT HRMS PAYROLL CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

Identify all compliance changes this content requires for the HRMS payroll system.
Return JSON array only.`;

  try {
    const response = await callLLM(SYSTEM_PROMPT, userPrompt);
    
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    
    const changes = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(changes)) return [];
    
    const results = [];
    for (const change of changes) {
      if (change.confidence >= 0.6) {
        change.raw_update_id = rawUpdateId;
        const id = await saveComplianceChange(change);
        results.push({ id, ...change });
      }
    }
    return results;
  } catch (err) {
    console.error('AI analysis error:', err.message);
    return [];
  }
}

// ─── MAIN PIPELINE ────────────────────────────────────────────────────────────

async function runCompliancePipeline() {
  console.log('[Compliance Agent] Starting pipeline...');
  const currentConfig = await fetchCurrentHRMSConfig();
  const allChanges = [];

  for (const source of SCRAPE_SOURCES) {
    console.log(`[Scraping] ${source.label}`);
    const content = await scrapeWithFirecrawl(source.url);
    
    if (!content || content.length < 100) {
      console.log(`[Scraping] Skipping — no content for ${source.url}`);
      continue;
    }

    const rawId = await saveRawUpdate(source, content, source.category);
    console.log(`[Analysis] Analysing ${source.label} with ${process.env.LLM_PROVIDER || 'groq'}...`);
    
    const changes = await analyseContent(content, currentConfig, rawId);
    allChanges.push(...changes);
    
    // Rate limit: wait 2s between sources
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[Compliance Agent] Done. Found ${allChanges.length} changes pending review.`);
  return allChanges;
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Middleware: verify super admin token
function requireSuperAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.HRMS_INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Trigger full pipeline manually
router.post('/scrape-and-analyse', requireSuperAdmin, async (req, res) => {
  res.json({ message: 'Compliance pipeline started. Check /compliance/changes for results.' });
  runCompliancePipeline().catch(console.error); // run async
});

// Get all compliance changes (filterable by status)
router.get('/changes', requireSuperAdmin, async (req, res) => {
  const { status, module, severity, limit = 50, offset = 0 } = req.query;
  let where = [];
  let params = [];
  let i = 1;

  if (status) { where.push(`status = $${i++}`); params.push(status); }
  if (module) { where.push(`affected_module = $${i++}`); params.push(module); }
  if (severity) { where.push(`impact_severity = $${i++}`); params.push(severity); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const q = `
    SELECT * FROM compliance_changes
    ${whereClause}
    ORDER BY 
      CASE impact_severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END,
      created_at DESC
    LIMIT $${i++} OFFSET $${i}
  `;
  params.push(limit, offset);

  const result = await pool.query(q, params);
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM compliance_changes ${whereClause}`,
    params.slice(0, -2)
  );

  res.json({
    changes: result.rows,
    total: parseInt(countResult.rows[0].count),
    pending: (await pool.query(`SELECT COUNT(*) FROM compliance_changes WHERE status = 'pending_review'`)).rows[0].count
  });
});

// Approve a change
router.post('/changes/:id/approve', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  const adminUser = req.headers['x-admin-user'] || 'super_admin';

  const change = await pool.query('SELECT * FROM compliance_changes WHERE id = $1', [id]);
  if (!change.rows.length) return res.status(404).json({ error: 'Change not found' });

  await pool.query(`
    UPDATE compliance_changes 
    SET status = 'approved', approved_by = $1, approved_at = NOW(), admin_notes = $2
    WHERE id = $3
  `, [adminUser, notes, id]);

  // Attempt to apply the change to HRMS
  const applyResult = await applyChangeToHRMS(change.rows[0]);

  res.json({ 
    success: true, 
    message: 'Change approved and applied to HRMS',
    apply_result: applyResult
  });
});

// Reject a change
router.post('/changes/:id/reject', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminUser = req.headers['x-admin-user'] || 'super_admin';

  await pool.query(`
    UPDATE compliance_changes 
    SET status = 'rejected', rejected_by = $1, rejected_at = NOW(), admin_notes = $2
    WHERE id = $3
  `, [adminUser, reason, id]);

  res.json({ success: true, message: 'Change rejected' });
});

// Get raw scrape history
router.get('/raw-updates', requireSuperAdmin, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const result = await pool.query(
    'SELECT id, source_label, category, scraped_at, LENGTH(raw_content) as content_size FROM compliance_raw_updates ORDER BY scraped_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  res.json(result.rows);
});

// Get/set LLM provider
router.get('/provider', requireSuperAdmin, (req, res) => {
  res.json({ 
    current: process.env.LLM_PROVIDER || 'groq',
    available: ['groq', 'openai', 'anthropic'],
    descriptions: {
      groq: 'Groq Llama 3.3 70B (free)',
      openai: 'OpenAI GPT-4o (paid)',
      anthropic: 'Anthropic Claude 3.5 Sonnet (paid)'
    }
  });
});

router.post('/provider', requireSuperAdmin, (req, res) => {
  const { provider } = req.body;
  if (!['groq', 'openai', 'anthropic'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Use: groq, openai, anthropic' });
  }
  process.env.LLM_PROVIDER = provider;
  res.json({ success: true, provider, message: `Switched to ${provider}` });
});

// ─── APPLY CHANGE TO HRMS ──────────────────────────────────────────────────────

async function applyChangeToHRMS(change) {
  const newValues = typeof change.new_value === 'string' 
    ? JSON.parse(change.new_value) 
    : change.new_value;

  const moduleEndpointMap = {
    // ── Labour law modules ────────────────────────────────────────────────────
    pf:                    '/api/employer/payroll/settings/pf',
    esi:                   '/api/employer/payroll/settings/esi',
    professional_tax:      '/api/employer/payroll/settings/professional-tax',
    minimum_wage:          '/api/employer/payroll/settings/minimum-wages',
    gratuity:              '/api/employer/payroll/settings/gratuity',
    bonus:                 '/api/employer/payroll/settings/bonus',
    maternity:             '/api/employer/payroll/settings/statutory',
    labour_welfare_fund:   '/api/employer/payroll/settings/lwf',
    payroll_settings:      '/api/employer/payroll/settings',

    // ── Income Tax / TDS modules (Section 192) ────────────────────────────────
    // Slab changes affect both regime computation paths — high impact
    tds_slab:              '/api/employer/payroll/settings/tds/slabs',

    // Standard deduction under Section 16(ia) — applies to all employees
    tds_standard_deduction: '/api/employer/payroll/settings/tds',

    // Section 10 exemptions: HRA, LTA, children education allowance
    tds_section_10:        '/api/employer/payroll/settings/tds/exemptions',

    // Chapter VI-A deduction ceilings
    tds_section_80c:       '/api/employer/payroll/settings/tds/deductions',
    tds_section_80d:       '/api/employer/payroll/settings/tds/deductions',
    tds_section_80g:       '/api/employer/payroll/settings/tds/deductions',

    // Perquisite valuation rules (company car, ESOP, rent-free accommodation)
    tds_perquisites:       '/api/employer/payroll/settings/tds/perquisites',

    // Form 16 format changes — flagged but require manual template update
    tds_form16:            '/api/employer/payroll/settings/tds',

    // New / old regime specific updates
    tds_new_regime:        '/api/employer/payroll/settings/tds/new-regime',
    tds_old_regime:        '/api/employer/payroll/settings/tds/old-regime',

    // Declaration window dates (when employees can submit IT declarations)
    tds_declaration_window: '/api/employer/payroll/settings/tds/windows',
  };

  const endpoint = moduleEndpointMap[change.affected_module] || '/api/employer/payroll/settings';

  try {
    const res = await axios.patch(
      `${HRMS_BASE}${endpoint}`,
      newValues,
      {
        headers: {
          Authorization: `Bearer ${process.env.HRMS_INTERNAL_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Compliance-Change-Id': change.id,
          'X-Applied-By': 'compliance-agent',
        }
      }
    );

    await pool.query(
      `UPDATE compliance_changes SET applied_at = NOW(), apply_status = 'success' WHERE id = $1`,
      [change.id]
    );

    return { success: true, status: res.status };
  } catch (err) {
    await pool.query(
      `UPDATE compliance_changes SET apply_status = 'failed', apply_error = $1 WHERE id = $2`,
      [err.message, change.id]
    );
    return { success: false, error: err.message };
  }
}

module.exports = router;
module.exports.runCompliancePipeline = runCompliancePipeline;

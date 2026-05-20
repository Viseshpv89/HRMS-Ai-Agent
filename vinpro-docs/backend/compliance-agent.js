/**
 * Vinpro HRMS — AI Labour Law Compliance Agent
 * Backend service: Node.js / Express
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
  { url: 'https://labour.gov.in/latest-news', label: 'Ministry of Labour - News', category: 'central' },
  { url: 'https://labour.gov.in/notifications', label: 'Ministry of Labour - Notifications', category: 'central' },
  { url: 'https://www.epfindia.gov.in/site_en/Circulars.php', label: 'EPFO Circulars', category: 'pf' },
  { url: 'https://www.esic.in/ESICWebUI/esicwebui.html#/circulars', label: 'ESIC Circulars', category: 'esi' },
  { url: 'https://incometaxindia.gov.in/Pages/press-releases.aspx', label: 'Income Tax - Press Releases', category: 'tds' },
  { url: 'https://incometaxindia.gov.in/Pages/notifications.aspx', label: 'Income Tax - Notifications', category: 'tds' },
  { url: 'https://labour.tn.gov.in/', label: 'Tamil Nadu Labour Dept', category: 'state_tn' },
  { url: 'https://mahakamgar.maharashtra.gov.in/', label: 'Maharashtra Labour Dept', category: 'state_mh' },
  { url: 'https://labour.karnataka.gov.in/', label: 'Karnataka Labour Dept', category: 'state_ka' },
  { url: 'https://labour.delhi.gov.in/', label: 'Delhi Labour Dept', category: 'state_dl' },
  { url: 'https://www.indiacode.nic.in/handle/123456789/1390', label: 'India Code - Labour Laws', category: 'central' },
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
    // Return known config structure if API unavailable
    return {
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
    };
  }
}

// ─── AI ANALYSIS ENGINE ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Indian labour law and payroll compliance analyst.
Your job is to:
1. Analyse scraped content from official government portals about labour law updates
2. Compare these updates against the current HRMS/payroll configuration
3. Identify specific changes that need to be made to the payroll system to stay compliant
4. Output ONLY a valid JSON array of compliance change objects — nothing else

Each change object must have:
{
  "change_type": "rate_change" | "ceiling_change" | "new_requirement" | "deadline_change" | "exemption_change" | "form_change",
  "affected_module": "pf" | "esi" | "tds" | "professional_tax" | "minimum_wage" | "gratuity" | "bonus" | "maternity" | "labour_welfare_fund" | "payroll_settings",
  "law_reference": "exact act/notification/circular reference",
  "state_applicable": "ALL" | "TN" | "MH" | "KA" | "DL" | etc,
  "effective_date": "YYYY-MM-DD or null",
  "summary": "1-2 sentence plain English explanation of the change",
  "old_value": { ... current config values that need changing ... },
  "new_value": { ... what they should change to ... },
  "impact_severity": "critical" | "high" | "medium" | "low",
  "confidence": 0.0-1.0
}

Only output changes where confidence >= 0.6. If nothing changed, return [].
Do NOT invent changes. Only report what the scraped content explicitly mentions.`;

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
    pf: '/api/employer/payroll/settings/pf',
    esi: '/api/employer/payroll/settings/esi',
    tds: '/api/employer/payroll/settings/tds',
    professional_tax: '/api/employer/payroll/settings/professional-tax',
    minimum_wage: '/api/employer/payroll/settings/minimum-wages',
    gratuity: '/api/employer/payroll/settings/gratuity',
    bonus: '/api/employer/payroll/settings/bonus',
    maternity: '/api/employer/payroll/settings/statutory',
    labour_welfare_fund: '/api/employer/payroll/settings/lwf',
    payroll_settings: '/api/employer/payroll/settings',
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

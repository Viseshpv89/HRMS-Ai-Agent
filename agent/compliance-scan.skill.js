#!/usr/bin/env node
/**
 * Vinpro HRMS — Weekly Compliance Scan Skill
 * Uses Firecrawl (deep pages) if key is valid, otherwise falls back to
 * homepage direct-fetch which we have confirmed works from this environment.
 */

const axios = require('axios');
const https = require('https');

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (!GROQ_KEY) {
  console.error(JSON.stringify({ error: 'Missing GROQ_API_KEY' }));
  process.exit(1);
}

// Deep-page sources — used when Firecrawl key is valid
const FC_SOURCES = [
  { url: 'https://labour.gov.in/whatsnew',                         label: 'Ministry of Labour – Whats New',         category: 'central'   },
  { url: 'https://www.epfindia.gov.in/site_en/Circulars.php',      label: 'EPFO Circulars',                         category: 'pf'        },
  { url: 'https://esic.gov.in/ESICWebUI/esicwebui.html#/circulars',label: 'ESIC Circulars',                         category: 'esi'       },
  { url: 'https://incometaxindia.gov.in/Pages/press-releases.aspx',label: 'Income Tax – Press Releases',            category: 'tds'       },
  { url: 'https://labour.tn.gov.in/en/notices',                    label: 'Tamil Nadu Labour – Notices',            category: 'state_tn'  },
  { url: 'https://mahakamgar.maharashtra.gov.in/notifications.htm',label: 'Maharashtra Labour – Notifications',     category: 'state_mh'  },
  { url: 'https://labour.karnataka.gov.in/',                       label: 'Karnataka Labour Dept',                  category: 'state_ka'  },
  { url: 'https://labour.delhi.gov.in/',                           label: 'Delhi Labour Dept',                      category: 'state_dl'  },
];

// Homepage fallbacks — confirmed accessible via direct HTTP from this sandbox
const DIRECT_SOURCES = [
  { url: 'https://labour.gov.in/',            label: 'Ministry of Labour – Homepage',  category: 'central'   },
  { url: 'https://www.epfindia.gov.in/',      label: 'EPFO – Homepage',                category: 'pf'        },
  { url: 'https://esic.gov.in/',              label: 'ESIC – Homepage',                category: 'esi'       },
  { url: 'https://incometaxindia.gov.in/',    label: 'Income Tax India – Homepage',    category: 'tds'       },
  { url: 'https://labour.tn.gov.in/',         label: 'Tamil Nadu Labour – Homepage',   category: 'state_tn'  },
  { url: 'https://mahakamgar.maharashtra.gov.in/', label: 'Maharashtra Labour – Homepage', category: 'state_mh' },
];

const CURRENT_CONFIG = {
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
  new_tax_regime_default: false,
  tds_standard_deduction: 50000,
};

const SYSTEM_PROMPT = `You are an expert Indian labour law and payroll compliance analyst for an HRMS/payroll platform.

Analyse the scraped content from an official government portal and compare it against the current HRMS payroll configuration.
Identify ONLY real, specific changes that require updates to the payroll system.

Output ONLY a valid JSON array. Each object must have exactly these fields:
{
  "change_type": one of "rate_change" | "ceiling_change" | "new_requirement" | "deadline_change" | "exemption_change" | "form_change",
  "affected_module": one of "pf" | "esi" | "tds" | "professional_tax" | "minimum_wage" | "gratuity" | "bonus" | "maternity" | "labour_welfare_fund" | "payroll_settings",
  "law_reference": "exact act/notification/circular reference",
  "state_applicable": "ALL" or a state code like "TN" or "MH",
  "effective_date": "YYYY-MM-DD" or null,
  "summary": "1-2 sentence plain English explanation of what changed",
  "old_value": { current config key-value pairs that need changing },
  "new_value": { same keys with the new required values },
  "impact_severity": one of "critical" | "high" | "medium" | "low",
  "confidence": a number from 0.0 to 1.0
}

Critical rules:
- Return ONLY a valid JSON array — no markdown, no explanation, no preamble
- Do NOT invent or hallucinate changes — only report what the scraped content explicitly states
- Only include items where confidence >= 0.6
- If nothing relevant is found, return exactly: []`;

// ── Firecrawl scraper ─────────────────────────────────────────────────────────
async function scrapeFirecrawl(url) {
  const res = await axios.post(
    'https://api.firecrawl.dev/v1/scrape',
    { url, formats: ['markdown'], onlyMainContent: true, timeout: 25000 },
    { headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  if (!res.data?.success) throw new Error(res.data?.error || 'Firecrawl: success=false');
  return res.data?.data?.markdown || '';
}

// ── Direct HTTP scraper ───────────────────────────────────────────────────────
async function scrapeDirectly(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    maxRedirects: 5,
  });
  return (res.data || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{3,}/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim()
    .substring(0, 8000);
}

// ── Smart scraper: tries Firecrawl, falls back to direct ─────────────────────
let firecrawlOK = null; // null=untested, true=working, false=broken

async function scrape(fcSource, directSource) {
  // Try Firecrawl on the deep URL first
  if (FIRECRAWL_KEY && firecrawlOK !== false) {
    try {
      const content = await scrapeFirecrawl(fcSource.url);
      firecrawlOK = true;
      process.stderr.write(`  [FC ✓] ${fcSource.label}: ${content.length} chars\n`);
      return { content, method: 'firecrawl', source: fcSource };
    } catch (err) {
      if (err.message.includes('Unauthorized') || err.message.includes('Invalid token') || err.message.includes('401')) {
        firecrawlOK = false;
        process.stderr.write(`  [FC ✗] Key invalid — switching to direct fetch for all sources\n`);
      } else {
        process.stderr.write(`  [FC ✗] ${err.message}\n`);
      }
    }
  }
  // Fall back to homepage direct fetch
  try {
    const content = await scrapeDirectly(directSource.url);
    process.stderr.write(`  [Direct ✓] ${directSource.label}: ${content.length} chars\n`);
    return { content, method: 'direct', source: directSource };
  } catch (err) {
    process.stderr.write(`  [Direct ✗] ${directSource.label}: ${err.message}\n`);
    return { content: '', method: 'failed', source: directSource };
  }
}

// ── Groq AI analysis ──────────────────────────────────────────────────────────
async function analyse(content, source) {
  if (!content || content.length < 100) return [];

  const userPrompt = `SOURCE: ${source.label} (category: ${source.category})
URL: ${source.url}

SCRAPED CONTENT:
${content.substring(0, 5000)}

CURRENT HRMS PAYROLL CONFIG:
${JSON.stringify(CURRENT_CONFIG, null, 2)}

Return JSON array of compliance changes needed. Return [] if nothing found.`;

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2048,
      },
      { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const text = res.data.choices[0].message.content.trim();
    // Robust JSON extraction — handles models that wrap in markdown code blocks
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter(c => (c.confidence || 0) >= 0.6) : [];
  } catch (err) {
    process.stderr.write(`  [Groq ✗] ${err.message}\n`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const results = {
    scan_date: new Date().toISOString(),
    scrape_method: 'detecting',
    sources_scanned: [],
    all_changes: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  };

  for (let i = 0; i < DIRECT_SOURCES.length; i++) {
    const fcSource = FC_SOURCES[i] || DIRECT_SOURCES[i];
    const directSource = DIRECT_SOURCES[i];

    process.stderr.write(`\nScanning [${i + 1}/${DIRECT_SOURCES.length}]: ${fcSource.label}\n`);

    const { content, method, source } = await scrape(fcSource, directSource);
    const changes = await analyse(content, source);

    results.sources_scanned.push({
      label: source.label,
      category: source.category,
      method,
      content_length: content.length,
      changes_found: changes.length,
    });

    for (const change of changes) {
      change.source = source.label;
      change.source_category = source.category;
      results.all_changes.push(change);
      const sev = change.impact_severity || 'low';
      if (results.summary[sev] !== undefined) results.summary[sev]++;
      results.summary.total++;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  results.scrape_method = firecrawlOK ? 'firecrawl' : 'direct_fetch';
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});

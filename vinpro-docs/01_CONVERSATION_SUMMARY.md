# Conversation Summary — Vinpro HRMS Phase 10 + Phase 12
## AI Payroll Compliance Agent — Labour Law + Income Tax
**Date:** 2026-05-19 to 2026-05-21  
**Sessions covered:** Sessions 1–5

---

## 📌 What Was Built

### The Goal
An AI agent that:
1. **Scrapes** Indian government portals (labour law AND Income Tax Department) for regulatory updates
2. **Analyses** changes against the current HRMS payroll configuration using a free LLM (Groq)
3. **Flags** compliance gaps with severity levels (`critical` / `high` / `medium` / `low`)
4. **Routes changes for super admin approval** before applying them to HRMS
5. **Supports upgrading** the AI from Groq (free) → GPT-4o or Claude (paid) without code changes

### Scope: Two Regulatory Domains

| Domain | What It Monitors |
|--------|-----------------|
| **Labour Law** | PF/EPF rates + wage ceiling, ESI rates + ceiling, Professional Tax (state-wise), Minimum Wages (TN/MH/KA/DL), Gratuity formula, Bonus Act, Maternity Benefit, Labour Welfare Fund |
| **Income Tax / TDS** | Section 192 (TDS on salary), standard deduction (Sec 16), regime slab changes (old + new), Section 10 exemptions (HRA/LTA), Chapter VI-A ceilings (80C/80D/80G), perquisite valuation, Form 16 format, Finance Bill/Budget announcements |

---

## 🏗️ Architecture

```
Firecrawl (scraper)
    ↓
Official govt portals — Labour Law + IT Dept + Budget
    ↓
Raw content → Groq Llama 3.3 70B (analyser)
    ↓
Structured compliance_change records (PostgreSQL)
    ↓
Super Admin Dashboard (React) — Approve / Reject
    ↓
HRMS payroll config updated (only after approval)
    ↓
Full audit trail in DB
```

---

## 🔧 Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Scraper | Firecrawl | Handles JS-rendered govt sites, returns clean markdown |
| LLM | Groq Llama 3.3 70B | Free, fast, good reasoning |
| LLM fallback | OpenAI GPT-4o / Claude 3.5 | Future upgrade, switchable via env var + dashboard UI |
| DB | PostgreSQL | Existing HRMS DB — 3 new tables added |
| Scheduling | Every Monday 6:00 AM IST | Weekly cadence balances freshness vs. cost |
| Approval flow | Super admin must approve before any config change | Safety requirement |
| Confidence threshold | ≥ 0.6 | Filters out hallucinated/uncertain changes |

---

## 📡 Sources Being Monitored (16 sources)

### Labour Law (7 sources)
| Source | Category | Status |
|--------|----------|--------|
| Ministry of Labour — News | `central` | ✅ |
| Ministry of Labour — Notifications | `central` | ✅ |
| EPFO Circulars | `pf` | ⚠️ Blocks scrapers |
| ESIC Circulars | `esi` | ✅ |
| India Code — Labour Laws | `central` | ✅ |
| Tamil Nadu Labour Dept | `state_tn` | ✅ |
| Maharashtra Labour Dept | `state_mh` | ✅ |
| Karnataka Labour Dept | `state_ka` | ✅ |
| Delhi Labour Dept | `state_dl` | ✅ |

### Income Tax / TDS (5 sources — new in Phase 12)
| Source | Category | What It Catches |
|--------|----------|-----------------|
| IT Dept — Press Releases | `it_press` | Budget announcements, regime changes |
| IT Dept — Notifications (Sec 192/TDS) | `it_notifications` | TDS circular, Section 192 updates |
| IT Dept — Circulars | `it_circulars` | Employer TDS obligations |
| Income Tax Act (Sec 10/16/17/80C/D/G/192) | `it_act` | Act amendments |
| Union Budget / Finance Bill | `finance_bill` | Annual slab + deduction ceiling changes |

> EPFO portal blocks all external HTTP — accepted known limitation.

---

## ⚙️ Compliance Config Baseline (Phase 12 — as at 2026-05-21)

### Labour Law
```json
{
  "pf_employee_rate": 12,
  "pf_employer_rate": 12,
  "pf_wage_ceiling": 15000,
  "esi_employee_rate": 0.75,
  "esi_employer_rate": 3.25,
  "esi_wage_ceiling": 21000,
  "professional_tax_states": ["TN", "MH", "KA", "DL"],
  "minimum_wages": { "TN": 8660, "MH": 12655, "KA": 10870, "DL": 17494 },
  "gratuity_formula": "15/26",
  "gratuity_eligibility_years": 5,
  "bonus_act_ceiling": 21000,
  "maternity_benefit_weeks": 26
}
```

### Income Tax / TDS (Section 192 baseline — FY 2023-24 starting point)
> **Note:** The baseline intentionally stores older values so the agent can detect when live law has moved ahead.  
> For example, `tds_standard_deduction: 50000` is the old value — Budget 2024 raised it to ₹75,000 for new regime.  
> When the agent scrapes the IT portal and finds the new value, it flags a `tds_standard_deduction` change with `impact_severity: high`.

```json
{
  "tds_standard_deduction": 50000,
  "tds_regime_default": "new",
  "tds_old_regime_slabs": [
    { "from": 0,       "to": 250000,  "rate": 0  },
    { "from": 250001,  "to": 500000,  "rate": 5  },
    { "from": 500001,  "to": 1000000, "rate": 20 },
    { "from": 1000001, "to": null,    "rate": 30 }
  ],
  "tds_new_regime_slabs": [
    { "from": 0,       "to": 300000,  "rate": 0  },
    { "from": 300001,  "to": 600000,  "rate": 5  },
    { "from": 600001,  "to": 900000,  "rate": 10 },
    { "from": 900001,  "to": 1200000, "rate": 15 },
    { "from": 1200001, "to": 1500000, "rate": 20 },
    { "from": 1500001, "to": null,    "rate": 30 }
  ],
  "tds_section_80c_ceiling": 150000,
  "tds_section_80d_self": 25000,
  "tds_section_80d_senior_parent": 50000,
  "tds_hra_metro_pct": 50,
  "tds_hra_nonmetro_pct": 40,
  "tds_lta_exemption_enabled": true,
  "tds_new_regime_rebate_ceiling": 700000,
  "tds_surcharge_threshold": 5000000
}
```

**Status:** ✅ No compliance gaps detected as of 2026-05-19 scan (labour law only — IT scan starts with Phase 12 deploy).

---

## 🧩 Affected Module Values (complete list)

### Labour Law Modules
| Module | What It Covers |
|--------|---------------|
| `pf` | PF/EPF rate or wage ceiling |
| `esi` | ESI rate or wage ceiling |
| `professional_tax` | PT rates (state-specific) |
| `minimum_wage` | Minimum wage revisions |
| `gratuity` | Gratuity formula / eligibility |
| `bonus` | Bonus Act ceiling |
| `maternity` | Maternity Benefit Act |
| `labour_welfare_fund` | LWF rate / applicability |
| `payroll_settings` | General payroll config |

### Income Tax / TDS Modules (new — Phase 12)
| Module | What It Covers |
|--------|---------------|
| `tds_slab` | Slab rate changes (either regime) |
| `tds_standard_deduction` | Section 16(ia) standard deduction limit |
| `tds_section_10` | HRA (10(13A)), LTA (10(5)), other Sec 10 exemptions |
| `tds_section_80c` | 80C ceiling: PF, PPF, LIC, ELSS, tuition, home loan principal |
| `tds_section_80d` | Medical insurance premium deduction |
| `tds_section_80g` | Charitable donation deductions |
| `tds_perquisites` | Perquisite valuation: car, ESOP, rent-free accommodation |
| `tds_form16` | Form 16 Part A / Part B structural changes |
| `tds_new_regime` | New regime slab, rebate ceiling, std deduction |
| `tds_old_regime` | Old regime specific changes |
| `tds_declaration_window` | IT declaration / POI submission window dates |

---

## 💡 Why This Matters — Practical Example

When the Finance Minister changes the standard deduction from ₹50,000 → ₹75,000 (Budget 2024), or changes the new regime rebate ceiling from ₹7L → ₹12L (Budget 2025):

1. **Weekly scrape** picks up the IT Dept notification or Finance Bill announcement
2. **LLM analysis** compares against baseline config — detects the delta
3. **Flags as** `affected_module: tds_standard_deduction`, `impact_severity: high`
4. **Super admin approves** → HRMS config patched via `/api/employer/payroll/settings/tds`
5. **Next payroll run** computes TDS with the correct deduction

Without this agent, the change would sit undetected until a payroll error surfaced.

---

## 📅 Automation

- **Name:** Vinpro Weekly Payroll Compliance Scan
- **Schedule:** Every Monday, 6:00 AM IST (00:30 UTC)
- **Platform:** Base44 Superagent automation
- **What it does:** Runs compliance-scan skill → Groq analyses → severity-grouped report to Visesh
- **Status:** ✅ Live (labour law); IT law sources activate on Phase 12 backend deploy

---

## 📂 Files (Phase 12 state)

### Backend
- `compliance-agent.js` — Full Express router:
  - 16 scrape sources (9 labour + 5 IT + 2 central)
  - Expanded SYSTEM_PROMPT with IT-specific module guidance and severity rules
  - `fetchCurrentHRMSConfig()` — extended with full IT/TDS baseline config
  - `applyChangeToHRMS()` — 20 module-to-endpoint mappings (9 labour + 11 IT)
- `compliance-db-schema.sql` — PostgreSQL schema with CHECK constraints on:
  - `affected_module` — all 20 valid module values
  - `change_type` — 8 valid values including new `slab_change` and `regime_change`
  - `impact_severity` — critical/high/medium/low
  - Includes migration `DO $$` block for adding constraints to existing tables
- `package-additions.json` — `axios`, `pg` dependencies (unchanged)

### Frontend
- `ComplianceDashboard.jsx` — React dashboard (unchanged from Phase 10)
  - Summary cards, filter bar, approve/reject modal, LLM provider switcher
  - Module filter now exposes all 20 module values

### Wiring Docs (unchanged from Phase 10)
- `1_App.jsx.patch.md`, `2_apiJson_helper.js`, `3_server.js.patch.md`, `4_sidebar_example.jsx`

---

## 🔜 Next Steps

- [ ] Deploy Phase 12 backend to VPS (`/var/www/vinpro-hrms-api/`)
- [ ] Run DB migration (`compliance-db-schema.sql`) on production PostgreSQL
- [ ] Test IT portal scrapes end-to-end (Firecrawl against IT Dept + Budget sites)
- [ ] Wire compliance agent into HRMS frontend (see `04_WIRING_CHECKLIST.md`)
- [ ] (Optional) Add OPENAI_API_KEY or ANTHROPIC_API_KEY when ready to upgrade AI
- [ ] (Optional) Slack/email notification when `critical` or `high` changes are detected

---

## 🗒️ Key Constraints (unchanged)

- **Never auto-apply changes** — super admin approval is mandatory before any HRMS config is touched
- **EPFO portal** blocks all external HTTP — known limitation, no fix needed
- **Confidence threshold:** ≥ 0.6 — lower confidence changes are silently discarded
- **IT scan scope:** Only FY 2024-25 onwards — earlier finance acts are considered baseline
- **Separate from hrms_kiro:** This repo (`HRMS-Ai-Agent`) stays standalone until wiring is done

# Vinpro HRMS — AI Labour Law Compliance Agent
## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLIANCE AGENT PIPELINE                     │
│                                                                 │
│  1. SCRAPER (Firecrawl)                                         │
│     └── Scrapes: IndiaCode, MinistryOfLabour, StatePortals,     │
│         IndianKanoon, EPF portal, ESIC, IT Dept                 │
│                 │                                               │
│                 ▼                                               │
│  2. RAW UPDATES DB (compliance_raw_updates table)               │
│     └── Stores raw scraped content + metadata                   │
│                 │                                               │
│                 ▼                                               │
│  3. AI ANALYSER (Groq Llama / swappable)                        │
│     └── Reads current payroll config from HRMS backend          │
│     └── Compares with new law, identifies what changed          │
│     └── Generates structured compliance_change record           │
│                 │                                               │
│                 ▼                                               │
│  4. COMPLIANCE CHANGES DB (compliance_changes table)            │
│     └── status: pending_review | approved | rejected            │
│     └── Holds: change_type, affected_module, old_value,         │
│         new_value, law_reference, state, effective_date         │
│                 │                                               │
│                 ▼                                               │
│  5. SUPER ADMIN DASHBOARD (React UI)                            │
│     └── Reviews AI-generated changes                            │
│     └── Approve → triggers PUT /api/compliance/apply/:id        │
│     └── Reject → marks rejected with reason                     │
│                 │                                               │
│                 ▼                                               │
│  6. APPLY ENGINE                                                │
│     └── Patches your existing payroll config/settings API       │
│     └── Records audit trail                                     │
└─────────────────────────────────────────────────────────────────┘
```

### AI Provider Abstraction
The LLM provider is configured via env var `LLM_PROVIDER`:
- `groq` → Groq Llama 3 (free, default)
- `openai` → GPT-4o
- `anthropic` → Claude 3.5 Sonnet

### Scrape Sources (India Labour Law)
- https://labour.gov.in/
- https://www.indiacode.nic.in/
- https://www.epfindia.gov.in/
- https://www.esic.in/
- https://incometaxindia.gov.in/
- State labour department portals (Maharashtra, Tamil Nadu, Karnataka, etc.)
- https://indiankanoon.org/ (judgments + notifications)

### Scheduling
- Scrape + Analyse: Weekly (every Monday 6am IST)
- Can also trigger manually from admin dashboard

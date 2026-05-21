# Vinpro HRMS — Compliance Agent Integration Guide

## Step 1: Get Your API Keys

### Firecrawl (Free tier available)
1. Go to https://firecrawl.dev
2. Sign up → Dashboard → API Keys
3. Free tier: 500 pages/month (enough for weekly scans)
4. Copy your API key

### Groq (Free, no credit card)
1. Go to https://console.groq.com
2. Sign up → API Keys → Create new key
3. Free tier: generous limits for Llama 3.3 70B
4. Copy your API key

### Future upgrades (optional)
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/

---

## Step 2: Add to Your Backend

### Install dependencies
```bash
npm install axios pg
```

### Register the compliance routes in your main Express app
```js
// In your main app.js / server.js
const complianceRouter = require('./compliance-agent');
app.use('/api', complianceRouter);
// This exposes: /api/compliance/... routes
```

### Add environment variables
```env
FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
LLM_PROVIDER=groq
HRMS_INTERNAL_TOKEN=your-existing-service-token
DB_URL=postgresql://user:password@host:5432/vinpro_hrms
# Optional (for future upgrade):
# OPENAI_API_KEY=sk-xxxxxxx
# ANTHROPIC_API_KEY=sk-ant-xxxxxxx
```

---

## Step 3: Run the Database Migration
```bash
psql $DB_URL -f compliance-db-schema.sql
```

---

## Step 4: Add Frontend Component

```jsx
// In your existing HRMS React app, add a new route:
// src/App.jsx — inside your router/view switch

import ComplianceDashboard from './components/ComplianceDashboard';
import { apiJson } from './api/liveClient';

// In your view switch (where you render different pages):
case 'compliance':
  return (
    <ComplianceDashboard 
      apiJson={apiJson}
      authToken={getToken()}
    />
  );

// In your sidebar navigation (admin-only):
{ role === 'super_admin' && (
  <NavItem 
    icon="⚖️" 
    label="Compliance Agent" 
    onClick={() => setView('compliance')}
  />
)}
```

---

## Step 5: Set Up Weekly Automation

Add this to your cron scheduler (or use pm2-cron / node-cron):

```js
// In your server.js
const cron = require('node-cron');
const { runCompliancePipeline } = require('./compliance-agent');

// Every Monday at 6:00 AM IST (UTC+5:30 = 00:30 UTC)
cron.schedule('30 0 * * 1', () => {
  console.log('[CRON] Running weekly compliance scan...');
  runCompliancePipeline().catch(console.error);
});
```

Or install node-cron:
```bash
npm install node-cron
```

---

## How the Approval Flow Works

```
1. Compliance pipeline runs (weekly or manual)
   └── Firecrawl scrapes 11 official sources
   └── Groq Llama analyses each source vs. your config
   └── Changes saved as "pending_review"

2. Super admin gets changes in dashboard
   └── Each card shows: What changed, Which law, Old vs. New values
   └── Severity: Critical / High / Medium / Low
   
3. Super admin reviews each change:
   APPROVE → HRMS config updated via API automatically
   REJECT  → Marked rejected with reason, no changes made

4. Full audit trail maintained in DB
```

---

## Switching AI Provider (Zero Downtime)

From the dashboard → click "🤖 Groq Llama 3.3" button → select new provider.

Or via API:
```bash
curl -X POST https://hrms.vinproconnect.com/api/compliance/provider \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai"}'
```

Providers: `groq` | `openai` | `anthropic`

---

## What the Agent Monitors

| Source | Category | What It Checks |
|--------|----------|----------------|
| Ministry of Labour | Central | Wage Code, Labour Code updates |
| EPFO Circulars | PF | PF rate changes, wage ceiling, new rules |
| ESIC Circulars | ESI | ESI rate changes, wage ceiling |
| Income Tax Dept | TDS | Section 192 changes, new regime updates |
| Tamil Nadu Labour | State | Professional Tax, Minimum Wages TN |
| Maharashtra Labour | State | PT slab changes, MW notifications |
| Karnataka Labour | State | Minimum wage revisions |
| Delhi Labour | State | MW notifications |
| India Code | Central | New Acts, Amendments |

---

## Compliance Areas Covered

- ✅ PF / EPF rate changes and wage ceiling
- ✅ ESI rate and ceiling changes  
- ✅ TDS slab updates (new vs. old regime)
- ✅ Professional Tax state-wise changes
- ✅ Minimum Wage revisions (state-wise)
- ✅ Gratuity formula / eligibility changes
- ✅ Bonus Act ceiling updates
- ✅ Maternity benefit changes
- ✅ Labour Welfare Fund revisions
- ✅ New compliance requirements (forms, filings)

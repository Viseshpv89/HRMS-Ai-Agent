# Vinpro HRMS — Compliance Agent Wiring Checklist
## Everything you need to integrate into your live platform

---

## 📁 Files in this package

```
vinpro-compliance-agent/
├── WIRING_CHECKLIST.md          ← you are here
├── INTEGRATION_GUIDE.md         ← detailed reference
├── ARCHITECTURE.md              ← system design overview
│
├── backend/
│   ├── compliance-agent.js      ← drop into your backend folder
│   ├── compliance-db-schema.sql ← run once against your PostgreSQL DB
│   └── package-additions.json   ← npm packages to install
│
├── frontend/
│   ├── ComplianceDashboard.jsx  ← drop into src/components/
│   └── wiring/
│       ├── 1_App.jsx.patch.md       ← what to change in App.jsx
│       ├── 2_apiJson_helper.js      ← apiJson helper (if you need it)
│       ├── 3_server.js.patch.md     ← what to change in server.js
│       └── 4_sidebar_example.jsx    ← sidebar nav item reference
```

---

## ✅ BACKEND CHECKLIST

### [ ] 1. Copy backend file
```
compliance-agent.js → your-backend-folder/compliance-agent.js
```

### [ ] 2. Install dependencies
```bash
npm install axios pg
```

### [ ] 3. Register routes in server.js / app.js
```js
const complianceRouter = require('./compliance-agent');
app.use('/api', complianceRouter);
```
See `wiring/3_server.js.patch.md` for details.

### [ ] 4. Add environment variables to .env
```env
FIRECRAWL_API_KEY=fc-65f60aaed17d4a7aa4973bd10070b638
GROQ_API_KEY=<your groq key>
LLM_PROVIDER=groq
DB_URL=<your existing postgres connection string>
```
> ⚠️ You already have DB_URL set up for your existing app — use the same one.

### [ ] 5. Run DB migration (one-time)
```bash
psql $DATABASE_URL -f compliance-db-schema.sql
```
Creates 3 new tables. Does NOT touch existing tables.

### [ ] 6. Test the API
```bash
# Should return { changes: [], total: 0, pending: 0 }
curl https://hrms.vinproconnect.com/api/compliance/changes \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN"
```

---

## ✅ FRONTEND CHECKLIST

### [ ] 7. Copy dashboard component
```
ComplianceDashboard.jsx → src/components/ComplianceDashboard.jsx
```

### [ ] 8. Add import to App.jsx
```jsx
import ComplianceDashboard from './components/ComplianceDashboard';
```

### [ ] 9. Add view render in App.jsx
```jsx
{currentView === 'compliance' && (
  <ComplianceDashboard
    apiJson={apiJson}
    authToken={token || localStorage.getItem('token')}
  />
)}
```
See `wiring/1_App.jsx.patch.md` for the exact location.

### [ ] 10. Add sidebar nav item (super admin only)
```jsx
{isSuperAdmin && (
  <NavItem icon="⚖️" label="Compliance Agent" view="compliance" ... />
)}
```
See `wiring/4_sidebar_example.jsx` for the pattern.

### [ ] 11. Build and test
```bash
yarn build   # or npm run build
```

---

## ✅ VERIFY IT'S WORKING

### [ ] 12. Login as super admin → see "⚖️ Compliance Agent" in sidebar
### [ ] 13. Click it → dashboard loads with 4 summary cards
### [ ] 14. Click "▶ Run Compliance Scan" → pipeline triggers, toast appears
### [ ] 15. Wait ~5 mins → refresh → any detected changes appear as cards
### [ ] 16. Click a change card → review modal → Approve / Reject works

---

## 🤖 AI Provider Upgrade Path

When you're ready to upgrade from free Groq to GPT-4o or Claude:

1. Get API key from OpenAI or Anthropic
2. Add to .env: `OPENAI_API_KEY=sk-...` or `ANTHROPIC_API_KEY=sk-ant-...`
3. In the dashboard → click the AI provider button (top right) → switch provider
4. No code changes needed. Zero downtime.

---

## 📅 Weekly Auto-Scan

Already set up in your Superagent (Base44) — runs **every Monday 6:00 AM IST**.
You'll receive a compliance report automatically in your chat.

The manual "▶ Run Compliance Scan" button in the dashboard also triggers it on-demand.

---

## 🆘 Troubleshooting

| Issue | Fix |
|-------|-----|
| "Compliance Agent" not in sidebar | Check role check — must be `super_admin` |
| API 401 errors | Check Authorization header is being sent with JWT |
| DB migration fails | Check DB_URL is correct, user has CREATE TABLE permission |
| Firecrawl errors | Key is `fc-65f60aaed17d4a7aa4973bd10070b638` — confirmed working |
| Groq errors | Add `GROQ_API_KEY` to your server .env |
| No changes detected | Normal — means your config is compliant. Run again next week. |

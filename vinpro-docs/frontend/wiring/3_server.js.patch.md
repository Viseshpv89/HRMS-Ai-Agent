# Patch: your backend server.js (or app.js)
## What to do: Register the compliance routes

---

### STEP 1 — Copy backend file

Copy `vinpro-compliance-agent/backend/compliance-agent.js` into your backend folder:
```
backend/
  compliance-agent.js   ← drop it here
  server.js             ← patch this
```

---

### STEP 2 — Install new dependencies

```bash
npm install axios pg
```

Your package.json additions (from `backend/package-additions.json`):
```json
"axios": "^1.6.0",
"pg": "^8.11.0"
```

---

### STEP 3 — Register routes in server.js / app.js

Add these lines near the top with your other requires:
```js
const complianceRouter = require('./compliance-agent');
```

Then add the route (after your existing `app.use(...)` lines):
```js
// AI Compliance Agent routes — super admin only
app.use('/api', complianceRouter);
```

This exposes:
- POST /api/compliance/scrape-and-analyse
- GET  /api/compliance/changes
- POST /api/compliance/changes/:id/approve
- POST /api/compliance/changes/:id/reject
- GET  /api/compliance/provider
- POST /api/compliance/provider

---

### STEP 4 — Add environment variables

In your `.env` file (or hosting platform env config):
```env
FIRECRAWL_API_KEY=fc-65f60aaed17d4a7aa4973bd10070b638
GROQ_API_KEY=gsk_o10b...          # your Groq key
LLM_PROVIDER=groq

# Optional — for future AI provider upgrade:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

---

### STEP 5 — Run the DB migration

```bash
psql $DATABASE_URL -f compliance-db-schema.sql
```

Or if using a GUI (TablePlus, DBeaver, pgAdmin), open `compliance-db-schema.sql` and run it.

This creates 3 tables:
- `compliance_raw_updates` — stores scraped content
- `compliance_changes` — AI-detected changes (pending/approved/rejected)
- `compliance_audit_log` — full action history

---

### STEP 6 — Middleware check

Make sure your compliance routes have the `isSuperAdmin` middleware applied.
The compliance-agent.js already uses `req.headers.authorization` — your existing JWT middleware should handle this automatically if it's registered before the compliance router.

If your middleware is named differently (e.g. `authenticate`, `verifyToken`), add it like:
```js
app.use('/api/compliance', authenticate, complianceRouter);
```

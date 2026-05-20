# Vinpro HRMS — AI Compliance Agent
## Complete Project Documentation Package
**Generated:** 2026-05-20  
**Project:** HRMS + Payroll Platform — https://hrms.vinproconnect.com/  
**Director:** Visesh PV, Vinpro Global Services Pvt Ltd, Chennai  
**Phase:** Phase 10 — AI Labour Law Compliance Agent

---

## 📁 Folder Structure

```
vinpro-docs/
│
├── 00_README.md                    ← this file
├── 01_CONVERSATION_SUMMARY.md      ← full chat summary + decisions made
├── 02_ARCHITECTURE.md              ← system design & data flow
├── 03_INTEGRATION_GUIDE.md         ← step-by-step setup guide
├── 04_WIRING_CHECKLIST.md          ← tick-by-tick deployment checklist
│
├── backend/
│   ├── compliance-agent.js         ← Express router (drop into backend/)
│   ├── compliance-db-schema.sql    ← PostgreSQL migration (run once)
│   └── package-additions.json      ← npm deps to add
│
├── frontend/
│   ├── ComplianceDashboard.jsx     ← React dashboard (drop into src/components/)
│   └── wiring/
│       ├── 1_App.jsx.patch.md      ← App.jsx changes
│       ├── 2_apiJson_helper.js     ← API fetch helper
│       ├── 3_server.js.patch.md    ← server.js changes
│       └── 4_sidebar_example.jsx   ← sidebar nav reference
│
└── agent/
    └── compliance-scan.skill.js    ← Weekly auto-scan skill (Base44 Superagent)
```

---

## 🚀 Quick Start

1. Read `04_WIRING_CHECKLIST.md` — follow it top to bottom
2. Backend: 3 steps (copy file, run SQL, register routes)
3. Frontend: 3 steps (copy component, update App.jsx, add sidebar item)
4. Weekly scan: already running every **Monday 6:00 AM IST** via Superagent automation

---

## 🔑 API Keys (already configured in Superagent)

| Service | Key | Status |
|---------|-----|--------|
| Firecrawl | `fc-65f60aaed17d4a7aa4973bd10070b638` | ✅ Verified working |
| Groq Llama 3.3 70B | `gsk_o10b...` | ✅ Verified working |
| OpenAI GPT-4o | Not set | Optional — future upgrade |
| Anthropic Claude | Not set | Optional — future upgrade |

> ⚠️ Add `FIRECRAWL_API_KEY` and `GROQ_API_KEY` to your backend `.env` too.

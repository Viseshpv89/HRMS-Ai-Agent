-- Vinpro HRMS — Compliance Agent DB Schema
-- Run this on your existing PostgreSQL database

-- Raw scrape storage
CREATE TABLE IF NOT EXISTS compliance_raw_updates (
  id              SERIAL PRIMARY KEY,
  source_url      TEXT NOT NULL,
  source_label    TEXT NOT NULL,
  category        VARCHAR(50) NOT NULL,  -- central, pf, esi, tds, state_tn, state_mh, etc.
  raw_content     TEXT,
  scraped_at      TIMESTAMPTZ DEFAULT NOW(),
  scrape_status   VARCHAR(20) DEFAULT 'success'
);

-- AI-generated compliance changes (pending super admin review)
CREATE TABLE IF NOT EXISTS compliance_changes (
  id                SERIAL PRIMARY KEY,
  raw_update_id     INTEGER REFERENCES compliance_raw_updates(id),
  
  -- What changed
  change_type       VARCHAR(50) NOT NULL,  -- rate_change, ceiling_change, new_requirement, etc.
  affected_module   VARCHAR(50) NOT NULL,  -- pf, esi, tds, professional_tax, minimum_wage, etc.
  law_reference     TEXT,                  -- e.g. "EPFO Circular No. WSU/40/15/1/2024"
  state_applicable  VARCHAR(10) DEFAULT 'ALL',  -- ALL or state code (TN, MH, KA, DL...)
  effective_date    DATE,
  
  -- AI analysis
  summary           TEXT NOT NULL,         -- Plain English explanation
  old_value         JSONB,                 -- Current config values
  new_value         JSONB,                 -- Suggested new values
  impact_severity   VARCHAR(20) DEFAULT 'medium',  -- critical, high, medium, low
  confidence        DECIMAL(3,2),          -- AI confidence 0.0-1.0
  ai_provider       VARCHAR(20),           -- groq, openai, anthropic
  
  -- Workflow
  status            VARCHAR(30) DEFAULT 'pending_review',
  -- pending_review | approved | rejected | applied | apply_failed
  
  -- Super admin actions
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  rejected_by       TEXT,
  rejected_at       TIMESTAMPTZ,
  admin_notes       TEXT,
  
  -- Apply tracking
  applied_at        TIMESTAMPTZ,
  apply_status      VARCHAR(20),           -- success, failed
  apply_error       TEXT,
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail for all compliance actions
CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id              SERIAL PRIMARY KEY,
  change_id       INTEGER REFERENCES compliance_changes(id),
  action          VARCHAR(50) NOT NULL,    -- pipeline_run, approved, rejected, applied, provider_switched
  performed_by    TEXT,
  details         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compliance_changes_status ON compliance_changes(status);
CREATE INDEX IF NOT EXISTS idx_compliance_changes_module ON compliance_changes(affected_module);
CREATE INDEX IF NOT EXISTS idx_compliance_changes_severity ON compliance_changes(impact_severity);
CREATE INDEX IF NOT EXISTS idx_compliance_changes_created ON compliance_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_updates_scraped ON compliance_raw_updates(scraped_at DESC);

-- Useful views
CREATE OR REPLACE VIEW compliance_summary AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending_review') AS pending_review,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved,
  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
  COUNT(*) FILTER (WHERE status = 'pending_review' AND impact_severity = 'critical') AS critical_pending,
  COUNT(*) FILTER (WHERE status = 'pending_review' AND impact_severity = 'high') AS high_pending,
  MAX(created_at) AS last_update
FROM compliance_changes;

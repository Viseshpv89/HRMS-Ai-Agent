-- Vinpro HRMS — Compliance Agent DB Schema
-- Run this on your existing PostgreSQL database
-- Covers: Labour Law + Income Tax / TDS (Section 192) monitoring

-- Raw scrape storage
CREATE TABLE IF NOT EXISTS compliance_raw_updates (
  id              SERIAL PRIMARY KEY,
  source_url      TEXT NOT NULL,
  source_label    TEXT NOT NULL,
  -- category values: central | pf | esi | it_press | it_notifications |
  --                  it_circulars | it_act | finance_bill |
  --                  state_tn | state_mh | state_ka | state_dl
  category        VARCHAR(50) NOT NULL,
  raw_content     TEXT,
  scraped_at      TIMESTAMPTZ DEFAULT NOW(),
  scrape_status   VARCHAR(20) DEFAULT 'success'
);

-- AI-generated compliance changes (pending super admin review)
CREATE TABLE IF NOT EXISTS compliance_changes (
  id                SERIAL PRIMARY KEY,
  raw_update_id     INTEGER REFERENCES compliance_raw_updates(id),

  -- What changed
  -- change_type valid values:
  --   rate_change | ceiling_change | new_requirement | deadline_change |
  --   exemption_change | form_change | slab_change | regime_change
  change_type       VARCHAR(50) NOT NULL
    CONSTRAINT chk_change_type CHECK (change_type IN (
      'rate_change', 'ceiling_change', 'new_requirement', 'deadline_change',
      'exemption_change', 'form_change', 'slab_change', 'regime_change'
    )),

  -- affected_module valid values — LABOUR LAW:
  --   pf | esi | professional_tax | minimum_wage | gratuity |
  --   bonus | maternity | labour_welfare_fund | payroll_settings
  -- affected_module valid values — INCOME TAX / TDS (Section 192):
  --   tds_slab | tds_standard_deduction | tds_section_10 |
  --   tds_section_80c | tds_section_80d | tds_section_80g |
  --   tds_perquisites | tds_form16 | tds_new_regime |
  --   tds_old_regime | tds_declaration_window
  affected_module   VARCHAR(50) NOT NULL
    CONSTRAINT chk_affected_module CHECK (affected_module IN (
      -- Labour law
      'pf', 'esi', 'professional_tax', 'minimum_wage', 'gratuity',
      'bonus', 'maternity', 'labour_welfare_fund', 'payroll_settings',
      -- Income tax / TDS
      'tds_slab', 'tds_standard_deduction', 'tds_section_10',
      'tds_section_80c', 'tds_section_80d', 'tds_section_80g',
      'tds_perquisites', 'tds_form16', 'tds_new_regime',
      'tds_old_regime', 'tds_declaration_window'
    )),

  law_reference     TEXT,                  -- e.g. "Finance Act 2025 s.2(3)", "CBDT Circular No.04/2025"
  state_applicable  VARCHAR(10) DEFAULT 'ALL',  -- ALL or state code (TN, MH, KA, DL...)
  effective_date    DATE,

  -- AI analysis
  summary           TEXT NOT NULL,         -- Plain English explanation
  old_value         JSONB,                 -- Current config values being compared
  new_value         JSONB,                 -- Suggested new values after change
  impact_severity   VARCHAR(20) DEFAULT 'medium'
    CONSTRAINT chk_severity CHECK (impact_severity IN ('critical', 'high', 'medium', 'low')),
  confidence        DECIMAL(3,2),          -- AI confidence 0.0-1.0
  ai_provider       VARCHAR(20),           -- groq, openai, anthropic

  -- Workflow
  status            VARCHAR(30) DEFAULT 'pending_review'
    CONSTRAINT chk_status CHECK (status IN (
      'pending_review', 'approved', 'rejected', 'applied', 'apply_failed'
    )),

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

-- Migration: if table already exists without the check constraints, add them:
-- (Safe to run — ADD CONSTRAINT IF NOT EXISTS is PostgreSQL 9.6+)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_affected_module'
      AND table_name = 'compliance_changes'
  ) THEN
    ALTER TABLE compliance_changes
      ADD CONSTRAINT chk_affected_module CHECK (affected_module IN (
        'pf', 'esi', 'professional_tax', 'minimum_wage', 'gratuity',
        'bonus', 'maternity', 'labour_welfare_fund', 'payroll_settings',
        'tds_slab', 'tds_standard_deduction', 'tds_section_10',
        'tds_section_80c', 'tds_section_80d', 'tds_section_80g',
        'tds_perquisites', 'tds_form16', 'tds_new_regime',
        'tds_old_regime', 'tds_declaration_window'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_change_type'
      AND table_name = 'compliance_changes'
  ) THEN
    ALTER TABLE compliance_changes
      ADD CONSTRAINT chk_change_type CHECK (change_type IN (
        'rate_change', 'ceiling_change', 'new_requirement', 'deadline_change',
        'exemption_change', 'form_change', 'slab_change', 'regime_change'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_severity'
      AND table_name = 'compliance_changes'
  ) THEN
    ALTER TABLE compliance_changes
      ADD CONSTRAINT chk_severity CHECK (
        impact_severity IN ('critical', 'high', 'medium', 'low')
      );
  END IF;
END $$;

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

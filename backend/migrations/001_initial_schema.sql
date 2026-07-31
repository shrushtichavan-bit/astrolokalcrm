-- Initial schema for the generic Postgres backend.
--
-- Reconstructed from the final (current) state of the AstroLokal CRM's
-- Supabase schema under supabase/migrations/ — same 16 tables, same
-- columns, constraints and defaults. Deliberately NOT ported:
--   * Row Level Security / policies — that lockdown exists to keep
--     Supabase's PostgREST-exposed `anon`/`authenticated` roles out;
--     those roles don't exist on a plain Postgres cluster, and this
--     backend is the only thing that ever talks to this database, so
--     RLS has nothing to do here (and would break on a vanilla
--     Postgres image, which has no `anon`/`authenticated` roles to
--     reference).
--   * The `cleanup_old_audit_log()` retention function and its
--     Supabase-role REVOKE — same reason.
-- Kept: table/column/constraint shapes, and the generic `updated_at`
-- touch trigger (that's plain Postgres, not Supabase-specific).
--
-- This file is intentionally idempotent (IF NOT EXISTS / ON CONFLICT DO
-- NOTHING throughout) — migrate.js also tracks it in migrations_log so it
-- only ever runs once per database, but the SQL itself is safe to replay.

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'kam', 'lma', 'telecaller')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ---------- leads ----------
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  email TEXT,
  city TEXT,
  language TEXT,
  source TEXT,
  priority INTEGER NOT NULL DEFAULT 99,
  assigned_to_email TEXT,
  current_stage TEXT NOT NULL DEFAULT 'calling_pending',
  current_owner_email TEXT,
  lead_date DATE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads (lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_owner_stage_priority ON leads (current_owner_email, current_stage, priority);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads (current_stage);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads (priority);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_email ON leads (assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_leads_unassigned ON leads (assigned_to_email) WHERE assigned_to_email IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_date ON leads (lead_date);
CREATE INDEX IF NOT EXISTS idx_leads_closed_at ON leads (closed_at);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads (updated_at DESC);

-- ---------- call_attempts ----------
CREATE TABLE IF NOT EXISTS call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number IN (1, 2, 3)),
  connected BOOLEAN NOT NULL,
  outcome TEXT CHECK (outcome IN ('connected', 'rnr', 'reconnect', 'junk', 'not_interested')),
  attempted_by TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON call_attempts (lead_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_call_attempts_attempted_by ON call_attempts (attempted_by);

-- ---------- calling_status ----------
CREATE TABLE IF NOT EXISTS calling_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('connected', 'junk', 'not_interested', 'reconnect', 'rnr')),
  remarks TEXT,
  assigned_kam_email TEXT,
  set_by TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calling_status_lead ON calling_status (lead_id);

-- ---------- round_config ----------
CREATE TABLE IF NOT EXISTS round_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  num_rounds INTEGER NOT NULL CHECK (num_rounds BETWEEN 1 AND 4),
  rounds_required_for_verdict INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- round_passing_marks ----------
CREATE TABLE IF NOT EXISTS round_passing_marks (
  round_number INTEGER PRIMARY KEY CHECK (round_number BETWEEN 1 AND 4),
  passing_marks INTEGER NOT NULL
);

-- ---------- questions ----------
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  UNIQUE (round_number, question_id)
);
CREATE INDEX IF NOT EXISTS idx_questions_round ON questions (round_number, display_order);

-- ---------- interview_rounds ----------
CREATE TABLE IF NOT EXISTS interview_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  conducted_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  total_score INTEGER,
  passed BOOLEAN,
  remarks TEXT,
  next_owner_email TEXT,
  UNIQUE (lead_id, round_number)
);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_lead ON interview_rounds (lead_id, round_number);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_conducted_by ON interview_rounds (conducted_by) WHERE submitted_at IS NOT NULL;

-- ---------- question_grades ----------
CREATE TABLE IF NOT EXISTS question_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_round_id UUID NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_text_used TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_question_grades_round ON question_grades (interview_round_id);

-- ---------- expert_profiles ----------
CREATE TABLE IF NOT EXISTS expert_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  expert_id TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_lead ON expert_profiles (lead_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_expert_id ON expert_profiles (expert_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_linked_by ON expert_profiles (linked_by);

-- ---------- stage_pools ----------
CREATE TABLE IF NOT EXISTS stage_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL CHECK (stage IN ('calling', 'round_1', 'round_2', 'round_3', 'round_4', 'expert_creation')),
  eligible_email TEXT NOT NULL,
  UNIQUE (stage, eligible_email)
);
CREATE INDEX IF NOT EXISTS idx_stage_pools_stage ON stage_pools (stage);

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  metadata JSONB,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_time ON audit_log (lead_id, performed_at DESC);

-- ---------- source_priority_config ----------
CREATE TABLE IF NOT EXISTS source_priority_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT UNIQUE NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 99,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  form_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- lead_stage_assignments ----------
CREATE TABLE IF NOT EXISTS lead_stage_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('calling', 'round_1', 'round_2', 'round_3', 'round_4', 'expert_creation')),
  assigned_email TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_lead_stage_assignments_lead ON lead_stage_assignments (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_stage_assignments_email_stage ON lead_stage_assignments (assigned_email, stage);
CREATE INDEX IF NOT EXISTS idx_lead_stage_assignments_stage ON lead_stage_assignments (stage);

-- ---------- duplicate_log ----------
CREATE TABLE IF NOT EXISTS duplicate_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_name TEXT,
  incoming_contact TEXT NOT NULL,
  incoming_source TEXT,
  matched_lead_id UUID REFERENCES leads(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by TEXT NOT NULL,
  payload JSONB,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_lead_id UUID REFERENCES leads(id)
);
CREATE INDEX IF NOT EXISTS idx_duplicate_log_contact ON duplicate_log (incoming_contact);
CREATE INDEX IF NOT EXISTS idx_duplicate_log_matched_lead ON duplicate_log (matched_lead_id);

-- ---------- crm_settings ----------
CREATE TABLE IF NOT EXISTS crm_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cooldown_days INTEGER NOT NULL DEFAULT 60,
  default_chain JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO crm_settings (id, cooldown_days) VALUES (1, 60) ON CONFLICT (id) DO NOTHING;

-- ---------- generic updated_at trigger (plain Postgres, no Supabase dependency) ----------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_users_touch ON users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_leads_touch ON leads;
CREATE TRIGGER trg_leads_touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_source_priority_config_touch ON source_priority_config;
CREATE TRIGGER trg_source_priority_config_touch BEFORE UPDATE ON source_priority_config FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- seed: source → priority list (mirrors supabase/migrations seed) ----------
INSERT INTO source_priority_config (source_name, priority_score) VALUES
  ('Referral', 1),
  ('Vedic Vidya Institute', 1),
  ('OutBound Leads', 2),
  ('Website', 2),
  ('Instaastro', 2),
  ('CS ticket', 3),
  ('Institute Leads', 3),
  ('New Meta Leads', 4),
  ('Meta Ads', 5),
  ('Linkedin', 99),
  ('Apna jobs', 99)
ON CONFLICT (source_name) DO NOTHING;

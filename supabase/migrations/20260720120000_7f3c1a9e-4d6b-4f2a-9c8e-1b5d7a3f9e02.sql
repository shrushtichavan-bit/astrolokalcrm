-- Phase 1: schema foundation for moving config/intake/allotment off the sheet.

-- Source → priority auto-assignment config (admin-editable). Also serves as
-- the configurable "Source" dropdown list for the manual Add Lead form.
CREATE TABLE public.source_priority_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT UNIQUE NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 99,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_source_priority_config_touch BEFORE UPDATE ON public.source_priority_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Full chain: who's assigned at each stage for a specific lead, set upfront by
-- the admin at allotment time. 'calling' is included alongside the existing
-- round_1..4 / expert_creation stage set used by stage_pools.
CREATE TABLE public.lead_stage_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('calling','round_1','round_2','round_3','round_4','expert_creation')),
  assigned_email TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, stage)
);
CREATE INDEX idx_lsa_lead ON public.lead_stage_assignments(lead_id);
CREATE INDEX idx_lsa_email_stage ON public.lead_stage_assignments(assigned_email, stage);
CREATE INDEX idx_lsa_stage ON public.lead_stage_assignments(stage);

-- Duplicate detection log — records blocked leads from both the manual Add
-- Lead form and the sheet-based syncLeads path.
CREATE TABLE public.duplicate_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_name TEXT,
  incoming_contact TEXT NOT NULL,
  incoming_source TEXT,
  matched_lead_id UUID REFERENCES public.leads(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by TEXT NOT NULL
);
CREATE INDEX idx_duplicate_log_contact ON public.duplicate_log(incoming_contact);
CREATE INDEX idx_duplicate_log_matched_lead ON public.duplicate_log(matched_lead_id);

-- stage_pools previously only covered round_1..4 + expert_creation. The new
-- Telecaller/Calling allotment step needs 'calling' as a valid pool stage too.
ALTER TABLE public.stage_pools DROP CONSTRAINT IF EXISTS stage_pools_stage_check;
ALTER TABLE public.stage_pools ADD CONSTRAINT stage_pools_stage_check
  CHECK (stage IN ('calling','round_1','round_2','round_3','round_4','expert_creation'));

-- Lock everything down: same deny-all pattern as every other table — only
-- service_role (server, via supabaseAdmin) bypasses RLS. No policies created.
ALTER TABLE public.source_priority_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stage_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_log ENABLE ROW LEVEL SECURITY;

-- Seed the source → priority list from the current Astro_CRM source config.
INSERT INTO public.source_priority_config (source_name, priority_score) VALUES
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

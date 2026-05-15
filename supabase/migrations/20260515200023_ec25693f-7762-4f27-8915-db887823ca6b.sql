
-- Users (synced from sheet)
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('telecaller','kam','expert_creation_agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  source TEXT,
  priority INTEGER NOT NULL DEFAULT 99,
  assigned_to_email TEXT NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'calling_pending',
  current_owner_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leads_owner_stage ON public.leads(current_owner_email, current_stage, priority);
CREATE INDEX idx_leads_stage ON public.leads(current_stage);

CREATE TABLE public.call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number IN (1,2,3)),
  connected BOOLEAN NOT NULL,
  attempted_by TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, attempt_number)
);
CREATE INDEX idx_call_attempts_lead ON public.call_attempts(lead_id);

CREATE TABLE public.calling_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('connected','junk','not_interested','reconnect','rnr')),
  remarks TEXT,
  assigned_kam_email TEXT,
  set_by TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.round_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  num_rounds INTEGER NOT NULL CHECK (num_rounds BETWEEN 1 AND 4),
  rounds_required_for_verdict INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.round_passing_marks (
  round_number INTEGER PRIMARY KEY CHECK (round_number BETWEEN 1 AND 4),
  passing_marks INTEGER NOT NULL
);

CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  UNIQUE (round_number, question_id)
);
CREATE INDEX idx_questions_round ON public.questions(round_number, display_order);

CREATE TABLE public.interview_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
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

CREATE TABLE public.question_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_round_id UUID NOT NULL REFERENCES public.interview_rounds(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_text_used TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5)
);
CREATE INDEX idx_grades_round ON public.question_grades(interview_round_id);

CREATE TABLE public.expert_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  expert_id TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ
);
CREATE INDEX idx_expert_profiles_expert_id ON public.expert_profiles(expert_id);

CREATE TABLE public.stage_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL CHECK (stage IN ('round_1','round_2','round_3','round_4','expert_creation')),
  eligible_email TEXT NOT NULL,
  UNIQUE (stage, eligible_email)
);
CREATE INDEX idx_stage_pools_stage ON public.stage_pools(stage);

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  metadata JSONB,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_lead ON public.audit_log(lead_id, performed_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_leads_touch BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Lock everything down: only service role (server) reads/writes. No anon/authenticated grants.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calling_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_passing_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- No policies created → only service_role bypasses RLS and can access. anon/authenticated get nothing.

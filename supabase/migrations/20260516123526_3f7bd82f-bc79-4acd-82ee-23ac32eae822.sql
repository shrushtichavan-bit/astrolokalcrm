
-- Performance indexes for handling 10k+ leads

-- leads: most common filters
CREATE INDEX IF NOT EXISTS idx_leads_owner_priority_updated ON public.leads (current_owner_email, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads (assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads (current_stage);
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON public.leads (lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON public.leads (updated_at DESC);

-- call_attempts
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON public.call_attempts (lead_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_call_attempts_attempted_by ON public.call_attempts (attempted_by);

-- interview_rounds
CREATE INDEX IF NOT EXISTS idx_rounds_lead ON public.interview_rounds (lead_id, round_number);
CREATE INDEX IF NOT EXISTS idx_rounds_conducted_by ON public.interview_rounds (conducted_by) WHERE submitted_at IS NOT NULL;

-- expert_profiles
CREATE INDEX IF NOT EXISTS idx_expert_profiles_lead ON public.expert_profiles (lead_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_linked_by ON public.expert_profiles (linked_by);

-- calling_status
CREATE INDEX IF NOT EXISTS idx_calling_status_lead ON public.calling_status (lead_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_time ON public.audit_log (lead_id, performed_at DESC);

-- stage_pools
CREATE INDEX IF NOT EXISTS idx_stage_pools_stage ON public.stage_pools (stage);

-- question_grades
CREATE INDEX IF NOT EXISTS idx_question_grades_round ON public.question_grades (interview_round_id);

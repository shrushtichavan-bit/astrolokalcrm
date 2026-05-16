
-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_current_owner_email ON public.leads (current_owner_email);
CREATE INDEX IF NOT EXISTS idx_leads_current_stage ON public.leads (current_stage);
CREATE INDEX IF NOT EXISTS idx_leads_lead_date ON public.leads (lead_date);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON public.leads (priority);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_email ON public.leads (assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_leads_dashboard ON public.leads (current_owner_email, current_stage, priority, lead_date);
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON public.leads (lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON public.leads (updated_at);

CREATE INDEX IF NOT EXISTS idx_call_attempts_lead_id ON public.call_attempts (lead_id);
CREATE INDEX IF NOT EXISTS idx_calling_status_lead_id ON public.calling_status (lead_id);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_lead_id ON public.interview_rounds (lead_id);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_lead_round ON public.interview_rounds (lead_id, round_number);
CREATE INDEX IF NOT EXISTS idx_question_grades_round ON public.question_grades (interview_round_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_lead_id ON public.expert_profiles (lead_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_expert_id ON public.expert_profiles (expert_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_id ON public.audit_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON public.audit_log (performed_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- Audit log retention: delete entries older than 90 days
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.audit_log WHERE performed_at < now() - INTERVAL '90 days';
$$;

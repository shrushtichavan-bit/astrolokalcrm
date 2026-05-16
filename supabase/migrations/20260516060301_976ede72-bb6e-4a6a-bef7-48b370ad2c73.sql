
-- 1) Add outcome column to call_attempts
ALTER TABLE public.call_attempts
  ADD COLUMN IF NOT EXISTS outcome text;

-- Backfill: existing rows -> 'connected' if connected else 'rnr'
UPDATE public.call_attempts
SET outcome = CASE WHEN connected THEN 'connected' ELSE 'rnr' END
WHERE outcome IS NULL;

-- Constrain values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_attempts_outcome_chk'
  ) THEN
    ALTER TABLE public.call_attempts
      ADD CONSTRAINT call_attempts_outcome_chk
      CHECK (outcome IN ('connected','rnr','reconnect','junk','not_interested'));
  END IF;
END $$;

-- 2) Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_owner            ON public.leads(current_owner_email);
CREATE INDEX IF NOT EXISTS idx_leads_stage            ON public.leads(current_stage);
CREATE INDEX IF NOT EXISTS idx_leads_priority         ON public.leads(priority);
CREATE INDEX IF NOT EXISTS idx_leads_owner_stage_pri  ON public.leads(current_owner_email, current_stage, priority);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead     ON public.call_attempts(lead_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_lead  ON public.interview_rounds(lead_id, round_number);
CREATE INDEX IF NOT EXISTS idx_calling_status_lead    ON public.calling_status(lead_id);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_lead   ON public.expert_profiles(lead_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_time    ON public.audit_log(lead_id, performed_at DESC);

-- New routing model: admin only pre-assigns a telecaller (or leaves a lead
-- unassigned for later allotment). Every later stage's next-person is picked
-- just-in-time by whoever is working the lead, not pre-populated. That means
-- a lead can now legitimately have no telecaller yet, so these two columns
-- can no longer be NOT NULL.
ALTER TABLE public.leads ALTER COLUMN assigned_to_email DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN current_owner_email DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_unassigned ON public.leads(assigned_to_email) WHERE assigned_to_email IS NULL;

-- Smart dedup (cooldown-aware reuse of closed leads) + CSV bulk upload fields
-- + admin override for blocked duplicates.

-- Leads gain: closed_at (when the lead entered a terminal stage, used by the
-- dedup cooldown check) and email/city/language (captured by manual add +
-- CSV bulk upload, previously only name/contact/source/lead_date existed).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS language TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_closed_at ON public.leads(closed_at);

-- Site-wide settings singleton. Currently just the dedup cooldown, kept
-- separate from round_config since it's an unrelated concern.
CREATE TABLE IF NOT EXISTS public.crm_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cooldown_days INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.crm_settings (id, cooldown_days) VALUES (1, 60) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;

-- duplicate_log gains enough to let an admin force-allow a blocked duplicate
-- after the fact: the original submission payload, and resolution tracking.
ALTER TABLE public.duplicate_log ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE public.duplicate_log ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.duplicate_log ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.duplicate_log ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE public.duplicate_log ADD COLUMN IF NOT EXISTS resolved_lead_id UUID REFERENCES public.leads(id);

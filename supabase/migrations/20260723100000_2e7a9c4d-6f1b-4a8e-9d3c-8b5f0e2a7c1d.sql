-- Default stage-assignment chain, applied automatically to every new lead.
ALTER TABLE public.crm_settings ADD COLUMN IF NOT EXISTS default_chain JSONB;

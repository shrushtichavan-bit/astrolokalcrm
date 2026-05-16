ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'lma' WHERE role = 'telecaller';
UPDATE public.users SET role = 'sme' WHERE role = 'expert_creation_agent';
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['lma'::text, 'kam'::text, 'sme'::text, 'admin'::text]));
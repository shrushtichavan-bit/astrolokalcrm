-- Role model change: admin/lma/kam/sme -> admin/kam/lma/telecaller.
-- "lma" now means the round-taking + expert-creation role (previously
-- kam+sme combined); "telecaller" is the new calling-only role (what
-- "lma" used to mean). Nobody currently holds "sme", so it's simply
-- dropped. Order matters: migrate lma->telecaller BEFORE kam->lma, so
-- the second UPDATE can't accidentally catch rows the first one just
-- wrote.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'telecaller' WHERE role = 'lma';
UPDATE public.users SET role = 'lma' WHERE role = 'kam';
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['admin'::text, 'kam'::text, 'lma'::text, 'telecaller'::text]));

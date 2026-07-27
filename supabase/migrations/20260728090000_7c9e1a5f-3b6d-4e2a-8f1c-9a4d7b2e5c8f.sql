-- Store team member passwords in plain text so admins can view/edit them
-- directly from Admin > Team, per explicit request (accepted tradeoff:
-- password_hash stays as a bcrypt fallback for any account that hasn't
-- been re-saved since this column was added, since existing hashes can't
-- be reversed into their original plaintext).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password text;

/*
# Create signup_codes table for email verification

1. New Tables
- `signup_codes`: stores 6-digit verification codes for signup
  - `id` (uuid, primary key)
  - `email` (text, not null)
  - `code` (text, not null) - 6-digit code
  - `username` (text)
  - `phone` (text)
  - `password_hash` (text) - bcrypt hash of password
  - `expires_at` (timestamptz) - 10 minutes from creation
  - `used` (boolean, default false)
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `signup_codes`
- Allow anon to insert (for sending codes) and select (for verification)
- No update/delete from anon (edge function uses service role)
*/

CREATE TABLE IF NOT EXISTS public.signup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  username text,
  phone text,
  password_hash text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_codes_email ON public.signup_codes(email);
CREATE INDEX IF NOT EXISTS idx_signup_codes_code ON public.signup_codes(code);

ALTER TABLE public.signup_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_signup_codes" ON public.signup_codes;
CREATE POLICY "anon_insert_signup_codes"
ON public.signup_codes FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_select_signup_codes" ON public.signup_codes;
CREATE POLICY "anon_select_signup_codes"
ON public.signup_codes FOR SELECT
TO anon, authenticated USING (true);

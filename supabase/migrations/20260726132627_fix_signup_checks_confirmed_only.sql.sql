/*
# Fix signup duplicate checks to only consider confirmed users

## Problem
`check_phone_exists` checked `profiles` table — but the signup trigger
creates a profile row immediately when the auth user is created, even
before email confirmation. So if a user starts signup but never confirms
their email, their phone is "taken" and they can't retry.

`check_email_exists` checked all `auth.users` rows including unconfirmed
ones — same problem.

## Fix
- `check_email_exists`: only returns true if the user has `email_confirmed_at IS NOT NULL`
- `check_phone_exists`: only returns true if the profile's corresponding
  auth user has `email_confirmed_at IS NOT NULL`
- `delete_unconfirmed_user`: already only deletes unconfirmed users with
  no profile — updated to also delete the profile row if it exists, so
    phone/email can be reused after cleanup.
*/

CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = p_email
      AND email_confirmed_at IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_phone_exists(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.phone = p_phone
      AND u.email_confirmed_at IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_phone_exists(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_unconfirmed_user(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.profiles
  WHERE id IN (
    SELECT id FROM auth.users
    WHERE email = p_email
      AND email_confirmed_at IS NULL
  );

  DELETE FROM auth.users
  WHERE email = p_email
    AND email_confirmed_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_user(text) TO anon, authenticated;

/*
# Rebuild signup code verification flow

## Summary
Replaces the custom signup_codes table + Resend email flow with a simpler,
reliable approach that uses Supabase's built-in auth OTP system.

## Changes
1. Adds `delete_unconfirmed_user(p_email)` SECURITY DEFINER function so the
   edge function can clean up auto-created unconfirmed users before retrying
   signup (since `mailer_autoconfirm` is ON, signInWithOtp creates users
   immediately).
2. Drops the now-unused `signup_codes` table and its policies.

## Security
- `delete_unconfirmed_user` is SECURITY DEFINER, callable by anon role.
  It only deletes from auth.users when the user has no confirmed email
  and no profile row, so it cannot be used to delete real accounts.
*/

CREATE OR REPLACE FUNCTION public.delete_unconfirmed_user(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM auth.users
  WHERE email = p_email
    AND email_confirmed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.users.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_user(text) TO anon, authenticated;

DROP TABLE IF EXISTS public.signup_codes CASCADE;

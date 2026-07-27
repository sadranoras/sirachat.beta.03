/*
# Fix signup: clean up unconfirmed users by phone OR email

## Problem
The signup flow calls `delete_unconfirmed_user(p_email)` to clean up stale
unconfirmed accounts before retrying signup. But that function only matches
by EMAIL. If a previous unconfirmed attempt used the SAME PHONE but a
DIFFERENT email, the profile row with that phone is never cleaned up.

When `supabase.auth.signUp()` then runs, the `handle_new_user` trigger
inserts a new profile row with that phone — which hits the unique index
`profiles_phone_unique_idx` and throws a constraint violation. The user
sees a signup error even though their phone/email aren't used by any
CONFIRMED account.

## Fix
Rewrite `delete_unconfirmed_user` to accept an optional phone parameter
and delete unconfirmed auth users (and their profiles) that match by
email OR by phone. This ensures both the email slot and the phone slot
are free before a new signup attempt creates fresh rows.

## Security
- SECURITY DEFINER, callable by anon + authenticated (signup is pre-auth).
- Only deletes users where `email_confirmed_at IS NULL` — confirmed
  accounts are never touched.
*/

DROP FUNCTION IF EXISTS public.delete_unconfirmed_user(text);

CREATE OR REPLACE FUNCTION public.delete_unconfirmed_user(p_email text, p_phone text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  -- Collect IDs of unconfirmed users matching by email OR phone
  SELECT array_agg(u.id) INTO v_ids
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.email_confirmed_at IS NULL
    AND (
      u.email = p_email
      OR (p_phone IS NOT NULL AND p_phone <> '' AND p.phone = p_phone)
    );

  IF v_ids IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = ANY(v_ids);
    DELETE FROM auth.users WHERE id = ANY(v_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_user(text, text) TO anon, authenticated;

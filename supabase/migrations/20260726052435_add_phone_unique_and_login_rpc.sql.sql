/*
# Phone-based login + unique phone/email enforcement

## Summary
Switches login from email to phone number while keeping email as the underlying
Supabase auth identity. Adds a unique constraint on profiles.phone so a phone
number can only be registered once. Adds security-definer RPCs that let the
frontend log in by phone and check email/phone uniqueness before signup.

## Changes

### 1. Normalize empty-string phones to NULL
- Existing rows have phone = '' (empty string). Normalize to NULL so they
  don't conflict with the unique index and so "no phone" is consistently NULL.

### 2. profiles.phone unique constraint
- Partial unique index on phone WHERE phone IS NOT NULL.
- One phone number -> exactly one account.

### 3. RPC: get_email_by_phone(p_phone text)
- SECURITY DEFINER. Looks up the profiles row by phone, then reads the email
  from auth.users. Returns the email or NULL.
- Used by the login screen to translate a phone number into the email needed
  for supabase.auth.signInWithPassword.
- Granted to anon + authenticated (login screen is unauthenticated).

### 4. RPC: check_phone_exists(p_phone text) / check_email_exists(p_email text)
- Let the signup screen verify uniqueness BEFORE calling signUp, so we don't
  create orphaned auth.users rows.
- Both return boolean. Granted to anon + authenticated.
*/

-- ============ Normalize empty-string phones to NULL ============
UPDATE profiles SET phone = NULL WHERE phone = '';

-- ============ Unique phone (exclude NULL) ============
DROP INDEX IF EXISTS profiles_phone_unique_idx;
CREATE UNIQUE INDEX profiles_phone_unique_idx
  ON profiles (phone)
  WHERE phone IS NOT NULL;

-- ============ get_email_by_phone ============
DROP FUNCTION IF EXISTS get_email_by_phone(p_phone text);
CREATE OR REPLACE FUNCTION get_email_by_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE phone = p_phone LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id LIMIT 1;
  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION get_email_by_phone(text) TO anon, authenticated;

-- ============ check_phone_exists ============
DROP FUNCTION IF EXISTS check_phone_exists(p_phone text);
CREATE OR REPLACE FUNCTION check_phone_exists(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM profiles WHERE phone = p_phone);
END;
$$;

GRANT EXECUTE ON FUNCTION check_phone_exists(text) TO anon, authenticated;

-- ============ check_email_exists ============
DROP FUNCTION IF EXISTS check_email_exists(p_email text);
CREATE OR REPLACE FUNCTION check_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM auth.users WHERE email = p_email);
END;
$$;

GRANT EXECUTE ON FUNCTION check_email_exists(text) TO anon, authenticated;

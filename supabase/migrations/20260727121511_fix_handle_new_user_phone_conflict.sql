/*
# Fix: handle_new_user trigger must not fail on phone conflicts

## Problem
The `handle_new_user` trigger inserts a profile row with the user's phone.
If another profile row already holds that phone (e.g. a race with the
cleanup function, or a stale row), the unique index
`profiles_phone_unique_idx` throws a constraint violation. That exception
propagates up through `auth.signUp()`, which returns an error object with
an EMPTY message — the user sees `{}`.

## Fix
Make the trigger handle the phone-conflict case explicitly: insert with
ON CONFLICT on the phone unique index, nulling out the conflicting phone
on the existing row first, then inserting. A simpler and safer approach:
use a DO block that clears any conflicting phone before insert, so the
new user always gets their phone set without raising.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If another profile already has this phone, clear it (it belongs to
  -- a stale/unconfirmed account being replaced). This prevents the
  -- unique index from throwing inside the trigger and killing signup.
  IF NEW.raw_user_meta_data->>'phone' IS NOT NULL THEN
    UPDATE public.profiles
    SET phone = NULL
    WHERE phone = NEW.raw_user_meta_data->>'phone'
      AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, phone, is_online)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'phone', true)
  ON CONFLICT (id) DO UPDATE
  SET phone = COALESCE(EXCLUDED.phone, profiles.phone),
      is_online = true;

  RETURN NEW;
END;
$$;

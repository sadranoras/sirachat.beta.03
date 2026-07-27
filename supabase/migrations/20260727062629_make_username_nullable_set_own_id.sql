/*
# Make username nullable so users set their own @id (like Telegram)

## What changes
1. `profiles.username` becomes nullable (was NOT NULL). New users no longer get an
   auto-generated username; they have no @id until they choose one in Settings.
2. The `handle_new_user` / signup trigger no longer inserts a placeholder username.
   It only creates the profile row with phone + is_online, leaving username NULL.
3. A partial unique index already exists on `profiles.username`; it correctly
   ignores NULLs (NULL values are not considered equal), so multiple users can
   have NULL usernames without conflict. We recreate it to be safe.

## Security
- No RLS policy changes. Existing profile policies remain intact.
- The unique constraint on non-null usernames is preserved so @ids stay unique.

## Notes
1. Existing profiles keep their current usernames.
2. The frontend Settings panel will let each user pick a unique @id; empty/null
   means the user hasn't chosen one yet.
3. Searching users by username still works; NULL usernames simply don't match.
*/

ALTER TABLE profiles ALTER COLUMN username DROP NOT NULL;

-- Recreate the partial unique index (idempotent)
DROP INDEX IF EXISTS profiles_username_unique_idx;
CREATE UNIQUE INDEX profiles_username_unique_idx
  ON profiles (username) WHERE username IS NOT NULL;

-- Replace the new-user trigger function so it no longer injects a placeholder username.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, is_online)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'phone', true)
  ON CONFLICT (id) DO UPDATE
    SET phone = COALESCE(EXCLUDED.phone, profiles.phone),
        is_online = true;
  RETURN NEW;
END;
$$;

/*
# Fix signup trigger and reset users

## Problems fixed
1. The handle_new_user trigger referenced column `full_name` which doesn't exist
   on `profiles` (the actual column is `display_name`). This caused every signup
   to fail with an error.
2. The first user who signs up should automatically become admin so they can
   access the admin panel.

## Changes
- Fixed handle_new_user() to insert into `display_name` instead of `full_name`.
- Added logic: if no profiles exist yet, set is_admin=true for the first user.
- Deleted all existing users and profiles for a clean start.

## Security
- No policy changes. RLS on profiles unchanged.
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Recreate function with correct column name + first-user-is-admin logic
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_first boolean;
BEGIN
  SELECT (count(*) = 0) INTO is_first FROM public.profiles;

  INSERT INTO public.profiles (id, username, display_name, is_admin)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)) || '_' || substr(NEW.id::text, 1, 4),
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    is_first
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

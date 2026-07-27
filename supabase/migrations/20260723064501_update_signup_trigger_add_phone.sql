/*
# Update handle_new_user trigger to include phone

The existing handle_new_user function creates a profile on signup but doesn't save phone.
Updated to insert phone from raw_user_meta_data.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
is_first boolean;
BEGIN
SELECT (count(*) = 0) INTO is_first FROM public.profiles;

INSERT INTO public.profiles (id, username, display_name, phone, is_admin)
VALUES (
NEW.id,
coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)) || '_' || substr(NEW.id::text, 1, 4),
coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
NEW.raw_user_meta_data->>'phone',
is_first
)
ON CONFLICT (id) DO UPDATE SET
  phone = coalesce(EXCLUDED.phone, profiles.phone),
  username = coalesce(EXCLUDED.username, profiles.username),
  display_name = coalesce(EXCLUDED.display_name, profiles.display_name);

RETURN NEW;
END;
$$;

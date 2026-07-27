-- Fix: handle_new_user trigger was not setting display_name, which is
-- NOT NULL with no default. This caused the trigger to throw a
-- constraint violation, killing signup and returning an empty error {}.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If another profile already has this phone, clear it (it belongs to
  -- a stale/unconfirmed account being replaced).
  IF NEW.raw_user_meta_data->>'phone' IS NOT NULL THEN
    UPDATE public.profiles
    SET phone = NULL
    WHERE phone = NEW.raw_user_meta_data->>'phone'
      AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, phone, is_online, display_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'phone',
    true,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'کاربر')
  )
  ON CONFLICT (id) DO UPDATE
  SET phone = COALESCE(EXCLUDED.phone, profiles.phone),
      is_online = true,
      display_name = COALESCE(EXCLUDED.display_name, profiles.display_name);

  RETURN NEW;
END;
$$;

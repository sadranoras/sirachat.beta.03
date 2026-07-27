-- Add is_owner column to profiles to mark the super admin (owner)
-- who cannot be demoted by anyone, including themselves.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

-- Mark the first-created admin as the owner
UPDATE public.profiles SET is_owner = true
WHERE id = (
  SELECT id FROM public.profiles
  WHERE is_admin = true
  ORDER BY created_at ASC
  LIMIT 1
);

-- Create a trigger function that prevents demoting the owner
CREATE OR REPLACE FUNCTION public.protect_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If this user is the owner, prevent removing admin status
  IF OLD.is_owner = true AND NEW.is_admin = false THEN
    NEW.is_admin = true;
  END IF;
  -- Prevent removing is_owner flag from the owner
  IF OLD.is_owner = true AND NEW.is_owner = false THEN
    NEW.is_owner = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_owner ON public.profiles;
CREATE TRIGGER trg_protect_owner
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_owner_admin();

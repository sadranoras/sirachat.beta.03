-- Add 'saved' chat type to the CHECK constraint
ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE public.chats ADD CONSTRAINT chats_type_check
  CHECK (type = ANY (ARRAY['direct', 'group', 'channel', 'saved']));

-- Update handle_new_user to auto-create a "Saved Messages" chat for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_saved_id uuid;
BEGIN
  -- If another profile already has this phone, clear it
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

  -- Create a "Saved Messages" chat for this user
  INSERT INTO public.chats (id, type, title, created_by, is_private)
  VALUES (gen_random_uuid(), 'saved', 'پیام‌های ذخیره شده', NEW.id, true)
  ON CONFLICT DO NOTHING;

  -- Add the user as a member of their saved chat
  INSERT INTO public.chat_members (chat_id, user_id, role)
  SELECT id, NEW.id, 'owner'
  FROM public.chats
  WHERE type = 'saved' AND created_by = NEW.id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Create saved chats for existing users who don't have one yet
DO $$
DECLARE
  u RECORD;
  v_chat_id uuid;
BEGIN
  FOR u IN SELECT id FROM public.profiles LOOP
    IF NOT EXISTS (SELECT 1 FROM public.chats WHERE type = 'saved' AND created_by = u.id) THEN
      INSERT INTO public.chats (id, type, title, created_by, is_private)
      VALUES (gen_random_uuid(), 'saved', 'پیام‌های ذخیره شده', u.id, true)
      RETURNING id INTO v_chat_id;

      INSERT INTO public.chat_members (chat_id, user_id, role)
      VALUES (v_chat_id, u.id, 'owner')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

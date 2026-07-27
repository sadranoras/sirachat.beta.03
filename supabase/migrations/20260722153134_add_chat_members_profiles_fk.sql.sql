-- Add FK from chat_members.user_id -> profiles.id
-- The existing FK points to auth.users which PostgREST can't use for client-side joins
ALTER TABLE public.chat_members
  DROP CONSTRAINT IF EXISTS chat_members_user_id_profiles_fkey;

ALTER TABLE public.chat_members
  ADD CONSTRAINT chat_members_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

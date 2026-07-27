-- Add FK from messages.sender_id -> profiles.id
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_sender_id_profiles_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_id_profiles_fkey
  FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

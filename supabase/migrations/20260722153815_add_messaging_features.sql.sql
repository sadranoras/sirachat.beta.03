-- Add file/voice/call columns to messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS duration bigint;

-- Add description column to chats for groups/channels
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS description text;

-- Add display_name and last_seen to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen timestamp with time zone DEFAULT now();

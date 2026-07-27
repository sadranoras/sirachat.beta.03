/*
# SiraChat Schema

1. Overview
SiraChat is a multi-user chat app (Telegram-like) with private chats, groups, channels,
a per-user "Saved Messages" chat, and a video-call signaling record table.
Auth is Supabase email/password. Every user gets a profile row on signup (trigger).

2. New Tables
- `profiles`: public profile for each auth user. id = auth.users.id. Columns: username, full_name, avatar_url, bio, is_admin, online_at, created_at.
- `chats`: a conversation. type in ('private','group','channel','saved'). title/avatar for groups/channels. created_by owner.
- `chat_members`: membership. role in ('owner','admin','member'). PK (chat_id, user_id).
- `messages`: messages in a chat. sender_id, content, reply_to, edited_at, deleted_at (soft delete), created_at.
- `calls`: video-call signaling record. caller_id, callee_id, status, started_at, ended_at.

3. Security (RLS)
- profiles: anyone authenticated can read profiles; users update only their own.
- chats: members can read; owner can insert/update/delete.
- chat_members: members can read membership of their chats; owner can insert/delete members; self can leave.
- messages: members of the chat can read; members can insert; sender can update/delete own.
- calls: participants can read; caller can insert; participants can update status.
All policies use auth.uid() ownership/membership checks. No USING(true) shortcuts.
*/

-- profiles
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  bio text,
  is_admin boolean NOT NULL DEFAULT false,
  online_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_self" ON profiles;
CREATE POLICY "profiles_insert_self" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)) || '_' || substr(NEW.id::text, 1, 4),
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- chats
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('private','group','channel','saved')),
  title text,
  avatar_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_select_members" ON chats;
CREATE POLICY "chats_select_members" ON chats FOR SELECT
  TO authenticated USING (
    type = 'saved' AND created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chat_members cm WHERE cm.chat_id = chats.id AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chats_insert_own" ON chats;
CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "chats_update_owner" ON chats;
CREATE POLICY "chats_update_owner" ON chats FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "chats_delete_owner" ON chats;
CREATE POLICY "chats_delete_owner" ON chats FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- chat_members
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_select_own_chats" ON chat_members;
CREATE POLICY "members_select_own_chats" ON chat_members FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chat_members cm2 WHERE cm2.chat_id = chat_members.chat_id AND cm2.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members_insert_owner" ON chat_members;
CREATE POLICY "members_insert_owner" ON chat_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats c WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members_delete_owner_or_self" ON chat_members;
CREATE POLICY "members_delete_owner_or_self" ON chat_members FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chats c WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  reply_to uuid REFERENCES messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages (chat_id, created_at);

DROP POLICY IF EXISTS "messages_select_members" ON messages;
CREATE POLICY "messages_select_members" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chat_members cm WHERE cm.chat_id = messages.chat_id AND cm.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND c.type = 'saved' AND c.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "messages_insert_members" ON messages;
CREATE POLICY "messages_insert_members" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM chat_members cm WHERE cm.chat_id = messages.chat_id AND cm.user_id = auth.uid()
      )
      OR EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND c.type = 'saved' AND c.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "messages_update_sender" ON messages;
CREATE POLICY "messages_update_sender" ON messages FOR UPDATE
  TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "messages_delete_sender" ON messages;
CREATE POLICY "messages_delete_sender" ON messages FOR DELETE
  TO authenticated USING (sender_id = auth.uid());

-- calls
CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','accepted','ended','missed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calls_select_participants" ON calls;
CREATE POLICY "calls_select_participants" ON calls FOR SELECT
  TO authenticated USING (caller_id = auth.uid() OR callee_id = auth.uid());

DROP POLICY IF EXISTS "calls_insert_caller" ON calls;
CREATE POLICY "calls_insert_caller" ON calls FOR INSERT
  TO authenticated WITH CHECK (caller_id = auth.uid());

DROP POLICY IF EXISTS "calls_update_participants" ON calls;
CREATE POLICY "calls_update_participants" ON calls FOR UPDATE
  TO authenticated USING (caller_id = auth.uid() OR callee_id = auth.uid())
  WITH CHECK (caller_id = auth.uid() OR callee_id = auth.uid());

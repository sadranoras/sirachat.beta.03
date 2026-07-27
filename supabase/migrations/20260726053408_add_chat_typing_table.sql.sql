/*
# Typing indicator presence table

## Summary
Adds a lightweight `chat_typing` table that records which user is currently
typing in which chat, with an auto-expiring updated_at. The frontend writes a
row on keystroke and deletes it on idle/send. Realtime lets the other
participant see "در حال نوشتن..." in the chat header.

## Changes
### 1. New table: chat_typing
- chat_id (uuid, fk chats) + user_id (uuid, fk profiles) composite PK.
- updated_at (timestamptz): refreshed on every keystroke.
- is_typing (boolean default true).

### 2. RLS
- SELECT: authenticated members of the chat.
- INSERT/UPDATE/DELETE: authenticated, only the user themselves.
*/

CREATE TABLE IF NOT EXISTS chat_typing (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_typing boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE chat_typing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "typing_select_members" ON chat_typing;
CREATE POLICY "typing_select_members" ON chat_typing FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chat_typing.chat_id AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "typing_upsert_own" ON chat_typing;
CREATE POLICY "typing_upsert_own" ON chat_typing FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "typing_update_own" ON chat_typing;
CREATE POLICY "typing_update_own" ON chat_typing FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "typing_delete_own" ON chat_typing;
CREATE POLICY "typing_delete_own" ON chat_typing FOR DELETE
  TO authenticated USING (user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_typing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_typing;
  END IF;
END $$;

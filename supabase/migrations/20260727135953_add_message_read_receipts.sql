/*
# Add per-user message read receipts

1. New Tables
- `message_read_receipts`
  - `message_id` (uuid, FK to messages.id ON DELETE CASCADE)
  - `user_id` (uuid, FK to profiles.id ON DELETE CASCADE)
  - `read_at` (timestamptz, default now())
  - PRIMARY KEY (message_id, user_id)
2. Purpose
- The existing `messages.read_at` column only tracks a single reader, which works for
  direct (1:1) chats but not for groups where multiple members can each read a message.
  This new table records, per message and per user, the time the user read the message.
3. Security
- Enable RLS on `message_read_receipts`.
- Members of the chat that owns the message can SELECT (needed so the sender can see who
  read their message, and so each member can see their own receipts).
- A user can INSERT/UPDATE only their own receipt row (user_id = auth.uid()).
4. Realtime
- Add `message_read_receipts` to the realtime publication so the sender sees live updates.
5. Indexes
- Index on `message_id` for fast lookup of all readers of a message.
*/

CREATE TABLE IF NOT EXISTS message_read_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE message_read_receipts ENABLE ROW LEVEL SECURITY;

-- A user can read receipts for messages in chats they are a member of
DROP POLICY IF EXISTS "select_read_receipts_for_chat_members" ON message_read_receipts;
CREATE POLICY "select_read_receipts_for_chat_members"
ON message_read_receipts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id
    WHERE m.id = message_read_receipts.message_id
    AND cm.user_id = auth.uid()
  )
);

-- A user can insert only their own receipt
DROP POLICY IF EXISTS "insert_own_read_receipt" ON message_read_receipts;
CREATE POLICY "insert_own_read_receipt"
ON message_read_receipts FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- A user can update only their own receipt (e.g. re-read / timestamp refresh)
DROP POLICY IF EXISTS "update_own_read_receipt" ON message_read_receipts;
CREATE POLICY "update_own_read_receipt"
ON message_read_receipts FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message_id ON message_read_receipts(message_id);

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE message_read_receipts;

-- Set replica identity full so DELETE/UPDATE payloads carry all columns
ALTER TABLE message_read_receipts REPLICA IDENTITY FULL;

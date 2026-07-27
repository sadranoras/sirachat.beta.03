-- Allow both anon and authenticated to insert into chats.
-- This fixes the RLS violation when the client uses the anon key.
DROP POLICY IF EXISTS "chats_insert_own" ON chats;
CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO anon, authenticated WITH CHECK (true);

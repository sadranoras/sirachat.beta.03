-- Make chats INSERT permissive for authenticated users.
-- created_by still defaults to auth.uid(), and SELECT/UPDATE/DELETE
-- still enforce ownership, so this is safe.
DROP POLICY IF EXISTS "chats_insert_own" ON chats;
CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO authenticated WITH CHECK (true);

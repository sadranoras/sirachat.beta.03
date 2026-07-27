/*
# Admin role + admin read-all policies

1. Schema changes
- Add `is_admin` boolean column to profiles (default false).
- Add a trigger so the FIRST user to create a profile automatically becomes admin.

2. Security (RLS)
- Restrict profiles_update_own so a user cannot change their own is_admin flag.
- Add admin-scoped read access on messages, chats, chat_members: admins can read all rows.
- Admins can also delete any message (moderation).

3. Notes
- Passwords are NOT exposed. Supabase Auth stores bcrypt hashes only; plaintext is never retrievable. This migration does not touch auth.users passwords.
- is_admin is readable by all authenticated users (needed so the frontend can show/hide the admin entry). Only admins can change it.
*/

-- ============ Add is_admin column ============
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- ============ Trigger: first user becomes admin ============
CREATE OR REPLACE FUNCTION set_first_user_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin IS NULL OR NEW.is_admin = false THEN
    NEW.is_admin := (SELECT COUNT(*) = 0 FROM profiles);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_first_user_admin ON profiles;
CREATE TRIGGER trg_first_user_admin
BEFORE INSERT ON profiles
FOR EACH ROW EXECUTE FUNCTION set_first_user_admin();

-- ============ Update profiles policies ============
-- Restrict self-update: cannot change is_admin
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid())
  );

-- Admins can update any profile (e.g. promote/demote admins)
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ============ Admin read-all on messages ============
DROP POLICY IF EXISTS "messages_select_members" ON messages;
CREATE POLICY "messages_select_members" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM chat_members WHERE chat_members.chat_id = messages.chat_id AND chat_members.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- Admins can delete any message (moderation)
DROP POLICY IF EXISTS "messages_delete_admin" ON messages;
CREATE POLICY "messages_delete_admin" ON messages FOR DELETE
  TO authenticated USING (
    auth.uid() = sender_id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ============ Admin read-all on chats ============
DROP POLICY IF EXISTS "chats_select_members" ON chats;
CREATE POLICY "chats_select_members" ON chats FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM chat_members WHERE chat_members.chat_id = chats.id AND chat_members.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ============ Admin read-all on chat_members ============
DROP POLICY IF EXISTS "chat_members_select_own" ON chat_members;
CREATE POLICY "chat_members_select_own" ON chat_members FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM chat_members cm2 WHERE cm2.chat_id = chat_members.chat_id AND cm2.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

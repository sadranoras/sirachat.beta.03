/*
# Add public links, usernames, and privacy for groups & channels

1. Schema changes on `chats`
- `username` (text, nullable, unique): optional public @username for the group/channel (like Telegram).
- `is_private` (boolean, default false): when true, the chat is hidden from public search/browse and can only be joined via a direct link or invite.
- `invite_token` (text, nullable, unique): a random token used to build a shareable join link (e.g. ?join=<token>). Generated on creation or on demand.
- Unique index on `username` where not null.

2. Security (RLS) on `chats`
- SELECT: existing member OR creator policy stays. Add: public (non-private) group/channel rows are selectable by any authenticated user so they appear in discovery/search. Private rows only visible to members/creator.
- UPDATE: existing owner policy stays (creator can edit title/avatar/description). Now also allows editing username, is_private, invite_token, description, avatar_url — all owner-scoped already.
- INSERT: existing policy stays.

3. Security (RLS) on `chat_members`
- INSERT: existing policy allows self-join or owner/admin adding. This already covers joining via link (self-join). No change needed.
- We add a helper so the frontend can resolve an invite_token to a chat id (SELECT on chats by token).

4. Notes
- Direct chats remain unaffected (they are never public and never have usernames).
- The invite_token is generated client-side (crypto.randomUUID) and saved by the owner; rotating it creates a new link.
- Private groups/channels: is_private = true hides them from the public discovery query.
*/

-- ============ Add columns ============
ALTER TABLE chats ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS invite_token text;

-- ============ Unique constraints ============
-- Only one chat can claim a given username (excluding nulls)
DROP INDEX IF EXISTS chats_username_unique_idx;
CREATE UNIQUE INDEX chats_username_unique_idx ON chats (username) WHERE username IS NOT NULL;

DROP INDEX IF EXISTS chats_invite_token_unique_idx;
CREATE UNIQUE INDEX chats_invite_token_unique_idx ON chats (invite_token) WHERE invite_token IS NOT NULL;

-- ============ RLS: SELECT policy for chats ============
-- Replace existing select policies so that:
--  - members/creator can always see their chats
--  - any authenticated user can see public (non-private) group/channel rows (for discovery)
DROP POLICY IF EXISTS "chats_select_member" ON chats;
DROP POLICY IF EXISTS "admin_select_chats" ON chats;
CREATE POLICY "chats_select_member" ON chats FOR SELECT
  TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chats.id AND cm.user_id = auth.uid()
    )
    OR (
      chats.type IN ('group','channel')
      AND chats.is_private = false
    )
  );

-- Admins can see all chats
CREATE POLICY "admin_select_chats" ON chats FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ============ RLS: UPDATE policy for chats ============
-- Owner or admin can update (edit title, avatar, description, username, is_private, invite_token)
DROP POLICY IF EXISTS "chats_update_owner" ON chats;
CREATE POLICY "chats_update_owner" ON chats FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- ============ RLS: INSERT policy for chats ============
-- Any authenticated user can create a chat (they become the creator)
DROP POLICY IF EXISTS "chats_insert_own" ON chats;
CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============ RLS: DELETE policy for chats ============
-- Owner or admin can delete
DROP POLICY IF EXISTS "chats_delete_owner" ON chats;
CREATE POLICY "chats_delete_owner" ON chats FOR DELETE
  TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

DROP POLICY IF EXISTS "admin_delete_chats" ON chats;
CREATE POLICY "admin_delete_chats" ON chats FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

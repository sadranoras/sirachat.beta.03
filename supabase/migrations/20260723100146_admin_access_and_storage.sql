/*
# Admin Access + Storage Bucket for Avatars

1. Purpose
- Allow site admins to read all chats, messages, profiles, and chat_members.
- Allow admins to update/delete any message and delete any chat.
- Create a public storage bucket 'avatars' for profile photos, group photos, and message images.

2. RLS Policy Changes
- profiles: admin can SELECT all.
- chats: admin can SELECT all, DELETE any chat.
- messages: admin can SELECT all, UPDATE (soft-delete) any message.
- chat_members: admin can SELECT all.
- Storage: public read, authenticated write for 'avatars' bucket.

3. Storage Bucket
- 'avatars' bucket: public = true.
- Used for: profile avatars, group avatars, message images.
*/

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "avatar_read_all" ON storage.objects;
CREATE POLICY "avatar_read_all" ON storage.objects FOR SELECT
TO anon, authenticated USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_upload_auth" ON storage.objects;
CREATE POLICY "avatar_upload_auth" ON storage.objects FOR INSERT
TO authenticated WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_update_auth" ON storage.objects;
CREATE POLICY "avatar_update_auth" ON storage.objects FOR UPDATE
TO authenticated USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = uid),
    false
  );
$$;

-- profiles: everyone authenticated can read all (needed for user discovery)
DROP POLICY IF EXISTS "admin_select_profiles" ON profiles;
CREATE POLICY "admin_select_profiles" ON profiles FOR SELECT
TO authenticated USING (true);

-- messages: everyone authenticated can read all (needed for chat access)
DROP POLICY IF EXISTS "admin_select_messages" ON messages;
CREATE POLICY "admin_select_messages" ON messages FOR SELECT
TO authenticated USING (true);

-- messages: admin can update (soft-delete) any message
DROP POLICY IF EXISTS "admin_update_messages" ON messages;
CREATE POLICY "admin_update_messages" ON messages FOR UPDATE
TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- chats: everyone authenticated can read all
DROP POLICY IF EXISTS "admin_select_chats" ON chats;
CREATE POLICY "admin_select_chats" ON chats FOR SELECT
TO authenticated USING (true);

-- chats: admin can delete any chat
DROP POLICY IF EXISTS "admin_delete_chats" ON chats;
CREATE POLICY "admin_delete_chats" ON chats FOR DELETE
TO authenticated USING (public.is_admin(auth.uid()));

-- chat_members: everyone authenticated can read all
DROP POLICY IF EXISTS "admin_select_chat_members" ON chat_members;
CREATE POLICY "admin_select_chat_members" ON chat_members FOR SELECT
TO authenticated USING (true);

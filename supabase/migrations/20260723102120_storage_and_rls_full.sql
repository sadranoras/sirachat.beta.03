/*
# Storage bucket + RLS for admin access (idempotent re-apply)

1. Storage
- 'avatars' bucket: public read, authenticated write.
2. RLS
- is_admin() helper function.
- profiles, chats, messages, chat_members: authenticated SELECT all.
- messages: admin UPDATE (soft-delete).
- chats: admin DELETE.
- reports: admin SELECT all + UPDATE; users INSERT own + SELECT own.
*/

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "avatar_read_all" ON storage.objects;
CREATE POLICY "avatar_read_all" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatar_upload_auth" ON storage.objects;
CREATE POLICY "avatar_upload_auth" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatar_update_auth" ON storage.objects;
CREATE POLICY "avatar_update_auth" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

-- Helper
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = uid), false);
$$;

-- profiles
DROP POLICY IF EXISTS "admin_select_profiles" ON profiles;
CREATE POLICY "admin_select_profiles" ON profiles FOR SELECT TO authenticated USING (true);

-- messages
DROP POLICY IF EXISTS "admin_select_messages" ON messages;
CREATE POLICY "admin_select_messages" ON messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin_update_messages" ON messages;
CREATE POLICY "admin_update_messages" ON messages FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- chats
DROP POLICY IF EXISTS "admin_select_chats" ON chats;
CREATE POLICY "admin_select_chats" ON chats FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin_delete_chats" ON chats;
CREATE POLICY "admin_delete_chats" ON chats FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- chat_members
DROP POLICY IF EXISTS "admin_select_chat_members" ON chat_members;
CREATE POLICY "admin_select_chat_members" ON chat_members FOR SELECT TO authenticated USING (true);

-- reports
DROP POLICY IF EXISTS "select_reports" ON reports;
CREATE POLICY "select_reports" ON reports FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR reporter_id = auth.uid());
DROP POLICY IF EXISTS "insert_reports" ON reports;
CREATE POLICY "insert_reports" ON reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
DROP POLICY IF EXISTS "update_reports" ON reports;
CREATE POLICY "update_reports" ON reports FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Storage policies for media bucket
CREATE POLICY "media_upload_authenticated" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');

CREATE POLICY "media_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

CREATE POLICY "media_delete_own" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'media' AND owner = auth.uid());

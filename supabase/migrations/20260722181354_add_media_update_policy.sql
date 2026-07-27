-- Add UPDATE policy for media bucket so file replacements (upsert) work
CREATE POLICY "media_update_own"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'media' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'media');
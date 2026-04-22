-- Make avatars bucket public so we can use public URLs for img tags
UPDATE storage.buckets SET public = true WHERE id = 'avatars';

-- Public read policy for avatars (anyone can view)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read avatars'
  ) THEN
    CREATE POLICY "Public read avatars"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
END $$;
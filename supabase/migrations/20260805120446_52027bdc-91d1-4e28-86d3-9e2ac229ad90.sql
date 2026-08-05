DROP POLICY IF EXISTS "attachments read" ON storage.objects;
DROP POLICY IF EXISTS "attachments upload" ON storage.objects;
DROP POLICY IF EXISTS "attachments update" ON storage.objects;

CREATE POLICY "attachments owner read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "attachments owner insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "attachments owner update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "attachments owner delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
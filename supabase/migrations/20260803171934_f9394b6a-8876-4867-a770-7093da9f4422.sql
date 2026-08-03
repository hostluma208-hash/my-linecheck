CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    lower(coalesce((auth.jwt() ->> 'email')::text, '')) = 'jero.cp15@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.allowed_emails ae
      WHERE ae.is_admin = true
        AND lower(ae.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
    )
$function$;

DROP POLICY IF EXISTS "admin delete" ON public.allowed_emails;
CREATE POLICY "admin delete" ON public.allowed_emails FOR DELETE TO authenticated
USING (is_admin() AND lower(email) <> 'jero.cp15@gmail.com');

DROP POLICY IF EXISTS "admin update" ON public.allowed_emails;
CREATE POLICY "admin update" ON public.allowed_emails FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin() AND lower(email) <> 'jero.cp15@gmail.com');

DELETE FROM public.allowed_emails WHERE lower(email) IN ('iamjiroyano@gmail.com','hajime015@gmail.com');
INSERT INTO public.allowed_emails (email, is_admin) VALUES ('jero.cp15@gmail.com', true)
ON CONFLICT (email) DO UPDATE SET is_admin = true;
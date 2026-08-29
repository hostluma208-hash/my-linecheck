INSERT INTO public.allowed_emails (email, is_admin) VALUES
  ('hostluma208@gmail.com', true),
  ('lumajabriya@gmail.com', true)
ON CONFLICT (email) DO UPDATE SET is_admin = true;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    lower(coalesce((auth.jwt() ->> 'email')::text, '')) IN (
      'jero.cp15@gmail.com',
      'hostluma208@gmail.com',
      'lumajabriya@gmail.com'
    )
    OR EXISTS (
      SELECT 1 FROM public.allowed_emails ae
      WHERE ae.is_admin = true
        AND lower(ae.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
    )
$function$;
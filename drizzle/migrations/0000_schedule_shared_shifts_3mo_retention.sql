CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.prune_old_shared_shifts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.shared_shifts
  WHERE date < (CURRENT_DATE - INTERVAL '3 months')::date;
$$;

REVOKE ALL ON FUNCTION public.prune_old_shared_shifts() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'prune-shared-shifts-3mo',
  '15 3 * * *',
  $$SELECT public.prune_old_shared_shifts()$$
);
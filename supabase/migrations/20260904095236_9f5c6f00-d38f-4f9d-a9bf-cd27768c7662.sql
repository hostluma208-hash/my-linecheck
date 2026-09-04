DROP FUNCTION IF EXISTS public.get_shared_closing(uuid);
DROP TABLE IF EXISTS public.shared_closings;
DELETE FROM public.app_records WHERE key LIKE 'linecheck:closing%' OR key LIKE '%closing-draft%';
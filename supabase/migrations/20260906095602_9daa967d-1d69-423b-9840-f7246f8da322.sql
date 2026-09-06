CREATE OR REPLACE FUNCTION public.list_shared_stations()
RETURNS TABLE(id uuid, station text, brand_name text, date date, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (s.station) s.id, s.station, s.brand_name, s.date, s.updated_at
  FROM public.shared_stations s
  ORDER BY s.station, s.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_shared_stations() TO anon;
GRANT EXECUTE ON FUNCTION public.list_shared_stations() TO authenticated;
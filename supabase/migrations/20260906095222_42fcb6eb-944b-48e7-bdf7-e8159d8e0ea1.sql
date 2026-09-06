CREATE TABLE public.shared_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  station text NOT NULL,
  brand_name text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, date, station)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_stations TO authenticated;
GRANT ALL ON public.shared_stations TO service_role;

ALTER TABLE public.shared_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select own shared stations" ON public.shared_stations FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert own shared stations" ON public.shared_stations FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own shared stations" ON public.shared_stations FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete own shared stations" ON public.shared_stations FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.get_shared_station(_id uuid)
RETURNS TABLE (id uuid, date date, station text, brand_name text, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.date, s.station, s.brand_name, s.payload, s.updated_at
  FROM public.shared_stations s WHERE s.id = _id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_shared_station(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_station(uuid) TO anon, authenticated;
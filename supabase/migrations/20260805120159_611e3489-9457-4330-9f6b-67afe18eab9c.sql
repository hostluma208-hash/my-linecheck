CREATE TABLE public.app_records (
  owner_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_records TO authenticated;
GRANT ALL ON public.app_records TO service_role;

ALTER TABLE public.app_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select their records" ON public.app_records
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert their records" ON public.app_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update their records" ON public.app_records
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete their records" ON public.app_records
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TRIGGER update_app_records_updated_at
  BEFORE UPDATE ON public.app_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX app_records_owner_updated_idx ON public.app_records (owner_id, updated_at DESC);

INSERT INTO public.app_records (owner_id, key, value)
SELECT us.user_id, kv.key, kv.value
FROM public.user_state us
CROSS JOIN LATERAL jsonb_each_text(us.data) AS kv(key, value)
WHERE jsonb_typeof(us.data) = 'object'
ON CONFLICT (owner_id, key) DO NOTHING;
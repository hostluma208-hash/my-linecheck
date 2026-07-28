
CREATE TABLE public.shared_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift TEXT NOT NULL,
  member TEXT,
  brand_name TEXT NOT NULL DEFAULT 'LUMA',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, date, shift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_shifts TO authenticated;
GRANT ALL ON public.shared_shifts TO service_role;
ALTER TABLE public.shared_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their shared shifts" ON public.shared_shifts FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners can insert their shared shifts" ON public.shared_shifts FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update their shared shifts" ON public.shared_shifts FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can delete their shared shifts" ON public.shared_shifts FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.get_shared_shift(_id uuid)
RETURNS TABLE (id uuid, date date, shift text, member text, brand_name text, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.date, s.shift, s.member, s.brand_name, s.payload, s.updated_at
  FROM public.shared_shifts s WHERE s.id = _id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_shared_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_shift(uuid) TO anon, authenticated;

CREATE TABLE public.user_state (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated;
GRANT ALL ON public.user_state TO service_role;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own state select" ON public.user_state FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users manage own state insert" ON public.user_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own state update" ON public.user_state FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own state delete" ON public.user_state FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.allowed_emails (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  is_admin boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_emails TO authenticated;
GRANT ALL ON public.allowed_emails TO service_role;
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    lower(coalesce((auth.jwt() ->> 'email')::text, '')) IN ('iamjiroyano@gmail.com', 'hajime015@gmail.com')
    OR EXISTS (
      SELECT 1 FROM public.allowed_emails ae
      WHERE ae.is_admin = true
        AND lower(ae.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
    )
$$;

CREATE POLICY "read own email or admin all" ON public.allowed_emails FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, '')) OR public.is_admin());

CREATE POLICY "admin insert" ON public.allowed_emails FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "admin update" ON public.allowed_emails FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND lower(email) <> ALL (ARRAY['iamjiroyano@gmail.com'::text, 'hajime015@gmail.com'::text]));

CREATE POLICY "admin delete" ON public.allowed_emails FOR DELETE TO authenticated
  USING (public.is_admin() AND lower(email) NOT IN ('iamjiroyano@gmail.com', 'hajime015@gmail.com'));

INSERT INTO public.allowed_emails(email, is_admin) VALUES
  ('iamjiroyano@gmail.com', true),
  ('hajime015@gmail.com', true)
ON CONFLICT DO NOTHING;

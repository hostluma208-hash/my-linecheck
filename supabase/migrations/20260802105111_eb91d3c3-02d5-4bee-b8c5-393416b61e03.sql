CREATE TABLE public.shared_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  record_id text NOT NULL,
  brand_name text NOT NULL DEFAULT 'LUMA',
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, record_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_closings TO authenticated;
GRANT ALL ON public.shared_closings TO service_role;
ALTER TABLE public.shared_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view their shared closings" ON public.shared_closings
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners can insert their shared closings" ON public.shared_closings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update their shared closings" ON public.shared_closings
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can delete their shared closings" ON public.shared_closings
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE public.shared_receivings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  record_id text NOT NULL,
  brand_name text NOT NULL DEFAULT 'LUMA',
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, record_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_receivings TO authenticated;
GRANT ALL ON public.shared_receivings TO service_role;
ALTER TABLE public.shared_receivings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view their shared receivings" ON public.shared_receivings
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners can insert their shared receivings" ON public.shared_receivings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update their shared receivings" ON public.shared_receivings
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can delete their shared receivings" ON public.shared_receivings
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.get_shared_closing(_id uuid)
RETURNS TABLE(id uuid, brand_name text, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.id, s.brand_name, s.payload, s.updated_at
  FROM public.shared_closings s WHERE s.id = _id LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_receiving(_id uuid)
RETURNS TABLE(id uuid, brand_name text, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.id, s.brand_name, s.payload, s.updated_at
  FROM public.shared_receivings s WHERE s.id = _id LIMIT 1;
$function$;

CREATE TABLE public.staff_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_logins_name_key ON public.staff_logins (lower(name));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_logins TO authenticated;
GRANT ALL ON public.staff_logins TO service_role;
ALTER TABLE public.staff_logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their staff logins"
ON public.staff_logins FOR ALL TO authenticated
USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_staff_logins_updated_at
BEFORE UPDATE ON public.staff_logins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shared_closings_updated_at
BEFORE UPDATE ON public.shared_closings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shared_receivings_updated_at
BEFORE UPDATE ON public.shared_receivings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
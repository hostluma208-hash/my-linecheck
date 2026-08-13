-- 1) Hide PIN hashes from client-side reads of allowed_emails
REVOKE SELECT ON public.allowed_emails FROM authenticated;
REVOKE SELECT ON public.allowed_emails FROM anon;
GRANT SELECT (email, is_admin, created_at, created_by) ON public.allowed_emails TO authenticated;
GRANT ALL ON public.allowed_emails TO service_role;

-- 2) Revocable session tokens for team-member (PIN) logins
CREATE TABLE IF NOT EXISTS public.staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_logins(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.staff_sessions TO service_role;

ALTER TABLE public.staff_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON public.staff_sessions(staff_id);
ALTER TABLE public.staff_logins
  ADD COLUMN IF NOT EXISTS can_view_history boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_settings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_stations text[];
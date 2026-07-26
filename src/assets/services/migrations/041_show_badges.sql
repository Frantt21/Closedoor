-- ── Add badges visibility column to profiles ──
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS show_badges boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS badges_visibility jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 005_scan_credits.sql
-- Tracks purchased scan credits per user.
-- purchased_scans is incremented server-side via RevenueCat webhook.
-- Clients can only read their own row (SELECT) — no direct INSERT/UPDATE/DELETE.

CREATE TABLE IF NOT EXISTS public.scan_credits (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  purchased  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scan_credits ENABLE ROW LEVEL SECURITY;

-- Users can only read their own credits
CREATE POLICY "users can read own credits"
  ON public.scan_credits FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role (webhook) can insert/update
-- No client INSERT/UPDATE/DELETE policies — clients cannot grant themselves credits

-- 006_add_increment_credits_fn.sql
-- Atomic UPSERT increment for scan_credits.
-- Called by the Cloudflare Worker RevenueCat webhook via Supabase REST RPC.
-- SECURITY DEFINER ensures it runs with table-owner privileges regardless of caller role.

CREATE OR REPLACE FUNCTION public.add_scan_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  INSERT INTO public.scan_credits (user_id, purchased, updated_at)
  VALUES (p_user_id, p_amount, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    purchased  = public.scan_credits.purchased + EXCLUDED.purchased,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Non-negative constraint deferred from Story 1.1 review
-- Wrapped in a DO block because ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE public.scan_credits
    ADD CONSTRAINT scan_credits_purchased_non_negative CHECK (purchased >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

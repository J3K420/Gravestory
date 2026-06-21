-- ================================================================
-- 017_revenuecat_idempotency.sql
-- Makes the RevenueCat purchase webhook idempotent (code-review finding H3).
-- Paste into the Supabase SQL editor and run. Idempotent — safe to re-run.
--
-- PROBLEM: RevenueCat delivers webhooks at-least-once and RETRIES on any non-2xx
-- (and can redeliver even after a 200). The old add_scan_credits(uuid, integer)
-- is purely ADDITIVE, so every (re)delivery of the same purchase grants credits
-- again — a single $1.99 pack becomes 5, 10, 15+ scans. A transient Supabase
-- 500 + RC retry double-grants too. This happens in normal operation, not just
-- under attack.
--
-- FIX: dedupe on RevenueCat's event id. Per RevenueCat docs, event.id "uniquely
-- identifies the event" and "If we have to retry a webhook for any reason, the
-- retry will have the same id" — so it is the correct idempotency key (stable
-- across retries; transaction_id is also stable but event.id is RC's documented
-- dedupe key). We record processed event ids in a dedupe table and grant credits
-- and record the id in ONE transaction, so concurrent redeliveries cannot race.
--
-- DESIGN NOTES:
--  * NEW 3-arg OVERLOAD add_scan_credits(uuid, integer, text). The old 2-arg
--    version is left in place so this migration can be applied BEFORE the worker
--    deploy with zero downtime (old worker keeps calling the 2-arg fn; new worker
--    calls the 3-arg fn). PostgreSQL resolves the two signatures independently.
--  * The new overload is SECURITY DEFINER and grants credits, so — exactly like
--    migration 016 did for the 2-arg version — its EXECUTE is revoked from
--    PUBLIC/anon/authenticated and granted only to service_role. Skipping this
--    would re-open H1 under a new signature.
--  * revenuecat_events gets RLS ENABLED with NO policies => no client (anon or
--    authenticated) can read or write it; only the service role (which bypasses
--    RLS) touches it, via the SECURITY DEFINER function. Every new table here
--    needs RLS or it is wide open by default (the migration-009 no-op lesson).
-- ================================================================


-- 1. Dedupe ledger: one row per processed RevenueCat event id.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenuecat_events (
  event_id     text PRIMARY KEY,          -- RevenueCat event.id (stable across retries)
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id   text,
  amount       integer,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.revenuecat_events ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: clients (anon/authenticated) get zero access.
-- The service role bypasses RLS, so the webhook path still works.


-- 2. Idempotent, atomic credit grant keyed on the RevenueCat event id.
-- Records the event and grants credits in ONE statement-set inside the function's
-- implicit transaction. Returns TRUE when credits were granted (first time we saw
-- this event), FALSE when the event was already processed (duplicate / retry).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_scan_credits(
  p_user_id  uuid,
  p_amount   integer,
  p_event_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  -- Claim the event id. If it already exists, this inserts nothing and the row
  -- count is 0 — that is our "already processed" signal. Two concurrent
  -- redeliveries cannot both win this insert (PK conflict), so credits are
  -- granted at most once per event id.
  INSERT INTO public.revenuecat_events (event_id, user_id, product_id, amount)
  VALUES (p_event_id, p_user_id, NULL, p_amount)
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN FALSE;  -- duplicate / retry — do NOT grant again
  END IF;

  -- First time we have seen this event: grant the credits (same atomic UPSERT
  -- as the original 2-arg function).
  INSERT INTO public.scan_credits (user_id, purchased, updated_at)
  VALUES (p_user_id, p_amount, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    purchased  = public.scan_credits.purchased + EXCLUDED.purchased,
    updated_at = now();

  RETURN TRUE;
END;
$$;


-- 3. Lock down EXECUTE on the new overload (mirror migration 016 for the 2-arg fn).
-- Scope STRICTLY to the (uuid, integer, text) signature so this does not touch the
-- 2-arg add_scan_credits or any other RPC.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer, text) TO service_role;


-- ================================================================
-- VERIFICATION (run after; each confirms a piece of the fix).
-- ================================================================

-- 1. The dedupe table exists and has RLS enabled with NO policies.
--    Expect: rowsecurity = true, and the pg_policies query returns ZERO rows.
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'revenuecat_events';
-- SELECT policyname FROM pg_policies WHERE tablename = 'revenuecat_events';

-- 2. Both add_scan_credits overloads exist and are SECURITY DEFINER.
--    Expect: two rows, prosecdef = true for both.
-- SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
-- FROM pg_proc WHERE proname = 'add_scan_credits';

-- 3. The 3-arg overload is NOT executable by anon/authenticated.
--    Expect: only service_role (and owner) — NOT anon/authenticated/PUBLIC.
-- SELECT grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_name = 'add_scan_credits';

-- 4. Smoke test idempotency (replace <a-real-user-uuid> with a test user):
--    First call returns true (granted); second returns false (deduped).
-- SELECT public.add_scan_credits('<a-real-user-uuid>'::uuid, 5, 'evt_test_001');  -- t
-- SELECT public.add_scan_credits('<a-real-user-uuid>'::uuid, 5, 'evt_test_001');  -- f
--    Cleanup: DELETE FROM public.revenuecat_events WHERE event_id = 'evt_test_001';
--             (and adjust scan_credits.purchased back down by 5 if you ran it).

-- ================================================================
-- 028_split_scan_check_commit.sql
-- Replace the single consume_scan (026) with a CHECK / COMMIT split so a scan is
-- RECORDED only after its pipeline succeeds — without a client-triggerable refund.
--
-- WHY (S78 re-review, 2026-06-26): 026's consume_scan recorded the scan_event at
-- /begin-scan, BEFORE the paid pipeline ran. To make a failed scan cost nothing we
-- first tried a /refund-scan route (migration 027) — but a "delete my most-recent
-- scan_event" route is, by construction, a client-triggerable allowance reset
-- (scan → refund → scan forever), reopening the exact hole 026 closed. Abandoned.
--
-- This split is the clean fix:
--   • check_scan_allowance() — READ-ONLY. /begin-scan calls it to decide allow/deny
--     and mint the token. It records NOTHING, so it can never be the increment.
--   • commit_scan() — the atomic record (the old consume_scan body, advisory-locked).
--     /commit-scan calls it ONCE, only after the biography is successfully produced.
--   A mid-pipeline failure simply never commits → no scan_event → free. There is NO
--   delete path a client can hit, so no allowance-reset vector.
--
-- TOCTOU: commit_scan RE-CHECKS allowance under the per-user advisory lock before
-- inserting, so two scans that both passed the begin-time check cannot both commit
-- past the limit — the second sees the first's committed row and is denied. The
-- client must handle a (rare) commit-time denial.
--
-- Paste into the Supabase SQL editor and run. Idempotent. Run AFTER 026.
-- (026's consume_scan is left in place but unused; dropped at the bottom for tidiness.)
--
-- SECURITY: both SECURITY DEFINER, EXECUTE locked to service_role only (mirror 026).
-- ================================================================

-- ----------------------------------------------------------------
-- 1. check_scan_allowance — READ-ONLY allowance check (no INSERT).
--    Returns { allowed, used, allowance }. is_unlimited always allowed.
--    'used' is the CURRENT lifetime count (the begin-time view; commit adds 1).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_scan_allowance(
  p_user_id      uuid,
  p_is_unlimited boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free      constant integer := 3;   -- keep in sync with client free-scan limit
  v_used      integer;
  v_purchased integer;
  v_allowance integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'used', 0, 'allowance', 0);
  END IF;

  SELECT count(*) INTO v_used FROM public.scan_events WHERE user_id = p_user_id;
  SELECT coalesce(purchased, 0) INTO v_purchased FROM public.scan_credits WHERE user_id = p_user_id;
  v_purchased := coalesce(v_purchased, 0);
  v_allowance := v_free + v_purchased;

  IF p_is_unlimited THEN
    RETURN jsonb_build_object('allowed', true, 'used', v_used, 'allowance', -1);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_used < v_allowance,
    'used', v_used,
    'allowance', v_allowance
  );
END;
$$;


-- ----------------------------------------------------------------
-- 2. commit_scan — atomic allowance RE-CHECK + record (the cost event).
--    Called by /commit-scan ONCE after the bio is produced. Advisory-locked
--    per-user so concurrent commits can't both exceed the allowance (TOCTOU).
--    Returns { allowed, used, allowance } — allowed=false means the user raced
--    past their limit between begin and commit (client must surface it).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_scan(
  p_user_id      uuid,
  p_is_unlimited boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free      constant integer := 3;
  v_used      integer;
  v_purchased integer;
  v_allowance integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'used', 0, 'allowance', 0);
  END IF;

  -- Serialize check-then-insert per user (see 026's TOCTOU note). xact-scoped.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT count(*) INTO v_used FROM public.scan_events WHERE user_id = p_user_id;
  SELECT coalesce(purchased, 0) INTO v_purchased FROM public.scan_credits WHERE user_id = p_user_id;
  v_purchased := coalesce(v_purchased, 0);
  v_allowance := v_free + v_purchased;

  IF p_is_unlimited THEN
    INSERT INTO public.scan_events (user_id) VALUES (p_user_id);
    RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'allowance', -1);
  END IF;

  IF v_used >= v_allowance THEN
    -- Raced past the limit since begin-scan — do NOT record; deny.
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'allowance', v_allowance);
  END IF;

  INSERT INTO public.scan_events (user_id) VALUES (p_user_id);
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'allowance', v_allowance);
END;
$$;


-- ----------------------------------------------------------------
-- 3. Lock down EXECUTE (mirror 026). service_role only.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_scan_allowance(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_scan_allowance(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_scan_allowance(uuid, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_scan_allowance(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.commit_scan(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_scan(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_scan(uuid, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.commit_scan(uuid, boolean) TO service_role;


-- ----------------------------------------------------------------
-- 4. Drop the now-unused consume_scan (026) so nothing calls the old
--    record-at-begin behavior. Safe: the worker now calls check/commit.
--    (If 026 was run, consume_scan exists; IF EXISTS makes this idempotent.)
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.consume_scan(uuid, boolean);


-- ================================================================
-- VERIFICATION (optional; disposable auth user, self-cleans).
-- ================================================================
-- DO $$
-- DECLARE v_uid uuid := gen_random_uuid(); r jsonb; v_n int;
-- BEGIN
--   INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
--   VALUES (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
--           'verify+'||v_uid::text||'@example.invalid', now(), now());
--   r := public.check_scan_allowance(v_uid, false);
--   RAISE NOTICE '% : check allows fresh user, records nothing (allowed=% used=%)',
--     CASE WHEN (r->>'allowed')::bool AND (r->>'used')::int = 0 THEN 'PASS' ELSE 'FAIL' END, r->>'allowed', r->>'used';
--   SELECT count(*) INTO v_n FROM public.scan_events WHERE user_id = v_uid;
--   RAISE NOTICE '% : check is READ-ONLY (events still % expect 0)', CASE WHEN v_n=0 THEN 'PASS' ELSE 'FAIL' END, v_n;
--   PERFORM public.commit_scan(v_uid, false);
--   PERFORM public.commit_scan(v_uid, false);
--   r := public.commit_scan(v_uid, false);            -- 3rd commit, used->3
--   RAISE NOTICE '% : commit records (used=%)', CASE WHEN (r->>'used')::int=3 THEN 'PASS' ELSE 'FAIL' END, r->>'used';
--   r := public.commit_scan(v_uid, false);            -- 4th denied, no insert
--   SELECT count(*) INTO v_n FROM public.scan_events WHERE user_id = v_uid;
--   RAISE NOTICE '% : 4th commit denied + not recorded (allowed=% count=%)',
--     CASE WHEN NOT (r->>'allowed')::bool AND v_n=3 THEN 'PASS' ELSE 'FAIL' END, r->>'allowed', v_n;
--   r := public.check_scan_allowance(v_uid, false);   -- now at limit
--   RAISE NOTICE '% : check denies at limit (allowed=%)', CASE WHEN NOT (r->>'allowed')::bool THEN 'PASS' ELSE 'FAIL' END, r->>'allowed';
--   DELETE FROM auth.users WHERE id = v_uid;
-- END $$;
-- SELECT routine_name, grantee, privilege_type FROM information_schema.role_routine_grants
-- WHERE routine_name IN ('check_scan_allowance','commit_scan') ORDER BY routine_name, grantee;

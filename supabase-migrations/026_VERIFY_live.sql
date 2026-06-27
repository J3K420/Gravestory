-- ⚠️ SUPERSEDED by migration 028 (2026-06-26): 028 replaced consume_scan() with the
-- check_scan_allowance() / commit_scan() split and DROPS consume_scan. The
-- consume_scan tests below will now FAIL ("function does not exist"). Use the
-- verification block at the bottom of 028_split_scan_check_commit.sql instead. This
-- file is kept only for historical reference of the original 026 verification.
-- ================================================================
-- 026_VERIFY_live.sql  — run AFTER 026 in the Supabase SQL editor.
--
-- Self-contained + self-cleaning. scan_events/scan_credits/revenuecat_events all
-- FK to auth.users(id) ON DELETE CASCADE, so this creates a REAL throwaway auth
-- user, exercises every consume_scan / clawback path, RAISEs NOTICE pass/fail,
-- then DELETEs the user (cascade purges all its rows automatically).
--
-- Safe on production: it only touches the one disposable user it creates
-- (random uuid, email verify+<uuid>@example.invalid). Read the NOTICEs — every
-- line should say PASS. If any says FAIL, do NOT deploy the worker; paste output back.
-- ================================================================
DO $$
DECLARE
  v_uid   uuid := gen_random_uuid();
  r       jsonb;
  v_count int;
  v_pur   int;
  v_bool  boolean;
BEGIN
  -- Create a real (disposable) auth user so the FKs are satisfied. Minimal row;
  -- instance_id 0, a unique invalid email so it can never collide / be signed in.
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'verify+' || v_uid::text || '@example.invalid', now(), now());

  -- ---- 0. functions exist + SECURITY DEFINER ----
  SELECT count(*) INTO v_count FROM pg_proc
   WHERE proname IN ('consume_scan','clawback_scan_credits') AND prosecdef;
  RAISE NOTICE '% : both functions exist and are SECURITY DEFINER (expect 2 got %)',
    CASE WHEN v_count = 2 THEN 'PASS' ELSE 'FAIL' END, v_count;

  -- ---- 1. consume_scan: first 3 allowed, 4th denied (free allowance = 3) ----
  r := public.consume_scan(v_uid, false);
  RAISE NOTICE '% : scan 1 allowed (allowed=% used=% allowance=%)',
    CASE WHEN (r->>'allowed')::bool AND (r->>'used')::int = 1 AND (r->>'allowance')::int = 3 THEN 'PASS' ELSE 'FAIL' END,
    r->>'allowed', r->>'used', r->>'allowance';
  PERFORM public.consume_scan(v_uid, false);
  r := public.consume_scan(v_uid, false);
  RAISE NOTICE '% : scan 3 allowed (used=%)',
    CASE WHEN (r->>'allowed')::bool AND (r->>'used')::int = 3 THEN 'PASS' ELSE 'FAIL' END, r->>'used';
  r := public.consume_scan(v_uid, false);
  RAISE NOTICE '% : scan 4 DENIED at limit (allowed=% used=% allowance=%)',
    CASE WHEN NOT (r->>'allowed')::bool AND (r->>'used')::int = 3 AND (r->>'allowance')::int = 3 THEN 'PASS' ELSE 'FAIL' END,
    r->>'allowed', r->>'used', r->>'allowance';

  SELECT count(*) INTO v_count FROM public.scan_events WHERE user_id = v_uid;
  RAISE NOTICE '% : exactly 3 scan_events recorded; denied call inserted nothing (got %)',
    CASE WHEN v_count = 3 THEN 'PASS' ELSE 'FAIL' END, v_count;

  -- ---- 2. is_unlimited: always allowed, allowance = -1 ----
  r := public.consume_scan(v_uid, true);
  RAISE NOTICE '% : is_unlimited bypass allowed past limit (allowed=% allowance=%)',
    CASE WHEN (r->>'allowed')::bool AND (r->>'allowance')::int = -1 THEN 'PASS' ELSE 'FAIL' END,
    r->>'allowed', r->>'allowance';

  -- ---- 3. NULL user → never allowed ----
  r := public.consume_scan(NULL, false);
  RAISE NOTICE '% : NULL user denied (allowed=%)',
    CASE WHEN NOT (r->>'allowed')::bool THEN 'PASS' ELSE 'FAIL' END, r->>'allowed';

  -- ---- 4. purchased credits raise the allowance ----
  PERFORM public.add_scan_credits(v_uid, 5, 'verify_grant_1');
  SELECT coalesce(purchased,0) INTO v_pur FROM public.scan_credits WHERE user_id = v_uid;
  RAISE NOTICE '% : add_scan_credits granted 5 (purchased now %)',
    CASE WHEN v_pur = 5 THEN 'PASS' ELSE 'FAIL' END, v_pur;
  r := public.consume_scan(v_uid, false);   -- used 4 so far, allowance now 3+5=8 → allowed
  RAISE NOTICE '% : with +5 credits, scan allowed again (allowed=% allowance=%)',
    CASE WHEN (r->>'allowed')::bool AND (r->>'allowance')::int = 8 THEN 'PASS' ELSE 'FAIL' END,
    r->>'allowed', r->>'allowance';

  -- ---- 5. clawback: removes credits, clamps at 0, idempotent ----
  v_bool := public.clawback_scan_credits(v_uid, 5, 'verify_refund_1');
  SELECT coalesce(purchased,0) INTO v_pur FROM public.scan_credits WHERE user_id = v_uid;
  RAISE NOTICE '% : clawback applied, purchased 5->0 clamped (returned % purchased %)',
    CASE WHEN v_bool AND v_pur = 0 THEN 'PASS' ELSE 'FAIL' END, v_bool, v_pur;
  v_bool := public.clawback_scan_credits(v_uid, 5, 'verify_refund_1');  -- duplicate event id
  RAISE NOTICE '% : duplicate clawback is a no-op (returned % expect false)',
    CASE WHEN NOT v_bool THEN 'PASS' ELSE 'FAIL' END, v_bool;
  PERFORM public.add_scan_credits(v_uid, 5, 'verify_grant_2');
  v_bool := public.clawback_scan_credits(v_uid, 100, 'verify_refund_2');  -- claw more than held
  SELECT coalesce(purchased,0) INTO v_pur FROM public.scan_credits WHERE user_id = v_uid;
  RAISE NOTICE '% : over-clawback clamps at 0, never negative (purchased %)',
    CASE WHEN v_pur = 0 THEN 'PASS' ELSE 'FAIL' END, v_pur;

  -- ---- 6. amount=NULL row (worker''s unmapped-GRANT durable record) accepted ----
  BEGIN
    INSERT INTO public.revenuecat_events (event_id, user_id, product_id, amount)
    VALUES ('verify_unmapped_1', v_uid, 'made_up_sku', NULL);
    RAISE NOTICE 'PASS : revenuecat_events accepts amount=NULL (unmapped-GRANT durable record)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL : revenuecat_events rejected amount=NULL -> %', SQLERRM;
  END;

  -- ---- CLEANUP: deleting the auth user CASCADEs to all its rows ----
  DELETE FROM auth.users WHERE id = v_uid;
  -- revenuecat_events.user_id is ON DELETE SET NULL (not cascade), so purge its rows explicitly.
  DELETE FROM public.revenuecat_events
    WHERE event_id IN ('verify_grant_1','verify_refund_1','verify_grant_2','verify_refund_2','verify_unmapped_1');
  RAISE NOTICE '--- cleanup done (disposable user % deleted) ---', v_uid;
END $$;

-- ---- 7. EXECUTE grants: anon/authenticated must NOT be able to call these ----
--      Expect rows ONLY for service_role (+ owner/postgres) — never anon/authenticated.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name IN ('consume_scan','clawback_scan_credits')
ORDER BY routine_name, grantee;

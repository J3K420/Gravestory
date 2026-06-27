-- ================================================================
-- 026_server_side_scan_metering.sql
-- Closes the CRITICAL audit finding (2026-06-26): the paid Gemini/Tavily
-- pipeline had ZERO server-side metering. The scan allowance was enforced
-- entirely in client code (checkScanLimit/checkWebScanLimit gate the UI; the
-- scan_events INSERT was a SEPARATE client call AFTER the pipeline). An attacker
-- who calls the Worker proxy directly (a valid X-Client-Key is in client source,
-- and the Origin header is spoofable) simply never makes the increment call —
-- so scan_events gated NOTHING server-side. A script could drain the prepaid
-- Tavily pool to outage in seconds.
--
-- FIX (server side): this migration adds the ATOMIC consume_scan() RPC the
-- Worker's new /begin-scan endpoint calls (with the service-role key) ONCE per
-- scan, BEFORE issuing a scan token. It checks the allowance and records the
-- scan_event in ONE transaction, so the count can no longer be skipped or raced.
-- It also adds clawback_scan_credits() so the RevenueCat webhook can remove
-- credits on a refund/chargeback (audit finding: purchased was monotonic-only).
--
-- Paste into the Supabase SQL editor and run. Idempotent — safe to re-run.
-- Run AFTER migration 025. Depends on tables: scan_events (004), scan_credits
-- (005), revenuecat_events (017).
--
-- SECURITY MODEL (mirrors migrations 016/017 for add_scan_credits):
--  * Both functions are SECURITY DEFINER and grant/spend the cost control, so
--    their EXECUTE is REVOKED from PUBLIC/anon/authenticated and granted ONLY to
--    service_role. The ONLY legitimate caller is the Cloudflare Worker, which
--    uses the service-role key. A client must NOT be able to call consume_scan
--    (it would let them mint their own scan_events / bypass the token) nor
--    clawback (irrelevant to clients).
--  * consume_scan takes p_user_id explicitly (NOT auth.uid()) because the Worker
--    calls it with the SERVICE key — there is no end-user JWT in that request, so
--    auth.uid() would be NULL. The Worker has already verified the user's JWT via
--    /auth/v1/user and resolved the authoritative user_id before calling this, so
--    passing it as a parameter under the service role is correct and safe.
-- ================================================================


-- ----------------------------------------------------------------
-- 1. consume_scan — atomic allowance check + scan_event record.
--
-- Allowance = FREE_SCANS (3, kept in sync with client SCAN_LIMIT_FREE_USER /
-- WEB_SCAN_LIMIT_USER) + scan_credits.purchased. If the user is under allowance,
-- INSERT one scan_events row and return allowed=true; otherwise return
-- allowed=false and DO NOT record a scan.
--
-- CONCURRENCY (corrected 2026-06-26): a plpgsql function body is one transaction,
-- but under PostgreSQL's default READ COMMITTED isolation (which Supabase uses) a
-- SELECT-then-INSERT is NOT automatically atomic against a concurrent transaction —
-- each statement gets its own snapshot, so two concurrent /begin-scan calls for the
-- same user can BOTH read the same below-limit count (the first's uncommitted INSERT
-- is invisible to the second) and BOTH proceed, exceeding the allowance. An earlier
-- version of this comment falsely claimed "no TOCTOU window". We close the window with
-- a transaction-scoped, per-user advisory lock (pg_advisory_xact_lock below): the
-- second concurrent call for the SAME user blocks until the first commits, then sees
-- the committed row. The lock is keyed on the user id, so it never serializes
-- unrelated users. It auto-releases at transaction end (function return).
--
-- p_is_unlimited mirrors the client is_unlimited bypass (tester accounts via
-- app_metadata). When true we record the scan_event (so the usage graph stays
-- truthful) but ALWAYS return allowed=true regardless of count. The Worker
-- resolves is_unlimited from the verified JWT's app_metadata — a client cannot
-- forge it (app_metadata is server-controlled, not user_metadata).
--
-- Returns a jsonb object so the Worker can surface used/allowance in logs without
-- a second query: { allowed: bool, used: int, allowance: int }.
-- 'used' is the count AFTER this scan when allowed (so the client graph matches),
-- and the current count when denied.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_scan(
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
    -- No user — never allow (guests are gated client-side at 0 and never reach
    -- /begin-scan with a JWT; this is a defensive belt-and-braces deny).
    RETURN jsonb_build_object('allowed', false, 'used', 0, 'allowance', 0);
  END IF;

  -- Serialize concurrent check-then-insert FOR THIS USER (see CONCURRENCY note
  -- above). Transaction-scoped: auto-released on function return. hashtextextended
  -- maps the uuid text to the bigint key pg_advisory_xact_lock requires; the
  -- collision risk between two DIFFERENT users sharing a hash is harmless (it only
  -- briefly serializes two unrelated calls, never affects correctness).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Lifetime scans already used.
  SELECT count(*) INTO v_used
  FROM public.scan_events
  WHERE user_id = p_user_id;

  -- Purchased credits (0 when no row).
  SELECT coalesce(purchased, 0) INTO v_purchased
  FROM public.scan_credits
  WHERE user_id = p_user_id;
  v_purchased := coalesce(v_purchased, 0);

  v_allowance := v_free + v_purchased;

  IF p_is_unlimited THEN
    -- Tester bypass: record the scan but never block.
    INSERT INTO public.scan_events (user_id) VALUES (p_user_id);
    RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'allowance', -1);
  END IF;

  IF v_used >= v_allowance THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'allowance', v_allowance);
  END IF;

  -- Under allowance: record the scan in the same transaction and allow.
  INSERT INTO public.scan_events (user_id) VALUES (p_user_id);
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'allowance', v_allowance);
END;
$$;


-- ----------------------------------------------------------------
-- 2. clawback_scan_credits — remove credits on a refund/chargeback.
--
-- The RevenueCat webhook calls this for CANCELLATION/REFUND/EXPIRATION events so
-- a refunded purchase does not keep its credits (audit finding: scan_credits.
-- purchased was only ever incremented). Clamps at 0 (GREATEST) so we never violate
-- the scan_credits_purchased_non_negative CHECK (migration 006) and never go
-- negative even if the user already spent some credits.
--
-- Idempotent on event_id, exactly like add_scan_credits: a refund event is
-- recorded in revenuecat_events (ON CONFLICT DO NOTHING). A re-delivered refund
-- (same event.id) is a no-op. NOTE: a refund carries a DIFFERENT event.id from
-- the original purchase, so it does not collide with the purchase's dedupe row.
--
-- p_amount is the pack size to remove (the Worker maps product_id -> credits via
-- CREDIT_MAP, same as the grant). If the user's purchased balance is already
-- below p_amount (credits spent), we clamp to 0 rather than going negative —
-- accepting that already-consumed scans are not recoverable (the user got the
-- research; the refund removes only the unused remainder).
--
-- Returns true when a clawback was applied (first time we see this event), false
-- on a duplicate/retry.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clawback_scan_credits(
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
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_amount IS NULL THEN
    RETURN false;
  END IF;

  -- Claim the refund event id (dedupe). Reuse the same revenuecat_events ledger;
  -- store the amount as NEGATIVE so the ledger distinguishes a clawback from a grant.
  INSERT INTO public.revenuecat_events (event_id, user_id, product_id, amount)
  VALUES (p_event_id, p_user_id, NULL, -abs(p_amount))
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN false;  -- duplicate refund delivery — already clawed back
  END IF;

  -- Remove credits, clamped at 0 (never negative; honours the CHECK constraint).
  -- Only touches an existing row; if the user has no scan_credits row there is
  -- nothing purchased to claw back, so we no-op the UPDATE.
  UPDATE public.scan_credits
     SET purchased  = GREATEST(0, purchased - abs(p_amount)),
         updated_at = now()
   WHERE user_id = p_user_id;

  -- REFUND-ABUSE detection (audit 2026-06-26): the buy→drain→refund→repeat loop is
  -- not auto-blocked (deferred — needs a block flag + product decisions), but every
  -- clawback is durably recorded above (negative-amount ledger row) AND surfaced as
  -- a WARNING here with this user's lifetime refund count, so repeated refunds by one
  -- app_user_id are visible from Postgres logs / a one-line query without tailing.
  -- Detection query:
  --   SELECT user_id, count(*) AS refunds, sum(amount) AS total_clawed
  --   FROM public.revenuecat_events WHERE amount < 0 GROUP BY user_id
  --   HAVING count(*) > 1 ORDER BY refunds DESC;
  DECLARE
    v_refund_count integer;
  BEGIN
    SELECT count(*) INTO v_refund_count
    FROM public.revenuecat_events
    WHERE user_id = p_user_id AND amount < 0;
    IF v_refund_count > 1 THEN
      RAISE WARNING 'clawback: user % has now refunded % times (possible buy/drain/refund abuse)', p_user_id, v_refund_count;
    END IF;
  END;

  RETURN true;
END;
$$;


-- ----------------------------------------------------------------
-- 3. Lock down EXECUTE on both functions (mirror migrations 016/017).
-- service_role retains EXECUTE implicitly (bypasses GRANT checks); make it explicit.
-- Scope each REVOKE/GRANT strictly to its exact signature.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.consume_scan(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_scan(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_scan(uuid, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_scan(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.clawback_scan_credits(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clawback_scan_credits(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clawback_scan_credits(uuid, integer, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.clawback_scan_credits(uuid, integer, text) TO service_role;


-- ================================================================
-- VERIFICATION (run after; each confirms a piece of the fix).
-- ================================================================

-- 1. Both functions exist and are SECURITY DEFINER.
--    Expect: two rows, prosecdef = true for both.
-- SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
-- FROM pg_proc WHERE proname IN ('consume_scan', 'clawback_scan_credits');

-- 2. Neither is executable by anon/authenticated (only service_role + owner).
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_name IN ('consume_scan', 'clawback_scan_credits')
-- ORDER BY routine_name, grantee;

-- 3. Smoke-test consume_scan against a real test user (replace the uuid).
--    A fresh user with no purchased credits: first 3 calls allowed=true, 4th false.
--    Each allowed call adds one scan_events row.
-- SELECT public.consume_scan('<a-real-user-uuid>'::uuid, false);   -- allowed:true used:1 allowance:3
-- ... (run 3x) ... 4th:
-- SELECT public.consume_scan('<a-real-user-uuid>'::uuid, false);   -- allowed:false used:3 allowance:3
--    is_unlimited bypass always allows:
-- SELECT public.consume_scan('<a-real-user-uuid>'::uuid, true);    -- allowed:true allowance:-1
--    Cleanup: DELETE FROM public.scan_events WHERE user_id = '<a-real-user-uuid>';

-- 4. Smoke-test clawback (replace uuid; assumes a scan_credits row exists):
-- SELECT public.add_scan_credits('<uuid>'::uuid, 20, 'evt_buy_1');     -- grant 20
-- SELECT public.clawback_scan_credits('<uuid>'::uuid, 20, 'evt_refund_1'); -- true, purchased back to (>=0)
-- SELECT public.clawback_scan_credits('<uuid>'::uuid, 20, 'evt_refund_1'); -- false (duplicate)
-- SELECT purchased FROM public.scan_credits WHERE user_id = '<uuid>';  -- clamped, never negative
--    Cleanup: DELETE FROM public.revenuecat_events WHERE event_id IN ('evt_buy_1','evt_refund_1');

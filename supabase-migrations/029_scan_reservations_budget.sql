-- ================================================================
-- 029_scan_reservations_budget.sql
-- THE real server-side cost control (S78). Makes the per-scan token a HARD limit on
-- paid-call VOLUME, not just entry — so flipping SCAN_TOKEN_ENFORCE=true actually
-- protects the prepaid Tavily/Gemini pools.
--
-- WHY (adversarial review, 2026-06-26): every stateless-token design (026 record-at-
-- begin, the rejected /refund-scan, the 028 check/commit split) leaks because one
-- token authorizes UNBOUNDED paid calls for its TTL, and check/commit additionally
-- let a never-committing client stay at used=0 and mint unlimited tokens. The fix is
-- a per-scan RESERVATION that (a) holds an allowance slot the instant it is minted
-- (bounds token MINTING) and (b) carries finite per-route call budgets decremented
-- atomically on every paid call (bounds VOLUME).
--
-- A reservation is a TIME-BOXED hold, NOT a permanent scan_event: it counts toward
-- allowance only while pending AND unexpired, so an abandoned/failed scan stops
-- consuming allowance automatically after its TTL — "a failed scan costs nothing"
-- with no client-triggerable delete (the property the refund design tried and failed
-- to get safely). The durable charge (scan_event) is written only at commit.
--
-- Supersedes migration 028's check_scan_allowance + commit_scan (dropped at bottom).
-- scan_events + scan_credits tables are UNTOUCHED; scan_events stays the authoritative
-- lifetime counter (Settings graph, account-deletion cleanup).
--
-- Paste into the Supabase SQL editor and run AFTER 026 and 028. Idempotent.
--
-- SECURITY: all three RPCs SECURITY DEFINER, EXECUTE service_role-only (mirror 026);
-- the table has RLS ENABLED with NO policies, so anon/authenticated cannot touch it.
-- The Worker (service-role key) is the only caller, after JWT verification.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. scan_reservations — in-flight per-scan hold + call budget.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scan_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','committed','expired')),
  gemini_remaining integer NOT NULL,
  tavily_remaining integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  committed_at     timestamptz
);

-- The allowance query filters (user_id, status, expires_at); index it.
CREATE INDEX IF NOT EXISTS scan_reservations_user_active
  ON public.scan_reservations (user_id, status, expires_at);

ALTER TABLE public.scan_reservations ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: anon/authenticated get zero access (RLS default-deny).
-- service_role bypasses RLS. Mirrors the SECURITY-DEFINER-RPC-only posture of 026.


-- ----------------------------------------------------------------
-- 2. reserve_scan — allowance check (counting live pending holds) + INSERT a
--    reservation. Bounds MINTING: a pending reservation holds an allowance slot
--    until it commits or its TTL passes, so a user at allowance can't mint another.
--    Advisory-locked per-user so two concurrent begins can't both pass the boundary.
--    Budgets default 8 Gemini / 12 Tavily, with headroom over the real worst case:
--    Gemini = 3 logical scan-window calls (symbol-resolution, biography, mentions),
--    EACH of which fires a 2nd /gemini request to the fallback model on 503/429/
--    overload → up to 6; 8 leaves margin. Tavily = up to 6 search + 2 extract = 8;
--    12 leaves margin. A legitimate scan never 402s; an abused token is still bounded
--    to one scan's spend. (Worker passes these explicitly; defaults must match.)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_scan(
  p_user_id      uuid,
  p_is_unlimited boolean DEFAULT false,
  p_ttl_seconds  integer DEFAULT 600,
  p_gemini       integer DEFAULT 8,
  p_tavily       integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free      constant integer := 3;   -- keep in sync with client free-scan limit
  v_committed integer;
  v_pending   integer;
  v_used      integer;
  v_purchased integer;
  v_allowance integer;
  v_now       timestamptz := now();
  v_expires   timestamptz := now() + make_interval(secs => p_ttl_seconds);
  v_id        uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'used', 0, 'allowance', 0);
  END IF;

  -- Serialize check-then-insert per user (same proven pattern as 026's lock). A
  -- second concurrent begin for the SAME user blocks until the first inserts its
  -- pending row, then counts it below → cannot double-mint at the allowance boundary.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Opportunistic age-out: mark this user's stale pending rows expired so they stop
  -- counting toward allowance AND so an in-flight-but-expired token's next
  -- consume_budget rejects. (Correctness does not depend on this — the count below
  -- also filters expires_at > now — but it keeps the table's status truthful.)
  UPDATE public.scan_reservations
     SET status = 'expired'
   WHERE user_id = p_user_id AND status = 'pending' AND expires_at <= v_now;

  SELECT count(*) INTO v_committed
    FROM public.scan_events WHERE user_id = p_user_id;

  SELECT count(*) INTO v_pending
    FROM public.scan_reservations
   WHERE user_id = p_user_id AND status = 'pending' AND expires_at > v_now;

  SELECT coalesce(purchased, 0) INTO v_purchased
    FROM public.scan_credits WHERE user_id = p_user_id;
  v_purchased := coalesce(v_purchased, 0);

  v_used      := v_committed + v_pending;   -- live pending holds count as used
  v_allowance := v_free + v_purchased;

  IF NOT p_is_unlimited AND v_used >= v_allowance THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'allowance', v_allowance);
  END IF;

  INSERT INTO public.scan_reservations
    (user_id, status, gemini_remaining, tavily_remaining, expires_at)
  VALUES (p_user_id, 'pending', p_gemini, p_tavily, v_expires)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', v_id,
    'expires_at', extract(epoch FROM v_expires)::bigint,
    'used', v_committed,                                  -- report COMMITTED count to the client UI
    'allowance', CASE WHEN p_is_unlimited THEN -1 ELSE v_allowance END
  );
END;
$$;


-- ----------------------------------------------------------------
-- 3. consume_budget — atomic per-route decrement-or-fail (the hot path, once per
--    paid proxy call). Bounds VOLUME. No advisory lock needed: a single-row
--    conditional UPDATE ... RETURNING is an atomic read-modify-write under READ
--    COMMITTED (concurrent decrements serialize on the row lock, each re-evaluates
--    `remaining > 0` against the latest committed value — no lost update, so two
--    callers can never both decrement past zero). This is exactly what KV cannot do.
--    Returns { ok, remaining } or { ok:false, reason }. ok:false → the Worker 402s.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_budget(
  p_reservation_id uuid,
  p_user_id        uuid,    -- from the token; asserts ownership (defense in depth)
  p_route          text     -- 'gemini' | 'tavily'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF p_reservation_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  IF p_route = 'gemini' THEN
    UPDATE public.scan_reservations
       SET gemini_remaining = gemini_remaining - 1
     WHERE id = p_reservation_id
       AND user_id = p_user_id
       AND status  = 'pending'
       AND expires_at > now()
       AND gemini_remaining > 0
     RETURNING gemini_remaining INTO v_remaining;
  ELSIF p_route = 'tavily' THEN
    UPDATE public.scan_reservations
       SET tavily_remaining = tavily_remaining - 1
     WHERE id = p_reservation_id
       AND user_id = p_user_id
       AND status  = 'pending'
       AND expires_at > now()
       AND tavily_remaining > 0
     RETURNING tavily_remaining INTO v_remaining;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_route');
  END IF;

  IF NOT FOUND THEN
    -- Row missing / wrong user / expired / committed / budget exhausted → all 402.
    RETURN jsonb_build_object('ok', false, 'reason', 'no_budget');
  END IF;

  RETURN jsonb_build_object('ok', true, 'remaining', v_remaining);
END;
$$;


-- ----------------------------------------------------------------
-- 4. commit_reservation — flip pending → committed + write the durable scan_event.
--    The pending row ALREADY held the allowance slot (reserve_scan enforced the
--    limit at mint time), so no re-check is needed — this is just the state flip +
--    permanent record. Idempotent: a retry finds status != 'pending' → NOT FOUND →
--    committed:false, and the scan_event was already written, so no double-charge.
--    Commit is allowed even slightly past expires_at (the bio was produced; the hold
--    already capped the allowance, so converting it can't exceed the limit).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_reservation(
  p_reservation_id uuid,
  p_user_id        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
BEGIN
  IF p_reservation_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'bad_args');
  END IF;

  -- Atomically claim the pending reservation (idempotent on retry).
  UPDATE public.scan_reservations
     SET status = 'committed', committed_at = now()
   WHERE id = p_reservation_id
     AND user_id = p_user_id
     AND status  = 'pending'
  RETURNING id INTO v_claimed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'not_pending');
  END IF;

  -- Convert the hold into the permanent lifetime record.
  INSERT INTO public.scan_events (user_id) VALUES (p_user_id);

  RETURN jsonb_build_object('committed', true);
END;
$$;


-- ----------------------------------------------------------------
-- 5. Lock down EXECUTE (service_role only; mirror 026).
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reserve_scan(uuid, boolean, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_scan(uuid, boolean, integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_scan(uuid, boolean, integer, integer, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_scan(uuid, boolean, integer, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_budget(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_budget(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_budget(uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_budget(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.commit_reservation(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_reservation(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_reservation(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.commit_reservation(uuid, uuid) TO service_role;


-- ----------------------------------------------------------------
-- 6. Supersede the prior metering RPCs (all replaced by reserve_scan +
--    consume_budget + commit_reservation). IF EXISTS makes this safe regardless of
--    which earlier migrations actually ran:
--      • 026's consume_scan — dropped here too, in case 028 (which also drops it) was
--        SKIPPED and the owner ran 026 → 029 directly. Otherwise it lingers as
--        service-role-only dead code the worker no longer calls.
--      • 028's check_scan_allowance + commit_scan.
--    End state is identical for any run order (026→029, 026→028→029).
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.consume_scan(uuid, boolean);
DROP FUNCTION IF EXISTS public.check_scan_allowance(uuid, boolean);
DROP FUNCTION IF EXISTS public.commit_scan(uuid, boolean);


-- ================================================================
-- VERIFICATION (optional; disposable auth user, self-cleans).
-- ================================================================
-- DO $$
-- DECLARE v_uid uuid := gen_random_uuid(); r jsonb; v_resv uuid; v_n int; d jsonb;
-- BEGIN
--   INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
--   VALUES (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
--           'verify+'||v_uid::text||'@example.invalid', now(), now());
--
--   -- reserve holds allowance; 3 reserves allowed, 4th denied (none committed yet)
--   r := public.reserve_scan(v_uid, false); v_resv := (r->>'reservation_id')::uuid;
--   RAISE NOTICE '% : reserve #1 allowed (allowed=% used=%)', CASE WHEN (r->>'allowed')::bool AND (r->>'used')::int=0 THEN 'PASS' ELSE 'FAIL' END, r->>'allowed', r->>'used';
--   PERFORM public.reserve_scan(v_uid, false);
--   PERFORM public.reserve_scan(v_uid, false);
--   r := public.reserve_scan(v_uid, false);   -- 4th: 3 live pending holds == allowance
--   RAISE NOTICE '% : reserve #4 DENIED by pending holds (allowed=% used=%)', CASE WHEN NOT (r->>'allowed')::bool AND (r->>'used')::int=3 THEN 'PASS' ELSE 'FAIL' END, r->>'allowed', r->>'used';
--
--   -- consume_budget: gemini bounded at 8, then 402
--   FOR i IN 1..8 LOOP d := public.consume_budget(v_resv, v_uid, 'gemini'); END LOOP;
--   RAISE NOTICE '% : 8th gemini ok, remaining 0 (ok=% remaining=%)', CASE WHEN (d->>'ok')::bool AND (d->>'remaining')::int=0 THEN 'PASS' ELSE 'FAIL' END, d->>'ok', d->>'remaining';
--   d := public.consume_budget(v_resv, v_uid, 'gemini');   -- 9th exhausted
--   RAISE NOTICE '% : 9th gemini exhausted (ok=% reason=%)', CASE WHEN NOT (d->>'ok')::bool THEN 'PASS' ELSE 'FAIL' END, d->>'ok', d->>'reason';
--   d := public.consume_budget(v_resv, gen_random_uuid(), 'gemini');  -- wrong user
--   RAISE NOTICE '% : wrong-user decrement rejected (ok=%)', CASE WHEN NOT (d->>'ok')::bool THEN 'PASS' ELSE 'FAIL' END, d->>'ok';
--
--   -- commit converts the hold to a scan_event; idempotent
--   d := public.commit_reservation(v_resv, v_uid);
--   RAISE NOTICE '% : commit #1 (committed=%)', CASE WHEN (d->>'committed')::bool THEN 'PASS' ELSE 'FAIL' END, d->>'committed';
--   d := public.commit_reservation(v_resv, v_uid);   -- retry no-op
--   RAISE NOTICE '% : commit retry no-op (committed=%)', CASE WHEN NOT (d->>'committed')::bool THEN 'PASS' ELSE 'FAIL' END, d->>'committed';
--   SELECT count(*) INTO v_n FROM public.scan_events WHERE user_id = v_uid;
--   RAISE NOTICE '% : exactly 1 scan_event recorded (got %)', CASE WHEN v_n=1 THEN 'PASS' ELSE 'FAIL' END, v_n;
--
--   DELETE FROM auth.users WHERE id = v_uid;   -- cascade cleans reservations + events
-- END $$;
-- SELECT routine_name, grantee, privilege_type FROM information_schema.role_routine_grants
-- WHERE routine_name IN ('reserve_scan','consume_budget','commit_reservation') ORDER BY routine_name, grantee;

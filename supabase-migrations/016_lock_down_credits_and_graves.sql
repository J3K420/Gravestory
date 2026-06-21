-- ================================================================
-- 016_lock_down_credits_and_graves.sql
-- Closes two client-reachable write holes found in the 2026-06-20 code review.
-- Paste into the Supabase SQL editor and run. Idempotent — safe to re-run.
--
-- H1: public.add_scan_credits(uuid, integer) is SECURITY DEFINER but EXECUTE is
--     granted to PUBLIC by default, so ANY client (anon/authenticated) can call it
--     via PostgREST RPC and grant itself unlimited scan credits — defeating the
--     sole cost control. The ONLY legitimate caller is the Cloudflare Worker
--     RevenueCat webhook (worker/worker.js), which uses the service-role key and
--     therefore is UNAFFECTED by these REVOKEs.
--
-- H2: the "graves_make_public" UPDATE policy on public.graves uses USING (TRUE),
--     letting any authenticated user PATCH ANY grave row (name/lat/lng/marker_style)
--     as long as the result has is_public = TRUE — bypassing the first-wins guards
--     that live inside the SECURITY DEFINER RPCs. There are ZERO direct
--     `.from('graves').update(...)` calls in the web or mobile code; all grave
--     writes go through find_or_create_grave / update_grave_location / the marker
--     RPC, which run as the function owner and do not depend on this policy.
--     Dropping the policy removes the attack surface with no legitimate caller lost.
-- ================================================================

-- ----------------------------------------------------------------
-- H1. Revoke client EXECUTE on add_scan_credits.
-- Scope STRICTLY to the (uuid, integer) signature. Do NOT touch other public
-- SECURITY DEFINER RPCs (find_grave, find_or_create_grave, set_grave_marker,
-- update_grave_location, global_public_stories) — they MUST stay callable by
-- anon/authenticated or the global map, save pipeline, marker staking, and bio
-- cache break on both web and mobile.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer) FROM authenticated;

-- service_role retains EXECUTE implicitly (it bypasses GRANT checks), so the
-- Worker webhook continues to work. Make the intent explicit and self-documenting:
GRANT EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer) TO service_role;


-- ----------------------------------------------------------------
-- H2. Drop the over-permissive graves UPDATE policy.
-- The SECURITY DEFINER RPCs that write graves run as the table owner and bypass
-- RLS, so they do NOT need this policy. After the drop there is no client UPDATE
-- path to public.graves, which is the intended state (writes are RPC-only).
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "graves_make_public" ON public.graves;


-- ================================================================
-- VERIFICATION (run these after; each should confirm the lockdown).
-- ================================================================

-- 1. add_scan_credits should NOT be executable by anon/authenticated.
--    Expect: only 'service_role' (and the owner role) appear, NOT anon/authenticated/PUBLIC.
-- SELECT grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_name = 'add_scan_credits';

-- 2. graves should have NO UPDATE policy left (SELECT policy "graves_select" stays).
--    Expect: one row, cmd = 'SELECT', policyname = 'graves_select'. No 'graves_make_public'.
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'graves';

-- 3. Sanity: the grave-writing RPCs still exist and are still SECURITY DEFINER
--    (so they keep working after the policy drop).
--    Expect: prosecdef = true for each.
-- SELECT proname, prosecdef
-- FROM pg_proc
-- WHERE proname IN ('find_or_create_grave', 'update_grave_location', 'add_scan_credits');

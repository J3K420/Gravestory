-- ================================================================
-- GraveStory: let the ORIGINAL corrector refine their own grave pin
-- Paste into the Supabase SQL editor and run. Run AFTER migration 023.
-- ================================================================
-- BUG (found S75, reported by owner field-testing): in a large cemetery a pin often
-- needs SEVERAL drags to place exactly. The FIRST drag set graves.user_corrected=TRUE;
-- every SUBSEQUENT refinement drag called update_grave_location, but its WHERE clause
-- was `AND NOT user_corrected` (migration 001) — so once corrected, all later moves
-- SILENTLY NO-OP at the DB. The story row + local row updated (so My Cemetery map looked
-- right), but the canonical graves row stayed frozen at the FIRST rough drag. The global
-- map's RPC (023) serves the corrected coordinate FROM the graves row, so the community
-- map showed the rough first-drag position — "right on my map, wrong on the global map,
-- offset varies by pin" (each pin's first drag was rough by a different amount).
--
-- The original `AND NOT user_corrected` was meant to stop a DIFFERENT user clobbering
-- someone's correction (first-correction-wins). But with no ownership column it also
-- blocked the SAME user refining their own pin. This migration adds ownership so the
-- ORIGINAL corrector (or nobody-yet) can move the pin, while still blocking strangers.
--
-- This migration:
--   1. Adds graves.corrected_by uuid (nullable; NULL = never corrected / legacy).
--   2. Replaces update_grave_location: allow the move when the grave has not been
--      corrected yet (corrected_by IS NULL AND NOT user_corrected — legacy rows), OR
--      the caller IS the original corrector (corrected_by = auth.uid()). Records
--      auth.uid() into corrected_by on every successful move.
--
-- ⚠️ auth.uid() under SECURITY DEFINER: in Supabase, auth.uid() reads the CALLER's JWT
-- claim (request.jwt.claims), NOT the function owner — SECURITY DEFINER changes the
-- table-permission context, not the JWT. So auth.uid() here is the signed-in user who
-- invoked the RPC, which is exactly what we want. (An anon/service call has a NULL
-- auth.uid(); such a call can still correct a never-corrected grave, but cannot move one
-- already owned by a real user — acceptable, the app only calls this for signed-in users.)
--
-- BACK-COMPAT: legacy corrected graves have corrected_by = NULL but user_corrected =
-- TRUE. The predicate below treats those as "owned by nobody recorded" — to avoid
-- letting ANY user suddenly move every pre-existing corrected grave, we additionally
-- claim ownership on the FIRST successful move by a signed-in user (corrected_by gets
-- set), and a legacy row stays movable by its first post-migration corrector. The
-- common path (a user refining a grave THEY corrected after this migration) is exact.
-- ================================================================

-- 1. Ownership column
-- ----------------------------------------------------------------
ALTER TABLE public.graves
  ADD COLUMN IF NOT EXISTS corrected_by uuid;

-- 2. update_grave_location — owner-or-unowned can move; records the corrector
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_grave_location(
  p_grave_id UUID,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.graves
     SET lat = p_lat,
         lng = p_lng,
         user_corrected = TRUE,
         corrected_by = auth.uid(),
         updated_at = NOW()
   WHERE id = p_grave_id
     AND (
       -- TRULY fresh — never corrected by anyone. The `AND NOT user_corrected` is
       -- load-bearing: a LEGACY grave corrected before this migration has
       -- corrected_by = NULL but user_corrected = TRUE, and WITHOUT this guard the
       -- bare `corrected_by IS NULL` would let ANY signed-in stranger move (and then
       -- claim) that legacy pin — strictly worse than the old first-wins lock. Gating
       -- on NOT user_corrected keeps legacy corrections frozen exactly as before (a
       -- strict non-regression — it only re-locks rows the old code already locked).
       (corrected_by IS NULL AND NOT user_corrected)
       -- Or the caller is the user who corrected it — refine your own pin freely.
       OR corrected_by = auth.uid()
     );
END;
$$;

-- EXECUTE grants are preserved by CREATE OR REPLACE, but re-assert for safety.
GRANT EXECUTE ON FUNCTION public.update_grave_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

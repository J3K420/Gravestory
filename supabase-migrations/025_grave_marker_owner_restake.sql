-- ================================================================
-- GraveStory: let the ORIGINAL marker-staker re-pick their own grave pin
-- Paste into the Supabase SQL editor and run. Run AFTER migration 024.
-- ================================================================
-- BUG (reported by owner): picked a custom marker on a saved/public story →
-- the community global map showed it (good). Changed the marker to a DIFFERENT
-- style on the SAME story → the global map STILL showed the FIRST pin, even
-- after a full app restart (so not the 5-min client cache).
--
-- ROOT CAUSE — the SAME first-wins-with-no-owner-exemption class migration 024
-- fixed for location drags, here for the marker:
--   • The community pin is served from the GRAVES row: global_public_stories
--     returns g.marker_style (migration 023, line ~97), NOT the story's
--     s.marker_style.
--   • set_grave_marker (migration 011) stakes it under `WHERE id = p_grave_id
--     AND marker_style IS NULL`. The FIRST pick (grave NULL → styleA) succeeds.
--     The SECOND pick updates the STORY row fine (so My Cemetery map looks
--     right), but set_grave_marker's `AND marker_style IS NULL` is now FALSE
--     → it matches ZERO rows and silently no-ops. The grave stays styleA, so
--     the global map (reading g.marker_style) is frozen on the first choice.
--
-- The original `AND marker_style IS NULL` was meant to stop a DIFFERENT user
-- clobbering the grave's permanent marker (the marker-pack first-wins design).
-- But with no ownership column it ALSO blocked the same user re-picking their
-- own pin. This migration adds ownership so the ORIGINAL staker (or nobody-yet)
-- can re-stake, while still blocking strangers — exactly the owner/unowned-vs-
-- stranger distinction migration 024 established for location corrections.
--
-- ⚠️ auth.uid() under SECURITY DEFINER reads the CALLER's JWT (request.jwt.claims),
-- not the function owner — same as migration 024. The app only calls this for
-- signed-in users; an anon/service call has a NULL auth.uid() and can still stake
-- a never-staked grave but cannot move one already owned by a real user.
--
-- LEGACY HANDLING (owner decision, 2026-06-25): unlike migration 024 — which
-- kept legacy *corrected* graves strictly frozen — a legacy *staked* grave here
-- (marker_style IS NOT NULL but marker_set_by IS NULL, i.e. staked before this
-- ownership column existed) is CLAIMABLE by the first person who re-picks it,
-- which records them as owner. This is the deliberately more permissive choice:
--   (a) a marker glyph is lower-stakes than a coordinate, and
--   (b) it un-freezes the owner's existing pins that predate this column (which
--       is the very pin this bug report is about).
-- The app only calls set_grave_marker for signed-in users picking on their OWN
-- saved story, so "first re-pick claims it" is in practice the story's owner.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Safe to re-run.
-- No read-side change needed — global_public_stories already serves g.marker_style;
-- once the owner's re-pick moves the graves row, the community map follows.
-- ================================================================

-- 1. Ownership column
-- ----------------------------------------------------------------
ALTER TABLE public.graves
  ADD COLUMN IF NOT EXISTS marker_set_by uuid;

-- 2. find_or_create_grave — record the staker when the INSERT branch stakes a marker
-- ----------------------------------------------------------------
-- The mobile save path stakes the marker HERE (the grave is created with the
-- user's chosen style at save time), NOT via set_grave_marker. Without recording
-- marker_set_by on this INSERT, every newly-created staked grave would have
-- marker_set_by = NULL — which the "legacy claimable" clause in set_grave_marker
-- (step 3) would then let ANY stranger re-pick, weakening first-wins for all NEW
-- graves. Record auth.uid() so a freshly-created grave is properly OWNED, and the
-- claimable-legacy path applies ONLY to graves staked before this migration.
-- The reuse branch never touches marker_style/marker_set_by (first-wins preserved).
-- Signature is unchanged (5 args), so a plain CREATE OR REPLACE is sufficient.
CREATE OR REPLACE FUNCTION public.find_or_create_grave(
  p_name         TEXT,
  p_lat          DOUBLE PRECISION,
  p_lng          DOUBLE PRECISION,
  p_is_public    BOOLEAN DEFAULT FALSE,
  p_marker_style TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- ~20 m bounding box: 0.00018° lat ≈ 20 m; 0.00025° lng ≈ 20 m at mid-latitudes
  SELECT id INTO v_id
  FROM public.graves
  WHERE lat BETWEEN p_lat - 0.00018 AND p_lat + 0.00018
    AND lng BETWEEN p_lng - 0.00025 AND p_lng + 0.00025
    AND lower(trim(name)) = lower(trim(p_name))
  ORDER BY (lat - p_lat)^2 + (lng - p_lng)^2
  LIMIT 1;

  IF v_id IS NULL THEN
    -- Stake the marker AND record its owner on create, so first-wins is owned
    -- (not NULL-owned and stranger-claimable). marker_set_by is left NULL only
    -- when no style was passed, which is harmless (an unstaked grave).
    INSERT INTO public.graves (name, lat, lng, is_public, marker_style, marker_set_by)
    VALUES (
      p_name, p_lat, p_lng, p_is_public, p_marker_style,
      CASE WHEN p_marker_style IS NOT NULL THEN auth.uid() ELSE NULL END
    )
    RETURNING id INTO v_id;
  ELSIF p_is_public THEN
    UPDATE public.graves
       SET is_public = TRUE, updated_at = NOW()
     WHERE id = v_id AND NOT is_public;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_grave(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT) TO authenticated;

-- 3. set_grave_marker — owner-or-unstaked can stake/re-pick; records the staker
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_grave_marker(
  p_grave_id     UUID,
  p_marker_style TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_grave_id IS NULL OR p_marker_style IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.graves
     SET marker_style  = p_marker_style,
         marker_set_by = auth.uid(),
         updated_at    = NOW()
   WHERE id = p_grave_id
     AND (
       -- Never staked by anyone — original first-wins stake (applies to strangers).
       marker_style IS NULL
       -- Legacy: staked before this ownership column existed (marker_set_by NULL).
       -- Owner decision: claimable by the first post-migration re-pick, which then
       -- records ownership. Un-freezes the owner's pre-column pins (this bug).
       OR marker_set_by IS NULL
       -- The original staker re-picks their own pin freely.
       OR marker_set_by = auth.uid()
     );
END;
$$;

-- EXECUTE grants are preserved by CREATE OR REPLACE, but re-assert for safety.
GRANT EXECUTE ON FUNCTION public.set_grave_marker(UUID, TEXT) TO authenticated;

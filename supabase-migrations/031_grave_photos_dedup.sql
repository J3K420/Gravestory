-- ════════════════════════════════════════════════════════════════════════
-- Migration 031 — grave_photos: one photo per user per grave
-- ════════════════════════════════════════════════════════════════════════
-- BUG: grave_photos had no uniqueness constraint, and ResultScreen inserted a
-- fresh row on EVERY save. Re-scanning/re-saving the same grave (common during
-- testing) piled up duplicate rows, so the global-map bio gallery showed the
-- same stone 10× (e.g. Amy Winehouse). The pool is meant to collect DIFFERENT
-- people's photos of one stone — not let a single user spam repeats.
--
-- FIX: collapse to one photo per (grave_id, user_id) — keep the NEWEST row per
-- pair, delete the older dupes, then add a UNIQUE(grave_id, user_id) so it can't
-- recur. Mirrors how `tributes` already enforces UNIQUE(grave_id, user_id).
-- The mobile writer switches insert → upsert on this constraint (separate change).
--
-- ⚠ DELETES rows. Re-runnable: the DELETE is a no-op once deduped, and the
-- ADD CONSTRAINT is guarded so a second run won't error.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Delete older duplicate photos, keeping the most recent per (grave_id, user_id).
--    Ties on created_at are broken by id so exactly one row survives per pair.
DELETE FROM public.grave_photos gp
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY grave_id, user_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.grave_photos
) ranked
WHERE gp.id = ranked.id
  AND ranked.rn > 1;

-- 2. Enforce one photo per user per grave going forward (idempotent add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'grave_photos_grave_user_uniq'
      AND conrelid = 'public.grave_photos'::regclass
  ) THEN
    ALTER TABLE public.grave_photos
      ADD CONSTRAINT grave_photos_grave_user_uniq UNIQUE (grave_id, user_id);
  END IF;
END $$;

-- 3. The mobile writer now UPSERTs on the constraint above (insert → update of
--    the user's own row on re-save). RLS originally had only SELECT + INSERT
--    policies, so the upsert's UPDATE path would be silently DENIED. Add a
--    FOR UPDATE policy scoped to the owner so a re-save can replace the user's
--    own photo (USING gates which rows are visible to update; WITH CHECK gates
--    the new values — both pinned to auth.uid() = user_id so you can only ever
--    touch your own row). Idempotent.
DROP POLICY IF EXISTS "grave_photos_update" ON public.grave_photos;
CREATE POLICY "grave_photos_update"
  ON public.grave_photos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Verify (optional): should return zero rows after the migration.
--   SELECT grave_id, user_id, count(*)
--   FROM public.grave_photos GROUP BY 1, 2 HAVING count(*) > 1;

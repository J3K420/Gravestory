-- ════════════════════════════════════════════════════════════════════════
-- Migration 033 — consolidate fragmented grave rows (one-off cleanup)
-- ════════════════════════════════════════════════════════════════════════
-- Migration 032 stops NEW fragmentation; this consolidates rows that ALREADY
-- fragmented (e.g. the Amy Winehouse / Cynthia Levy shared stone exists as 3
-- grave rows 0–1 m apart, named with flipped order / a bare subset). For each
-- cluster of graves that share the order-insensitive name key (_grave_name_key)
-- AND sit within the same ~20 m box as a cluster anchor, pick ONE canonical
-- survivor and re-point every child row (stories, grave_photos, tributes,
-- content_reports) to it, then delete the losers.
--
-- Canonical pick: most stories wins (ties → oldest created_at, then smallest id).
--
-- CLUSTERING (anchor-relative distance, NOT a fixed grid): an earlier grid-bucket
-- version could drop two graves 1 m apart into different cells when they straddle
-- a grid line — silently MISSING the very rows it targets. Instead, per name key,
-- the top-ranked grave is the anchor and any same-key grave within the SAME 20 m
-- box (±0.00018 lat / ±0.00025 lng) as that anchor joins its cluster — matching
-- find_or_create_grave's matcher exactly.
--
-- DEDUP DURING MERGE: grave_photos and tributes have UNIQUE(grave_id,user_id).
-- After re-pointing, a user with a row on ANY TWO graves in a cluster (two losers,
-- or a loser + the survivor) collides. We keep exactly ONE row per (survivor,
-- user) across the WHOLE cluster (survivor's own row preferred, else newest) and
-- delete the rest BEFORE re-pointing — so the re-point can never violate the key.
--
-- ⚠ DELETES rows and re-points FKs. Single transaction = all-or-nothing.
-- Re-runnable: once consolidated, no cluster has >1 grave and it is a no-op.
-- Run AFTER migration 032 (depends on _grave_name_key).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Map each loser grave → its cluster survivor.
--    Anchor = highest-ranked grave per name key (most stories, then oldest, then
--    smallest id). A grave maps to that anchor when it shares the name key AND
--    lies within the anchor's ~20 m box. NULL/empty name keys are excluded so
--    nameless graves never cluster together.
CREATE TEMP TABLE _grave_merge_map ON COMMIT DROP AS
WITH g AS (
  SELECT
    id, lat, lng, created_at,
    public._grave_name_key(name) AS name_key,
    (SELECT count(*) FROM public.stories s WHERE s.grave_id = graves.id) AS story_count
  FROM public.graves
  WHERE public._grave_name_key(name) IS NOT NULL
    AND public._grave_name_key(name) <> ''
),
anchors AS (
  -- one anchor row per name key
  SELECT DISTINCT ON (name_key) name_key, id AS anchor_id, lat AS alat, lng AS alng
  FROM g
  ORDER BY name_key, story_count DESC, created_at ASC, id ASC
)
SELECT g.id AS loser_id, a.anchor_id AS survivor_id
FROM g
JOIN anchors a
  ON a.name_key = g.name_key
 AND g.lat BETWEEN a.alat - 0.00018 AND a.alat + 0.00018
 AND g.lng BETWEEN a.alng - 0.00025 AND a.alng + 0.00025
WHERE g.id <> a.anchor_id;   -- losers only (anchor maps to itself → excluded)

-- 2. grave_photos: keep ONE row per (survivor, user) across the whole cluster,
--    delete the rest, THEN re-point. Partition spans the survivor + all its
--    losers (via coalesce(survivor_id, grave_id)); the survivor's own row is
--    preferred (m.survivor_id IS NULL ranks first), else newest.
WITH scope AS (
  SELECT gp.id, gp.user_id, gp.created_at,
         coalesce(m.survivor_id, gp.grave_id) AS eff_grave,
         (m.survivor_id IS NULL) AS is_survivor_row
  FROM public.grave_photos gp
  LEFT JOIN _grave_merge_map m ON gp.grave_id = m.loser_id
  WHERE m.loser_id IS NOT NULL
     OR gp.grave_id IN (SELECT survivor_id FROM _grave_merge_map)
),
ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY eff_grave, user_id
           ORDER BY is_survivor_row DESC, created_at DESC, id DESC
         ) AS rn
  FROM scope
)
DELETE FROM public.grave_photos WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE public.grave_photos gp
SET grave_id = m.survivor_id
FROM _grave_merge_map m
WHERE gp.grave_id = m.loser_id;

-- 3. tributes: identical dedup + re-point.
WITH scope AS (
  SELECT t.id, t.user_id, t.created_at,
         coalesce(m.survivor_id, t.grave_id) AS eff_grave,
         (m.survivor_id IS NULL) AS is_survivor_row
  FROM public.tributes t
  LEFT JOIN _grave_merge_map m ON t.grave_id = m.loser_id
  WHERE m.loser_id IS NOT NULL
     OR t.grave_id IN (SELECT survivor_id FROM _grave_merge_map)
),
ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY eff_grave, user_id
           ORDER BY is_survivor_row DESC, created_at DESC, id DESC
         ) AS rn
  FROM scope
)
DELETE FROM public.tributes WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE public.tributes t
SET grave_id = m.survivor_id
FROM _grave_merge_map m
WHERE t.grave_id = m.loser_id;

-- 4. stories: no uniqueness on grave_id → plain re-point.
UPDATE public.stories s
SET grave_id = m.survivor_id
FROM _grave_merge_map m
WHERE s.grave_id = m.loser_id;

-- 4b. content_reports.grave_id is ON DELETE SET NULL — without this re-point the
--     step-5 grave DELETE would silently NULL a report's grave link instead of
--     moving it to the survivor. No uniqueness on grave_id → plain UPDATE.
UPDATE public.content_reports r
SET grave_id = m.survivor_id
FROM _grave_merge_map m
WHERE r.grave_id = m.loser_id;

-- 4c. Preserve a hand-corrected pin: if a loser had user_corrected coords and the
--     survivor did not, carry the corrected location onto the survivor (so a
--     drag-to-correct done on a fragment isn't discarded by the merge).
UPDATE public.graves sv
SET lat = src.lat, lng = src.lng, user_corrected = TRUE, updated_at = NOW()
FROM (
  SELECT DISTINCT ON (m.survivor_id) m.survivor_id, l.lat, l.lng
  FROM _grave_merge_map m
  JOIN public.graves l ON l.id = m.loser_id AND l.user_corrected
  ORDER BY m.survivor_id, l.updated_at DESC
) src
WHERE sv.id = src.survivor_id AND NOT sv.user_corrected;

-- 5. Delete the now-orphaned loser grave rows.
DELETE FROM public.graves g
USING _grave_merge_map m
WHERE g.id = m.loser_id;

COMMIT;

-- Verify (optional): zero same-key co-located clusters should remain.
--   WITH g AS (SELECT id, lat, lng, public._grave_name_key(name) k FROM public.graves
--              WHERE public._grave_name_key(name) <> '')
--   SELECT a.id, count(*) FROM g a JOIN g b
--     ON a.k=b.k AND b.lat BETWEEN a.lat-0.00018 AND a.lat+0.00018
--               AND b.lng BETWEEN a.lng-0.00025 AND a.lng+0.00025
--   GROUP BY a.id HAVING count(*) > 1;

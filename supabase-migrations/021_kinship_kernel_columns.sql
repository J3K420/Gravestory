-- ================================================================
-- GraveStory: kinship kernel columns (subjects / relationships / maiden_name)
-- Paste into the Supabase SQL editor and run. Run AFTER migration 020.
-- ================================================================
-- These persist the structured family data that the scan pipeline computes but
-- currently THROWS AWAY before save (it lived only in the transient `graveData`
-- object; after a cloud sync, even the in-memory copy was gone). Persisting them
-- is the prerequisite for GEDCOM export — a genealogist can then export a stone
-- they saved last week, not just one scanned seconds ago.
--
--   subjects      jsonb  -- [{name, birth_date, death_date}], ONE per deceased
--                        --   person on the stone, each with their OWN dates.
--                        --   GEDCOM INDI granularity.
--   relationships jsonb  -- [{relation:'spouse'|'father'|'mother'|'son'|
--                        --   'daughter'|'sibling', name}]. GEDCOM FAM source.
--   maiden_name   text   -- the deceased's née/birth surname.
--
-- OWNER-PRIVATE. NOT exposed by global_public_stories (that RPC enumerates its
-- RETURNS TABLE columns explicitly, so new columns are invisible unless added —
-- and we do NOT add them). Same posture as originated_relatives (020). Inherits
-- the existing `stories` RLS — no new policy.
--
-- NOTE: a `relationships` entry can name a LIVING person (e.g. the surviving
-- spouse engraved on the stone). That is fine here — this data is owner-only and
-- export is owner-gated, so it can never reach a public surface.
--
-- NULL/absent = legacy row or none. Idempotent (ADD COLUMN IF NOT EXISTS) — safe
-- to re-run.
-- ================================================================

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS subjects      jsonb,
  ADD COLUMN IF NOT EXISTS relationships jsonb,
  ADD COLUMN IF NOT EXISTS maiden_name   text;

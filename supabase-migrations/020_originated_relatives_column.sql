-- ================================================================
-- GraveStory: originated_relatives jsonb (Inc2 writer — deterministic strip key)
-- Paste into the Supabase SQL editor and run. Run AFTER migrations 018 + 019.
-- ================================================================
-- Inc2 attaches app-ORIGINATED relative names (WikiTree spouses NOT on the stone)
-- to the OWNER'S PRIVATE story. has_originated_relatives (018) is the boolean
-- serve-side guard; THIS column carries the actual names so the DETERMINISTIC
-- public strip can run identically at EVERY public write site — including a
-- toggle/marker-pick on a story RELOADED FROM A ROW in a later session, when the
-- in-memory list is gone. Without it, a private-first story made public later
-- would get a public_biography written WITHOUT the strip, leaking originated
-- names (the 019 floor only guards a NULL public_biography).
--
-- Shape: jsonb array of {name, relation}. NULL/absent = none (legacy + flag-off
-- rows). NOT exposed by global_public_stories (internal; the strip consumes it
-- client-side; the public copy never carries it). Inherits stories RLS.
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ================================================================

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS originated_relatives jsonb;

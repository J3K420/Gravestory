-- ================================================================
-- GraveStory: per-story AI-resolved symbol meanings
-- Paste into Supabase SQL editor and run
-- ================================================================
--
-- When a gravestone symbol detected by OCR is NOT covered by the static
-- SYMBOL_CONTEXT lookup table, the scan pipeline asks Gemini once for its
-- conventional funerary/cultural meaning and stores the result on the story
-- so the result-screen chip stays tappable forever (and survives sync to
-- other devices + bio-cache reuse).
--
-- Shape: { "<symbol string as OCR returned it>": "<1-2 sentence meaning>", ... }
-- Only contains symbols the static table missed AND Gemini could explain;
-- symbols Gemini declined to explain are omitted (chip stays non-tappable).
--
-- Inherits the stories table's existing RLS policies — no new policy needed
-- (same as the marker_style column added in migration 007).

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS symbol_meanings jsonb;

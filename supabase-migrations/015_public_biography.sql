-- ================================================================
-- GraveStory: living-relative name redaction for public stories
-- Paste into Supabase SQL editor and run.
-- ================================================================
--
-- A story made PUBLIC appears on the community global map with a precise
-- GPS pin. Its AI-written bio prose can NAME living relatives ("survived by
-- her son Michael Thompson") — and a living private person can be defamed or
-- re-identified, where the deceased cannot. Before publishing, the client
-- runs a Gemini pass that strips the names of anyone NOT confirmed deceased,
-- generalizing them to their relationship ("survived by her son"), and stores
-- the result in `stories.public_biography`. The owner's private copy keeps the
-- full `biography` untouched.
--
-- This migration:
--   1. Adds the nullable `public_biography` column.
--   2. CREATE OR REPLACEs global_public_stories so the `biography` it serves
--      to the global map is coalesce(public_biography, biography) — the
--      redacted text when present, else the original (back-compat for stories
--      made public before this shipped; the report button remains the
--      backstop for those).
--
-- ⚠️ LIVE BASELINE = migration 012, NOT 011. The body below is migration
-- 012_global_grave_corrected.sql's definition (the most-recent prior version
-- of this RPC — 012 ran after 011 and changed user_corrected/low_confidence to
-- make accuracy a property of the GRAVE), with ONLY the biography column
-- changed to coalesce(s.public_biography, s.biography). DO NOT base this on 011
-- or on _RETRIEVE_global_public_stories.sql (the latter is documentation-only,
-- holding the PRE-marker original). If the RPC changes again, keep THIS body in
-- sync with the most-recent definition. The corrected-pin expressions on lines
-- 51-53 below are load-bearing — dropping them silently reverts session S43.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. The RETURNS TABLE
-- type is UNCHANGED from 012 (only a body expression changes), so a plain
-- CREATE OR REPLACE is sufficient — no DROP needed. Safe to re-run. No data
-- migration: existing public stories keep public_biography NULL and the
-- coalesce serves their original bio exactly as today, so nothing regresses.
-- ================================================================


-- 1. Add public_biography to stories
-- ----------------------------------------------------------------
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS public_biography text;


-- 2. global_public_stories — serve the redacted bio when present
-- Migration 012's body verbatim EXCEPT s.biography -> coalesce(public_biography,
-- biography). The two corrected-grave expressions (user_corrected /
-- low_confidence) are preserved EXACTLY from 012 — they are NOT optional.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
 RETURNS TABLE(
   id uuid, name text, dates text, biography text, location text,
   inscription text, symbols text, family_name text, notes text,
   sources jsonb, source_urls jsonb, latitude double precision,
   longitude double precision, user_corrected boolean, low_confidence boolean,
   client_timestamp bigint, image_url text, portrait_left_url text,
   portrait_right_url text, created_at timestamp with time zone,
   updated_at timestamp with time zone, contributor_name text,
   grave_id uuid, marker_style text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id, s.name, s.dates,
    -- Public-facing bio: the living-name-redacted copy when present, else the
    -- original (older public stories created before redaction shipped).
    coalesce(s.public_biography, s.biography) as biography,
    s.location, s.inscription, s.symbols,
    s.family_name, s.notes, s.sources, s.source_urls, s.latitude, s.longitude,
    -- A grave that ANY user has corrected is authoritative for everyone.
    -- Prefer the grave's flag; fall back to the story's for stories with no
    -- linked grave (guest/GPS-less rows that still appear via GPS-cell dedup).
    coalesce(g.user_corrected, s.user_corrected) as user_corrected,
    -- A corrected grave is confident — suppress the approximate "?" / warning.
    case when g.user_corrected then false else s.low_confidence end as low_confidence,
    s.client_timestamp, s.image_url,
    s.portrait_left_url, s.portrait_right_url,
    s.created_at, s.updated_at,
    coalesce(up.display_name, 'Anonymous') as contributor_name,
    s.grave_id,
    g.marker_style
  from public.stories s
  left join public.user_prefs up on up.user_id = s.user_id
  left join public.graves     g  on g.id      = s.grave_id
  where s.is_public = true
    and s.deleted_at is null
    and s.latitude is not null
    and s.longitude is not null
  order by s.created_at desc
  limit greatest(1, least(p_limit, 500));
$function$;

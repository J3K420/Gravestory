-- ================================================================
-- GraveStory: per-story "Mentions" — name-safe one-line source pointers
-- Paste into the Supabase SQL editor and run. Run AFTER migration 021.
-- ================================================================
-- The scan pipeline fetches raw research hits (Tavily web, FindAGrave, Chronicling
-- America, Internet Archive, Wikipedia) that it uses for the bio and then DISCARDS.
-- This column persists a small set of Gemini-authored, NAME-SAFE one-sentence
-- pointers to those hits so the result-screen "Mentions" sheet survives save +
-- cloud sync, on the owner's story AND on the public global map.
--
--   mentions  jsonb  -- [{ "sentence": "...", "url": "https://...",
--                    --    "source": "web", "year": "1919" }]
--                    --   `sentence` is the hyperlink label; `url` the target.
--
-- ⚠️ POSTURE vs migration 021. subjects/relationships are OWNER-PRIVATE and
-- deliberately NOT exposed by global_public_stories because a relationships entry
-- can name a LIVING person. `mentions` is authored under the same living-name
-- rule as redactLivingNamesForPublic (S62) and gets a deterministic fail-closed
-- strip on every public write path, so unlike those columns it IS exposed by the
-- RPC below. (Name-safety here is by AUTHORING + strip, not absolute — the
-- client-side publish path is the enforcement point.)
--
-- This migration:
--   1. Adds the nullable `mentions` jsonb column (idempotent ADD COLUMN IF NOT EXISTS).
--   2. Recreates global_public_stories with `mentions jsonb` appended to the
--      RETURNS TABLE + `s.mentions` selected. Appending a column to RETURNS TABLE
--      changes the function's return type, so a plain CREATE OR REPLACE is NOT
--      sufficient — we DROP then CREATE.
--
-- ⚠️ LIVE BASELINE = migration 019_originated_floor.sql, NOT 015. 019 ran AFTER
-- 015 and is the most-recent definition of this RPC (020 and 021 did NOT touch
-- it). The body below is 019's VERBATIM — including its flag-guarded biography
-- CASE (the originated-names read-side privacy floor) — with the ONLY delta being
-- the added `mentions jsonb` return column + `s.mentions` select. Every other
-- expression is load-bearing and preserved EXACTLY:
--   * the has_originated_relatives biography CASE (S68 increment 1, migration 019)
--   * coalesce(g.user_corrected, s.user_corrected) (S43, migration 012)
--   * case when g.user_corrected then false else s.low_confidence end (S43)
-- Do NOT rebase this on 015/012/011 or _RETRIEVE_global_public_stories.sql —
-- doing so silently reverts 019's privacy floor.
--
-- Before running, optionally confirm 019 is the live def:
--   SELECT pg_get_functiondef('public.global_public_stories(integer)'::regprocedure);
-- and verify the has_originated_relatives CASE branch is present.
--
-- The DROP+CREATE keeps the RPC callable: Postgres CREATE FUNCTION grants EXECUTE
-- to PUBLIC (incl. anon + authenticated) by default — the same DROP+CREATE pattern
-- in migrations 011/012 kept the global map working in prod. As belt-and-suspenders
-- the explicit grants are re-applied at the end (idempotent, harmless if redundant).
-- Inherits the stories table's existing RLS — no new policy.
-- ================================================================


-- 1. Add mentions to stories
-- ----------------------------------------------------------------
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS mentions jsonb;


-- 2. global_public_stories — append `mentions` to the served columns
-- Migration 019's body VERBATIM (including the originated-names biography CASE)
-- EXCEPT the new `mentions jsonb` return column + `s.mentions` in the select.
-- DROP first because RETURNS TABLE changed.
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.global_public_stories(integer);

CREATE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
 RETURNS TABLE(
   id uuid, name text, dates text, biography text, location text,
   inscription text, symbols text, family_name text, notes text,
   sources jsonb, source_urls jsonb, latitude double precision,
   longitude double precision, user_corrected boolean, low_confidence boolean,
   client_timestamp bigint, image_url text, portrait_left_url text,
   portrait_right_url text, created_at timestamp with time zone,
   updated_at timestamp with time zone, contributor_name text,
   grave_id uuid, marker_style text, mentions jsonb
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id, s.name, s.dates,
    -- Public-facing bio. Unflagged rows keep the load-bearing
    -- coalesce(public_biography, biography) back-compat exactly as before
    -- (older public stories created before redaction shipped). A row carrying
    -- APP-ORIGINATED relative names (has_originated_relatives) must NEVER fall
    -- back to the raw biography: if its redacted public copy is somehow missing,
    -- serve a safe placeholder, not the originated names. (migration 019)
    case
      when s.has_originated_relatives
        then coalesce(s.public_biography, 'This public biography is being prepared.')
      else coalesce(s.public_biography, s.biography)
    end as biography,
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
    g.marker_style,
    -- Name-safe one-line source pointers (resolveMentions; S62 living-name rule
    -- + fail-closed public strip). Safe to expose publicly. NULL for legacy rows.
    s.mentions
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


-- 3. Re-apply EXECUTE grants (belt-and-suspenders). CREATE FUNCTION already grants
-- EXECUTE to PUBLIC by default, so these are normally redundant — but they make
-- callability independent of any out-of-band grant changes on the live DB.
-- ----------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.global_public_stories(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.global_public_stories(integer) TO authenticated;

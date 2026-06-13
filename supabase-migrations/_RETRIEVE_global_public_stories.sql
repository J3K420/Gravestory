-- ================================================================
-- RETRIEVAL TASK — NOT a migration. Do NOT run this top-to-bottom.
-- ================================================================
--
-- The `global_public_stories` RPC (read by js/map-global.js +
-- mobile/src/screens/GlobalMapScreen.js to populate the community
-- global map) was authored directly in the Supabase SQL editor and
-- was NEVER captured in a migration file. It is the ONLY grave/story
-- RPC missing from this repo. That gap blocks two planned features:
--   * global-map pin scaling (the 500-row fetch cap / clustering)
--   * marker packs (needs to join graves.marker_style into its output)
--
-- GOAL: recover the live function body and paste it into the marked
-- block below, then commit this file so the definition is finally
-- under version control.
--
-- This file has NO numeric prefix and is named _RETRIEVE_* on purpose
-- so it is never mistaken for a runnable migration in the 001–010
-- sequence. Once the body is filled in and reviewed, we may rename it
-- to a proper NNN_*.sql migration (CREATE OR REPLACE is idempotent).
-- ================================================================


-- ----------------------------------------------------------------
-- STEP 1 — RUN THIS in the Supabase SQL editor (Dashboard → SQL
-- Editor → New query) and copy the `definition` column from the
-- result. This is the ONLY statement here meant to be executed.
-- ----------------------------------------------------------------
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'global_public_stories';

-- If the query above returns MORE THAN ONE row (an overloaded function
-- with different argument signatures), run this instead to disambiguate
-- and see each variant's argument list alongside its body:
--
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        pg_get_functiondef(p.oid)                 AS definition
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'global_public_stories';


-- ================================================================
-- STEP 2 — PASTE the recovered function body between the markers
-- below (replace this whole placeholder), then save + commit.
-- ================================================================

-- >>> BEGIN RECOVERED global_public_stories DEFINITION >>>
-- Recovered live from Supabase 2026-06-13 (Session 41) via pg_get_functiondef.
-- This is now the source-of-truth copy under version control.
--
-- ⚠️ SUPERSEDED: migration 011_grave_marker_style.sql now CREATE OR REPLACEs
-- this function to LEFT JOIN graves and return grave_id + marker_style (for the
-- first-person grave-marker feature). The body below is the PRE-marker original,
-- kept for provenance. Once 011 is run, 011 is the live definition.

CREATE OR REPLACE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, name text, dates text, biography text, location text, inscription text, symbols text, family_name text, notes text, sources jsonb, source_urls jsonb, latitude double precision, longitude double precision, user_corrected boolean, low_confidence boolean, client_timestamp bigint, image_url text, portrait_left_url text, portrait_right_url text, created_at timestamp with time zone, updated_at timestamp with time zone, contributor_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id, s.name, s.dates, s.biography, s.location, s.inscription, s.symbols,
    s.family_name, s.notes, s.sources, s.source_urls, s.latitude, s.longitude,
    s.user_corrected, s.low_confidence, s.client_timestamp, s.image_url,
    s.portrait_left_url, s.portrait_right_url,
    s.created_at, s.updated_at,
    coalesce(up.display_name, 'Anonymous') as contributor_name
  from public.stories s
  left join public.user_prefs up on up.user_id = s.user_id
  where s.is_public = true
    and s.deleted_at is null
    and s.latitude is not null
    and s.longitude is not null
  order by s.created_at desc
  limit greatest(1, least(p_limit, 500));
$function$;

-- <<< END RECOVERED global_public_stories DEFINITION <<<


-- ================================================================
-- STEP 3 — FOUR FACTS, CONFIRMED 2026-06-13 from the body above:
--   1. ORDER BY: `s.created_at desc` — YES, the surviving set is the
--      most-recently-CREATED public stories. (Note: created_at, NOT
--      client_timestamp and NOT updated_at — so editing an old story
--      does NOT bring it back into the top-N; only original creation
--      time decides who survives the cap.)
--   2. p_limit: applied as `limit greatest(1, least(p_limit, 500))`.
--      The 500 is a HARD SERVER CEILING — passing p_limit > 500 is
--      silently clamped to 500. So the client's `currentUser ? 500 : 50`
--      can never exceed 500 even if raised. Default 500.
--   3. Dedup: NONE inside the function — it returns raw STORIES (one
--      row per public story), no DISTINCT/GROUP BY on grave_id. ALL
--      grave dedup is client-side in map-global.js (by grave_id then
--      ~20m cell), AFTER the 500-row cap. => the cap counts STORIES,
--      so the number of distinct GRAVES shown is <= 500 and often less.
--   4. RETURN columns: listed in the RETURNS TABLE(...) above. NOTE for
--      marker-packs: it returns story columns + a user_prefs join, but
--      does NOT currently return grave_id NOR any graves.* column. To
--      put a first-wins marker on the global map, this function must add
--      a join to public.graves and return graves.marker_style (and
--      likely grave_id too, so the client dedup can keep using it).
-- ================================================================
--
-- IMPLICATIONS captured in memory [[project-global-map-scaling]] +
-- [[project-marker-packs]]:
--  * The 500 cliff is real, hard, and silent, ordered by created_at desc.
--  * Marker-packs A1 step 3 = add `left join public.graves g on g.id =
--    s.grave_id` and return `g.marker_style`. Confirm stories.grave_id
--    exists (migration 001 added it) — it does.
--  * Any future bbox/viewport param (Tier 3) slots into the WHERE clause
--    here (add lat/lng BETWEEN bounds) — clean insertion point.
-- ================================================================

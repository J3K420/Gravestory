-- ================================================================
-- GraveStory: serve the CORRECTED grave coordinate on the global map
-- Paste into the Supabase SQL editor and run. Run AFTER migration 022.
-- ================================================================
-- BUG (found S75 by the GPS/pins audit): a grave that user A drag-corrects
-- moves graves.lat/lng (via update_grave_location) and updates A's OWN story row,
-- but every OTHER public story on the same grave keeps its original (usually
-- cemetery-centroid) coordinate. global_public_stories selected each story's OWN
-- s.latitude/s.longitude for the pin while only COALESCING the user_corrected /
-- low_confidence FLAGS from the graves table. Net effect: a second viewer sees the
-- corrected grave rendered at the STALE coordinate (tens-to-hundreds of metres off),
-- yet badged fully confident (user_corrected=true suppresses the "?" + warning).
-- The flag propagated; the coordinate did not.
--
-- FIX: when the linked grave has been user-corrected, serve the grave's authoritative
-- g.lat/g.lng for the pin instead of the story's own s.latitude/s.longitude. Because
-- this is applied at the RPC for EVERY story on a corrected grave, all rows for that
-- grave now agree on the coordinate, so it no longer matters which row the client-side
-- grave_id dedup happens to keep. Web (js/map-global.js) and mobile (sync.js rowToStory)
-- both read row.latitude/row.longitude straight into the pin, so this single RPC change
-- fixes BOTH clients with no client code change.
--
-- ⚠️ BASELINE = migration 022_mentions_column.sql — the most-recent live definition
-- of this RPC (it appended `mentions jsonb`). The body below is 022's VERBATIM,
-- including every load-bearing expression, with the ONLY delta being the two
-- coordinate select-list entries:
--   s.latitude   ->  coalesce(case when g.user_corrected then g.lat end, s.latitude)
--   s.longitude  ->  coalesce(case when g.user_corrected then g.lng end, s.longitude)
-- Everything else is preserved EXACTLY:
--   * the has_originated_relatives biography CASE (S68 inc 1, migration 019 privacy floor)
--   * coalesce(g.user_corrected, s.user_corrected)            (S43, migration 012)
--   * case when g.user_corrected then false else s.low_confidence end  (S43)
--   * s.mentions return column                                (S71, migration 022)
--   * the RETURNS TABLE signature (unchanged — same columns, same order/types)
--
-- NOTE on the WHERE filter: `s.latitude is not null` is intentionally LEFT on the
-- STORY's own coordinate. A story with no own coordinate still does not appear (no
-- behavior change); the coalesce only UPGRADES the served coordinate for rows that
-- already pass. graves.lat/lng are NOT NULL once a grave row exists, so a corrected
-- grave's coordinate is always present when used.
--
-- The RETURNS TABLE signature is UNCHANGED from 022, so a plain CREATE OR REPLACE is
-- sufficient and a DROP is NOT required. (CREATE OR REPLACE preserves existing grants.)
-- Belt-and-suspenders EXECUTE grants re-applied at the end (idempotent).
--
-- Before running, optionally confirm 022 is the live def:
--   SELECT pg_get_functiondef('public.global_public_stories(integer)'::regprocedure);
-- and verify the `s.mentions` select + has_originated_relatives CASE are present.
-- ================================================================

CREATE OR REPLACE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
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
    s.family_name, s.notes, s.sources, s.source_urls,
    -- A grave that ANY user has corrected is authoritative for everyone — serve the
    -- grave's corrected coordinate (not this story's stale own coordinate) for the pin.
    -- Stories with no linked grave, or an uncorrected grave, keep their own coordinate.
    coalesce(case when g.user_corrected then g.lat end, s.latitude)  as latitude,
    coalesce(case when g.user_corrected then g.lng end, s.longitude) as longitude,
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


-- Re-apply EXECUTE grants (belt-and-suspenders; CREATE OR REPLACE preserves them).
GRANT EXECUTE ON FUNCTION public.global_public_stories(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.global_public_stories(integer) TO authenticated;

-- ================================================================
-- GraveStory: read-side floor for app-originated relative names
-- Paste into Supabase SQL editor and run. Run AFTER migration 018.
-- ================================================================
--
-- Closes the "coalesce hole" in global_public_stories for the originated-names
-- feature. A row flagged `has_originated_relatives` (migration 018) carries
-- app-originated relative names in its raw `biography`. If such a row's redacted
-- `public_biography` is ever missing, the OLD coalesce(public_biography,
-- biography) would fall back to the RAW bio and leak originated names onto the
-- public global map — the exact invariant this feature must never break.
--
-- The fix is a flag-GUARDED biography expression (NOT dropping the coalesce):
--   * unflagged row  -> coalesce(public_biography, biography)  [TODAY's behavior,
--     verbatim — the load-bearing back-compat for pre-redaction public stories]
--   * flagged + public_biography present -> public_biography
--   * flagged + public_biography NULL    -> a safe placeholder, NEVER raw bio
--
-- LEGACY PROOF (zero regression): after 018 every existing public row has
-- has_originated_relatives = false, so the `else` branch runs and serves
-- coalesce(public_biography, biography) — byte-identical to migration 015's
-- line 71. The `then` branch is UNREACHABLE today (no flagged rows) and becomes
-- the floor the instant the later writer increment starts flagging rows.
--
-- ⚠️ Body = migration 015_public_biography.sql VERBATIM except the single
-- biography expression. RETURNS TABLE is UNCHANGED (24 cols ending grave_id,
-- marker_style) — the floor lives inside the biography expression, so a plain
-- CREATE OR REPLACE suffices, no DROP. The corrected-grave expressions
-- (user_corrected / low_confidence) are preserved EXACTLY from 015/012 — they
-- are load-bearing (session S43); dropping them silently reverts that fix.
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run. No data migration.
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
   grave_id uuid, marker_style text
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
    -- serve a safe placeholder, not the originated names.
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

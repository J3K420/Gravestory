-- ================================================================
-- GraveStory: global map honors first-correction-wins for accuracy
-- Paste into Supabase SQL editor and run
-- ================================================================
--
-- The community global map shows one pin per canonical grave. A grave's
-- location is authoritative once ANY user drags-to-correct it (first
-- correction wins, via update_grave_location's `WHERE NOT user_corrected`).
-- But global_public_stories returned the STORY's user_corrected /
-- low_confidence, which is per-author — so a corrected grave could still
-- show the "?" badge + "approximate location" warning to everyone except
-- the corrector. Fix: return the GRAVE's user_corrected, and treat a
-- corrected grave as confident (low_confidence forced false). This makes
-- the accuracy state a property of the grave, consistent for all viewers.
--
-- Idempotent: DROP + CREATE (return-type change). Re-runnable.
-- ================================================================

DROP FUNCTION IF EXISTS public.global_public_stories(integer);

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
    s.id, s.name, s.dates, s.biography, s.location, s.inscription, s.symbols,
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

-- ================================================================
-- GraveStory: first-person grave marker on the global map (Phase A)
-- Paste into Supabase SQL editor and run
-- ================================================================
--
-- Gives each canonical grave a `marker_style` that becomes its
-- PERMANENT pin on the community global map. First-wins forever:
-- the first public scanner's chosen marker stakes the grave; later
-- savers and location corrections never override it. Enforced in the
-- DB (INSERT-branch-only set + a NULL-guarded update RPC), so the
-- first-wins rule cannot be bypassed from any client.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Safe to
-- re-run. No data migration — existing graves keep marker_style NULL
-- and fall back to the default 'book' glyph client-side.
-- ================================================================


-- 1. Add marker_style to graves
-- ----------------------------------------------------------------
ALTER TABLE public.graves
  ADD COLUMN IF NOT EXISTS marker_style text;


-- 2. find_or_create_grave — stake the marker on the INSERT branch only
-- Adds p_marker_style. On a NEW grave the chosen style is written; on
-- the reuse branch it is NEVER touched, so first-wins falls out for
-- free (same rule that already governs is_public false→true-only).
-- This is the natural staking path for mobile, where the user picks a
-- marker on the result screen BEFORE the grave is created at save time.
--
-- NOTE: adding the 5th parameter changes the function signature, so a plain
-- CREATE OR REPLACE would leave the OLD 4-arg version in place alongside the
-- new one — and because p_marker_style has a DEFAULT, a 4-arg call would then
-- be ambiguous ("function is not unique"). Drop the old signature first.
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.find_or_create_grave(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.find_or_create_grave(
  p_name         TEXT,
  p_lat          DOUBLE PRECISION,
  p_lng          DOUBLE PRECISION,
  p_is_public    BOOLEAN DEFAULT FALSE,
  p_marker_style TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- ~20 m bounding box: 0.00018° lat ≈ 20 m; 0.00025° lng ≈ 20 m at mid-latitudes
  SELECT id INTO v_id
  FROM public.graves
  WHERE lat BETWEEN p_lat - 0.00018 AND p_lat + 0.00018
    AND lng BETWEEN p_lng - 0.00025 AND p_lng + 0.00025
    AND lower(trim(name)) = lower(trim(p_name))
  ORDER BY (lat - p_lat)^2 + (lng - p_lng)^2
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.graves (name, lat, lng, is_public, marker_style)
    VALUES (p_name, p_lat, p_lng, p_is_public, p_marker_style)
    RETURNING id INTO v_id;
  ELSIF p_is_public THEN
    UPDATE public.graves
       SET is_public = TRUE, updated_at = NOW()
     WHERE id = v_id AND NOT is_public;
  END IF;

  RETURN v_id;
END;
$$;


-- 3. set_grave_marker — NULL-guarded first-wins stake
-- Stakes a grave's marker_style ONLY if it has not been set yet. Used
-- by the WEB path (the grave is created at pipeline-end, before the user
-- can pick, so it's created NULL and staked when the user picks on the
-- result screen) and by both platforms' post-save re-picks. The WHERE
-- marker_style IS NULL guard makes the first picker win forever; later
-- pickers (and the same grave re-staked by anyone else) no-op. Idempotent
-- and non-fatal. SECURITY DEFINER so callers don't need UPDATE on graves.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_grave_marker(
  p_grave_id     UUID,
  p_marker_style TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_grave_id IS NULL OR p_marker_style IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.graves
     SET marker_style = p_marker_style, updated_at = NOW()
   WHERE id = p_grave_id
     AND marker_style IS NULL;
END;
$$;


-- 4. global_public_stories — join graves; return grave_id + marker_style
-- Recovered body (see _RETRIEVE_global_public_stories.sql / commit 3c85323)
-- with two columns added to the RETURNS TABLE and a left join to graves.
-- Returning grave_id ALSO revives the client's grave_id-dedup path, which
-- was silently dead because the RPC never returned grave_id (both map
-- clients read row.grave_id → always null → only ~20 m GPS-cell dedup ran).
--
-- NOTE: adding columns changes the RETURNS TABLE type. Postgres refuses to
-- change a function's return type via CREATE OR REPLACE ("cannot change return
-- type of existing function"), so drop the old definition first. The argument
-- signature (p_limit integer) is unchanged, so no overload is left behind.
-- ----------------------------------------------------------------
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
    s.user_corrected, s.low_confidence, s.client_timestamp, s.image_url,
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

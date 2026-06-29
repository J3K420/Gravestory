-- ════════════════════════════════════════════════════════════════════════
-- Migration 032 — order-insensitive grave name matching
-- ════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE (found via code review of the grave_photos dup bug): the same
-- physical multi-subject stone fragmented into several `graves` rows because
-- find_or_create_grave / find_grave matched on EXACT lower(trim(name)) equality.
-- A shared family stone's name flips order between scans — "Cynthia Levy & Amy
-- Jade Winehouse" vs "Amy Jade Winehouse & Cynthia Levy" (and "Cynthia Levy"
-- alone on an early scan) — so the exact match failed and a NEW grave row was
-- minted. Multiple grave rows for one stone → the global gallery can't present a
-- single clean photo set, and the (grave_id,user_id) dedup (migration 031) can't
-- merge across grave_ids.
--
-- FIX: match on an ORDER-INSENSITIVE name KEY — lowercase, trim, split on the
-- "&" / " and " / "," separators, sort the parts, rejoin. Two scans of the same
-- shared stone now produce the same key regardless of name order, so they match
-- the same grave. The stored `name` is UNCHANGED (we still INSERT the original
-- p_name for display); the key is used ONLY for the equality test.
--
-- Both find_or_create_grave (writer) and find_grave (read-only bio-cache
-- companion) are updated together so they agree on what "same grave" means.
--
-- SCOPE (intentional): this fixes ORDER FLIPS only. A subset name vs its
-- superset — a bare "Cynthia Levy" scan vs "Cynthia Levy & Amy Jade Winehouse"
-- — produce DIFFERENT keys and are NOT merged here. That is deliberate: loosening
-- the key to subset-matching would risk collapsing distinct same-surname people
-- <20 m apart on a dense family plot. Existing subset fragments are consolidated
-- as DATA by migration 033, not by relaxing this equality key.
--
-- SAFE/IDEMPOTENT: CREATE OR REPLACE everywhere; no data is altered. The 20 m
-- box, first-correction-wins is_public bump, SECURITY DEFINER, and search_path
-- are all preserved exactly. (Existing fragmented rows are consolidated
-- separately by migration 033 — this only stops NEW fragmentation.)
-- ════════════════════════════════════════════════════════════════════════

-- Shared normalizer: a canonical, order-independent key for a grave name.
-- "Cynthia Levy & Amy Jade Winehouse" and "Amy Jade Winehouse & Cynthia Levy"
-- both → "amy jade winehouse&cynthia levy". A single name is unchanged (one
-- token sorts to itself). IMMUTABLE so it can be used in the WHERE comparison
-- and (optionally) indexed later. NULL-safe via coalesce.
CREATE OR REPLACE FUNCTION public._grave_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_agg(part, '&' ORDER BY part)
  FROM (
    SELECT trim(both FROM lower(t)) AS part
    -- split on &, the word "and" (space-delimited), or commas
    FROM unnest(regexp_split_to_array(coalesce(p_name, ''), '\s*(&|,|\s+and\s+)\s*')) AS t
    WHERE trim(both FROM t) <> ''
  ) parts;
$$;

-- find_or_create_grave — now matches on the order-insensitive key.
CREATE OR REPLACE FUNCTION public.find_or_create_grave(
  p_name      TEXT,
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  UUID;
  v_key TEXT := public._grave_name_key(p_name);
BEGIN
  -- ~20 m bounding box (unchanged): 0.00018° lat ≈ 20 m; 0.00025° lng ≈ 20 m.
  -- Name match is now order-insensitive via the shared key.
  SELECT id INTO v_id
  FROM public.graves
  WHERE lat BETWEEN p_lat - 0.00018 AND p_lat + 0.00018
    AND lng BETWEEN p_lng - 0.00025 AND p_lng + 0.00025
    AND public._grave_name_key(name) = v_key
  ORDER BY (lat - p_lat)^2 + (lng - p_lng)^2
  LIMIT 1;

  IF v_id IS NULL THEN
    -- Store the ORIGINAL name for display; the key is only for matching.
    INSERT INTO public.graves (name, lat, lng, is_public)
    VALUES (p_name, p_lat, p_lng, p_is_public)
    RETURNING id INTO v_id;
  ELSIF p_is_public THEN
    UPDATE public.graves
       SET is_public = TRUE, updated_at = NOW()
     WHERE id = v_id AND NOT is_public;
  END IF;

  RETURN v_id;
END;
$$;

-- find_grave — read-only bio-cache companion, same matching logic.
CREATE OR REPLACE FUNCTION public.find_grave(
  p_name TEXT,
  p_lat  DOUBLE PRECISION,
  p_lng  DOUBLE PRECISION
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  UUID;
  v_key TEXT := public._grave_name_key(p_name);
BEGIN
  SELECT id INTO v_id
  FROM public.graves
  WHERE lat BETWEEN p_lat - 0.00018 AND p_lat + 0.00018
    AND lng BETWEEN p_lng - 0.00025 AND p_lng + 0.00025
    AND public._grave_name_key(name) = v_key
  ORDER BY (lat - p_lat)^2 + (lng - p_lng)^2
  LIMIT 1;

  RETURN v_id;
END;
$$;

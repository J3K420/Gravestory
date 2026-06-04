-- ================================================================
-- GraveStory: read-only grave lookup for biography cache (Rec 6)
-- Paste into Supabase SQL editor and run
-- ================================================================

-- find_grave
-- Read-only companion to find_or_create_grave.
-- Returns the UUID of an existing grave within ~20 m with a matching
-- name, or NULL if no such grave exists.
-- Used by the biography cache to skip expensive research + Gemini
-- generation when a recent public story already covers this stone.
-- SECURITY DEFINER lets the function run as the definer role,
-- consistent with find_or_create_grave. No INSERT is performed.
-- ----------------------------------------------------------------
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
  v_id UUID;
BEGIN
  -- ~20 m bounding box: same tolerances as find_or_create_grave
  SELECT id INTO v_id
  FROM public.graves
  WHERE lat BETWEEN p_lat - 0.00018 AND p_lat + 0.00018
    AND lng BETWEEN p_lng - 0.00025 AND p_lng + 0.00025
    AND lower(trim(name)) = lower(trim(p_name))
  ORDER BY (lat - p_lat)^2 + (lng - p_lng)^2
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- ================================================================
-- GraveStory: canonical graves + tribute counters
-- Paste into Supabase SQL editor and run
-- ================================================================

-- 1. Canonical graves: one row per physical gravestone
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.graves (
  id             UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT             NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  is_public      BOOLEAN          NOT NULL DEFAULT FALSE,
  user_corrected BOOLEAN          NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

ALTER TABLE public.graves ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all graves; anonymous only public ones
CREATE POLICY "graves_select"
  ON public.graves FOR SELECT
  USING (is_public OR auth.role() = 'authenticated');

-- Allow any authenticated user to mark a grave public (but not back to private)
CREATE POLICY "graves_make_public"
  ON public.graves FOR UPDATE TO authenticated
  USING (TRUE)
  WITH CHECK (is_public = TRUE);


-- 2. Add grave_id + source to stories
-- ----------------------------------------------------------------
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS grave_id UUID REFERENCES public.graves(id),
  ADD COLUMN IF NOT EXISTS source   TEXT NOT NULL DEFAULT 'library';


-- 3. Tribute: one candle OR flower per user per grave
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tributes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grave_id   UUID        NOT NULL REFERENCES public.graves(id)  ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('candle', 'flower')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (grave_id, user_id)
);

ALTER TABLE public.tributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tributes_select"
  ON public.tributes FOR SELECT USING (TRUE);

CREATE POLICY "tributes_own"
  ON public.tributes FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- 4. find_or_create_grave
-- Finds an existing grave within ~20 m with the same name, or creates one.
-- SECURITY DEFINER lets it INSERT without the caller needing table-level INSERT.
-- First correction wins: if the grave already exists, is_public is only updated
-- from false → true, never the other way.
-- ----------------------------------------------------------------
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


-- 5. update_grave_location
-- Moves the canonical pin for a grave; first user-correction wins.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_grave_location(
  p_grave_id UUID,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.graves
     SET lat = p_lat, lng = p_lng, user_corrected = TRUE, updated_at = NOW()
   WHERE id = p_grave_id AND NOT user_corrected;
END;
$$;

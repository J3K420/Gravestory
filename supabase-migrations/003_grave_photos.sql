-- ================================================================
-- GraveStory: community grave photo pool
-- Paste into Supabase SQL editor and run
-- ================================================================

-- grave_photos: one row per photo per story, linked to a canonical grave.
-- Populated whenever a story with both grave_id and image_url is saved.
-- Read by the global map bio result screen to show all photos of a stone.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grave_photos (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grave_id   UUID        NOT NULL REFERENCES public.graves(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  image_url  TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.grave_photos ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read grave photos
CREATE POLICY "grave_photos_select"
  ON public.grave_photos FOR SELECT USING (TRUE);

-- Authenticated users can insert their own photos only
CREATE POLICY "grave_photos_insert"
  ON public.grave_photos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

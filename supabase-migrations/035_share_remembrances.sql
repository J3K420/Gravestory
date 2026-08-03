-- ================================================================
-- GraveStory: user-authored remembrances and UGC safety controls
-- Paste into the Supabase SQL editor and run before enabling the
-- Share a Remembrance mobile flow.
-- ================================================================

-- Explicit provenance and publication state. Existing rows are researched
-- stories; public rows stay published and private rows stay private.
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS story_type text NOT NULL DEFAULT 'researched',
  ADD COLUMN IF NOT EXISTS requested_visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS moderation_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

UPDATE public.stories
SET requested_visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END,
    publication_status = CASE WHEN is_public THEN 'published' ELSE 'private' END
WHERE story_type = 'researched';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_story_type_check'
      AND conrelid = 'public.stories'::regclass
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_story_type_check
      CHECK (story_type IN ('researched', 'remembrance', 'legacy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_requested_visibility_check'
      AND conrelid = 'public.stories'::regclass
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_requested_visibility_check
      CHECK (requested_visibility IN ('private', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_publication_status_check'
      AND conrelid = 'public.stories'::regclass
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_publication_status_check
      CHECK (publication_status IN ('private', 'pending', 'published', 'rejected', 'removed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_moderation_status_check'
      AND conrelid = 'public.stories'::regclass
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_moderation_status_check
      CHECK (moderation_status IN ('approved', 'pending', 'rejected', 'removed'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_remembrance_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  trusted_writer boolean := coalesce(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
  content_changed boolean := false;
BEGIN
  -- A contributor may never disguise an existing remembrance as a researched
  -- story to escape its publication gate.
  IF TG_OP = 'UPDATE'
    AND OLD.story_type = 'remembrance'
    AND NEW.story_type <> 'remembrance'
    AND NOT trusted_writer THEN
    NEW.story_type := 'remembrance';
  END IF;

  IF NEW.story_type = 'remembrance' THEN
    IF NEW.terms_accepted_at IS NULL THEN
      RAISE EXCEPTION 'Remembrances require terms acceptance';
    END IF;

    IF NOT trusted_writer THEN
      IF TG_OP = 'INSERT' THEN
        -- Mobile verification is useful triage, but it is not an authority.
        -- Only the service-role moderation endpoint may approve publication.
        NEW.moderation_status := 'pending';
        NEW.moderation_reason := 'Awaiting server-side moderation.';
        NEW.moderation_attempted_at := NULL;
        NEW.image_url := NULL;
      ELSE
        content_changed := NEW.name IS DISTINCT FROM OLD.name
          OR NEW.dates IS DISTINCT FROM OLD.dates
          OR NEW.biography IS DISTINCT FROM OLD.biography
          OR NEW.location IS DISTINCT FROM OLD.location
          OR NEW.latitude IS DISTINCT FROM OLD.latitude
          OR NEW.longitude IS DISTINCT FROM OLD.longitude;

        IF content_changed THEN
          NEW.moderation_status := 'pending';
          NEW.moderation_reason := 'Edited content requires moderation.';
          NEW.moderation_attempted_at := NULL;
        ELSE
          -- Prevent a modified client from writing its own moderation result.
          NEW.moderation_status := OLD.moderation_status;
          NEW.moderation_reason := OLD.moderation_reason;
          NEW.moderation_attempted_at := OLD.moderation_attempted_at;
        END IF;
        NEW.image_url := OLD.image_url;
      END IF;
    END IF;

    IF NEW.requested_visibility = 'private' THEN
      NEW.publication_status := 'private';
      NEW.is_public := false;
    ELSIF NEW.moderation_status = 'approved' THEN
      NEW.publication_status := 'published';
      NEW.is_public := true;
    ELSE
      IF NEW.moderation_status = 'rejected' THEN
        NEW.publication_status := 'rejected';
      ELSIF NEW.moderation_status = 'removed' THEN
        NEW.publication_status := 'removed';
      ELSE
        NEW.publication_status := 'pending';
      END IF;
      NEW.is_public := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stories_enforce_remembrance_publication ON public.stories;
CREATE TRIGGER stories_enforce_remembrance_publication
BEFORE INSERT OR UPDATE
ON public.stories
FOR EACH ROW EXECUTE FUNCTION public.enforce_remembrance_publication();

-- Story-linked photos work for both located and GPS-less stories.
CREATE TABLE IF NOT EXISTS public.story_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  object_key text,
  photo_role text NOT NULL DEFAULT 'supporting'
    CHECK (photo_role IN ('primary', 'supporting')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 3),
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('approved', 'pending', 'rejected', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (story_id, sort_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS story_photos_one_primary
  ON public.story_photos (story_id)
  WHERE photo_role = 'primary' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS story_photos_public_story
  ON public.story_photos (story_id, moderation_status, deleted_at);

CREATE OR REPLACE FUNCTION public.enforce_story_photo_moderation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  trusted_writer boolean := coalesce(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
  parent_is_public boolean := false;
BEGIN
  IF trusted_writer THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.visibility := 'private';
    NEW.moderation_status := 'pending';
  ELSE
    -- The upload Worker creates these immutable storage links. Contributors may
    -- only change visibility after approval; they cannot swap the object under
    -- an already-approved row or forge an approval state.
    NEW.story_id := OLD.story_id;
    NEW.user_id := OLD.user_id;
    NEW.image_url := OLD.image_url;
    NEW.object_key := OLD.object_key;
    NEW.photo_role := OLD.photo_role;
    NEW.sort_order := OLD.sort_order;
    NEW.moderation_status := OLD.moderation_status;
    NEW.deleted_at := OLD.deleted_at;
  END IF;

  IF NEW.moderation_status = 'approved' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = NEW.story_id
        AND s.is_public = true
        AND s.publication_status = 'published'
        AND s.moderation_status = 'approved'
        AND s.deleted_at IS NULL
    ) INTO parent_is_public;
  END IF;
  IF NOT parent_is_public THEN NEW.visibility := 'private'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_photos_enforce_moderation ON public.story_photos;
CREATE TRIGGER story_photos_enforce_moderation
BEFORE INSERT OR UPDATE ON public.story_photos
FOR EACH ROW EXECUTE FUNCTION public.enforce_story_photo_moderation();

ALTER TABLE public.story_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_photos_owner_select" ON public.story_photos;
CREATE POLICY "story_photos_owner_select"
  ON public.story_photos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "story_photos_public_select" ON public.story_photos;
CREATE POLICY "story_photos_public_select"
  ON public.story_photos FOR SELECT
  USING (
    deleted_at IS NULL
    AND visibility = 'public'
    AND moderation_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.id = story_photos.story_id
        AND s.is_public = true
        AND s.publication_status = 'published'
        AND s.moderation_status = 'approved'
        AND s.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "story_photos_owner_insert" ON public.story_photos;
CREATE POLICY "story_photos_owner_insert"
  ON public.story_photos FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_photos.story_id
        AND s.user_id = auth.uid()
        AND s.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "story_photos_owner_update" ON public.story_photos;
CREATE POLICY "story_photos_owner_update"
  ON public.story_photos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.story_photos TO authenticated;
GRANT SELECT ON public.story_photos TO anon;

-- Blocking is one-way: the blocker no longer sees the blocked contributor in
-- community feeds or the map. No messaging is required for this behavior.
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_owner_select" ON public.user_blocks;
CREATE POLICY "user_blocks_owner_select"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "user_blocks_owner_insert" ON public.user_blocks;
CREATE POLICY "user_blocks_owner_insert"
  ON public.user_blocks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "user_blocks_owner_delete" ON public.user_blocks;
CREATE POLICY "user_blocks_owner_delete"
  ON public.user_blocks FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "user_blocks_owner_update" ON public.user_blocks;
CREATE POLICY "user_blocks_owner_update"
  ON public.user_blocks FOR UPDATE TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_blocks TO authenticated;

-- Extend the existing write-only moderation queue to support UGC and
-- contributor reports without making reports readable to clients.
ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'story';

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reason_check CHECK (reason IN (
    'factual_error', 'wrong_person', 'offensive', 'privacy', 'copyright',
    'harassment', 'hate', 'sexual_content', 'violence', 'spam', 'other'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_reports_target_type_check'
      AND conrelid = 'public.content_reports'::regclass
  ) THEN
    ALTER TABLE public.content_reports
      ADD CONSTRAINT content_reports_target_type_check
      CHECK (target_type IN ('story', 'user'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS content_reports_story_id
  ON public.content_reports (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_target_user
  ON public.content_reports (target_user_id, created_at DESC);

-- Close the existing grave_photos privacy hole without destroying historical
-- rows: unmatched/private rows are soft-hidden and public access requires a
-- currently public owning story.
ALTER TABLE public.grave_photos
  ADD COLUMN IF NOT EXISTS story_id uuid REFERENCES public.stories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

WITH matches AS (
  SELECT
    gp.id AS photo_id,
    (
      SELECT s.id FROM public.stories s
      WHERE s.user_id = gp.user_id
        AND s.grave_id = gp.grave_id
        AND s.image_url = gp.image_url
      ORDER BY s.created_at DESC
      LIMIT 1
    ) AS story_id,
    (
      SELECT s.is_public FROM public.stories s
      WHERE s.user_id = gp.user_id
        AND s.grave_id = gp.grave_id
        AND s.image_url = gp.image_url
      ORDER BY s.created_at DESC
      LIMIT 1
    ) AS is_public
  FROM public.grave_photos gp
  WHERE gp.story_id IS NULL
)
UPDATE public.grave_photos gp
SET story_id = matches.story_id,
    visibility = CASE WHEN matches.is_public THEN 'public' ELSE 'private' END,
    deleted_at = CASE WHEN matches.is_public THEN NULL ELSE coalesce(gp.deleted_at, now()) END
FROM matches
WHERE gp.id = matches.photo_id
  AND matches.story_id IS NOT NULL;

UPDATE public.grave_photos
SET deleted_at = coalesce(deleted_at, now())
WHERE story_id IS NULL;

DROP POLICY IF EXISTS "grave_photos_select" ON public.grave_photos;
DROP POLICY IF EXISTS "grave_photos_insert" ON public.grave_photos;
DROP POLICY IF EXISTS "grave_photos_public_select" ON public.grave_photos;
DROP POLICY IF EXISTS "grave_photos_owner_select" ON public.grave_photos;
DROP POLICY IF EXISTS "grave_photos_owner_insert" ON public.grave_photos;
DROP POLICY IF EXISTS "grave_photos_owner_update" ON public.grave_photos;
CREATE POLICY "grave_photos_public_select"
  ON public.grave_photos FOR SELECT
  USING (
    deleted_at IS NULL
    AND visibility = 'public'
    AND moderation_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = grave_photos.story_id
        AND s.is_public = true
        AND s.deleted_at IS NULL
    )
  );

CREATE POLICY "grave_photos_owner_select"
  ON public.grave_photos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "grave_photos_owner_insert"
  ON public.grave_photos FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND story_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = grave_photos.story_id
        AND s.user_id = auth.uid()
        AND s.is_public = true
        AND s.deleted_at IS NULL
    )
  );

CREATE POLICY "grave_photos_owner_update"
  ON public.grave_photos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON public.grave_photos TO anon;
GRANT SELECT, INSERT, UPDATE ON public.grave_photos TO authenticated;

-- A list feed includes every public story, including rows without coordinates.
CREATE OR REPLACE FUNCTION public.community_public_stories(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, name text, dates text, biography text, location text,
  inscription text, symbols text, family_name text, notes text,
  sources jsonb, source_urls jsonb, latitude double precision,
  longitude double precision, user_corrected boolean, low_confidence boolean,
  client_timestamp bigint, image_url text, portrait_left_url text,
  portrait_right_url text, created_at timestamptz, updated_at timestamptz,
  contributor_name text, contributor_id uuid, grave_id uuid,
  marker_style text, mentions jsonb, story_type text, publication_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.name, s.dates,
    CASE
      WHEN s.has_originated_relatives
        THEN coalesce(s.public_biography, 'This public biography is being prepared.')
      ELSE coalesce(s.public_biography, s.biography)
    END AS biography,
    s.location, s.inscription, s.symbols, s.family_name, s.notes,
    s.sources, s.source_urls,
    coalesce(CASE WHEN g.user_corrected THEN g.lat END, s.latitude) AS latitude,
    coalesce(CASE WHEN g.user_corrected THEN g.lng END, s.longitude) AS longitude,
    coalesce(g.user_corrected, s.user_corrected) AS user_corrected,
    CASE WHEN g.user_corrected THEN false ELSE s.low_confidence END AS low_confidence,
    s.client_timestamp,
    coalesce(
      s.image_url,
      (
        SELECT sp.image_url FROM public.story_photos sp
        WHERE sp.story_id = s.id
          AND sp.photo_role = 'primary'
          AND sp.visibility = 'public'
          AND sp.moderation_status = 'approved'
          AND sp.deleted_at IS NULL
        LIMIT 1
      )
    ) AS image_url,
    s.portrait_left_url, s.portrait_right_url,
    s.created_at, s.updated_at,
    coalesce(up.display_name, 'Anonymous') AS contributor_name,
    s.user_id AS contributor_id,
    s.grave_id, g.marker_style, s.mentions, s.story_type, s.publication_status
  FROM public.stories s
  LEFT JOIN public.user_prefs up ON up.user_id = s.user_id
  LEFT JOIN public.graves g ON g.id = s.grave_id
  WHERE s.is_public = true
    AND s.publication_status = 'published'
    AND s.moderation_status = 'approved'
    AND s.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid()
        AND b.blocked_id = s.user_id
    )
  ORDER BY s.created_at DESC
  LIMIT greatest(1, least(p_limit, 100))
  OFFSET greatest(0, p_offset);
$$;

GRANT EXECUTE ON FUNCTION public.community_public_stories(integer, integer)
  TO anon, authenticated;

-- Keep the map location-filtered, but honor blocks made from Community Stories.
DROP FUNCTION IF EXISTS public.global_public_stories(integer);
CREATE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
RETURNS TABLE(
  id uuid, name text, dates text, biography text, location text,
  inscription text, symbols text, family_name text, notes text,
  sources jsonb, source_urls jsonb, latitude double precision,
  longitude double precision, user_corrected boolean, low_confidence boolean,
  client_timestamp bigint, image_url text, portrait_left_url text,
  portrait_right_url text, created_at timestamptz, updated_at timestamptz,
  contributor_name text, grave_id uuid, marker_style text,
  mentions jsonb, story_type text, contributor_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.name, s.dates,
    CASE
      WHEN s.has_originated_relatives
        THEN coalesce(s.public_biography, 'This public biography is being prepared.')
      ELSE coalesce(s.public_biography, s.biography)
    END AS biography,
    s.location, s.inscription, s.symbols, s.family_name, s.notes,
    s.sources, s.source_urls,
    coalesce(CASE WHEN g.user_corrected THEN g.lat END, s.latitude) AS latitude,
    coalesce(CASE WHEN g.user_corrected THEN g.lng END, s.longitude) AS longitude,
    coalesce(g.user_corrected, s.user_corrected) AS user_corrected,
    CASE WHEN g.user_corrected THEN false ELSE s.low_confidence END AS low_confidence,
    s.client_timestamp,
    s.image_url, s.portrait_left_url, s.portrait_right_url,
    s.created_at, s.updated_at,
    coalesce(up.display_name, 'Anonymous') AS contributor_name,
    s.grave_id, g.marker_style, s.mentions, s.story_type, s.user_id AS contributor_id
  FROM public.stories s
  LEFT JOIN public.user_prefs up ON up.user_id = s.user_id
  LEFT JOIN public.graves g ON g.id = s.grave_id
  WHERE s.is_public = true
    AND s.publication_status = 'published'
    AND s.moderation_status = 'approved'
    AND s.deleted_at IS NULL
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid()
        AND b.blocked_id = s.user_id
    )
  ORDER BY s.created_at DESC
  LIMIT greatest(1, least(p_limit, 500));
$$;

GRANT EXECUTE ON FUNCTION public.global_public_stories(integer)
  TO anon, authenticated;



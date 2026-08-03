-- ================================================================
-- GraveStory: forward security fixes for remembrance UGC
-- Migration 035 is already applied; keep it immutable and apply these
-- protections as a new migration before enabling the feature.
-- ================================================================

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS content_revision bigint NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS stories_remembrance_idempotency
  ON public.stories (user_id, client_timestamp, story_type)
  WHERE story_type = 'remembrance' AND client_timestamp IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_content_revision_check'
      AND conrelid = 'public.stories'::regclass
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_content_revision_check CHECK (content_revision > 0);
  END IF;
END
$$;

-- Direct client writes may still create ordinary researched rows through the
-- legacy pipeline, but remembrance provenance/publication is Worker-owned.
REVOKE INSERT (story_type, requested_visibility, publication_status,
  moderation_status, moderation_reason, moderation_attempted_at,
  terms_accepted_at, content_revision)
  ON public.stories FROM anon, authenticated;
REVOKE UPDATE (story_type, requested_visibility, publication_status,
  moderation_status, moderation_reason, moderation_attempted_at,
  terms_accepted_at, content_revision)
  ON public.stories FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_remembrance_security()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  trusted_writer boolean := coalesce(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
  content_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' AND NOT trusted_writer THEN
    IF NEW.story_type = 'remembrance' THEN
      RAISE EXCEPTION 'Remembrance stories must be created through the trusted Worker';
    END IF;
    -- Preserve the legacy researched-story publication contract. Remembrance
    -- rows are rejected above; the existing researched pipeline remains compatible
    -- until its separate server-authoritative publication migration lands.
    NEW.publication_status := CASE WHEN NEW.is_public THEN 'published' ELSE 'private' END;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT trusted_writer THEN
    IF NEW.story_type IS DISTINCT FROM OLD.story_type THEN
      RAISE EXCEPTION 'Story provenance is immutable';
    END IF;

    IF NEW.story_type = 'remembrance' THEN
      content_changed := NEW.name IS DISTINCT FROM OLD.name
        OR NEW.dates IS DISTINCT FROM OLD.dates
        OR NEW.biography IS DISTINCT FROM OLD.biography
        OR NEW.public_biography IS DISTINCT FROM OLD.public_biography
        OR NEW.has_originated_relatives IS DISTINCT FROM OLD.has_originated_relatives
        OR NEW.location IS DISTINCT FROM OLD.location
        OR NEW.inscription IS DISTINCT FROM OLD.inscription
        OR NEW.symbols IS DISTINCT FROM OLD.symbols
        OR NEW.family_name IS DISTINCT FROM OLD.family_name
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.sources IS DISTINCT FROM OLD.sources
        OR NEW.source_urls IS DISTINCT FROM OLD.source_urls
        OR NEW.mentions IS DISTINCT FROM OLD.mentions
        OR NEW.latitude IS DISTINCT FROM OLD.latitude
        OR NEW.longitude IS DISTINCT FROM OLD.longitude
        OR NEW.image_url IS DISTINCT FROM OLD.image_url
        OR NEW.portrait_left_url IS DISTINCT FROM OLD.portrait_left_url
        OR NEW.portrait_right_url IS DISTINCT FROM OLD.portrait_right_url;

      IF content_changed THEN
        NEW.content_revision := OLD.content_revision + 1;
        NEW.moderation_status := 'pending';
        NEW.publication_status := CASE
          WHEN NEW.requested_visibility = 'public' THEN 'pending'
          ELSE 'private'
        END;
        NEW.is_public := false;
        NEW.moderation_reason := 'Edited content requires moderation.';
        NEW.moderation_attempted_at := NULL;
        NEW.image_url := OLD.image_url;
      ELSE
        NEW.content_revision := OLD.content_revision;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stories_enforce_remembrance_security ON public.stories;
CREATE TRIGGER stories_enforce_remembrance_security
BEFORE INSERT OR UPDATE ON public.stories
FOR EACH ROW EXECUTE FUNCTION public.enforce_remembrance_security();

-- A remembrance photo must point at an object uploaded for the same owner and
-- story. The moderation Worker is the only actor that may approve or publish it.
CREATE OR REPLACE FUNCTION public.enforce_remembrance_story_photo_security()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  trusted_writer boolean := coalesce(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
  owner_id uuid;
  parent_type text;
BEGIN
  SELECT s.user_id, s.story_type INTO owner_id, parent_type
  FROM public.stories s WHERE s.id = NEW.story_id;

  IF parent_type = 'remembrance' AND NOT trusted_writer THEN
    IF owner_id IS DISTINCT FROM auth.uid() OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Story photo ownership mismatch';
    END IF;
    IF NEW.object_key IS NULL
      OR NEW.object_key NOT LIKE 'stories/' || auth.uid()::text || '/' || NEW.story_id::text || '/%' THEN
      RAISE EXCEPTION 'Story photos must use Worker-owned storage keys';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.visibility := 'private';
      NEW.moderation_status := 'pending';
    ELSE
      NEW.image_url := (SELECT image_url FROM public.story_photos WHERE id = NEW.id);
      NEW.object_key := (SELECT object_key FROM public.story_photos WHERE id = NEW.id);
      NEW.photo_role := (SELECT photo_role FROM public.story_photos WHERE id = NEW.id);
      NEW.sort_order := (SELECT sort_order FROM public.story_photos WHERE id = NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_photos_remembrance_security ON public.story_photos;
CREATE TRIGGER story_photos_remembrance_security
BEFORE INSERT OR UPDATE ON public.story_photos
FOR EACH ROW EXECUTE FUNCTION public.enforce_remembrance_story_photo_security();

-- Remembrance gallery rows are served from story_photos after moderation. Do
-- not let the legacy grave-photo mirror create a second unmoderated path.
CREATE OR REPLACE FUNCTION public.enforce_remembrance_grave_photo_security()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  trusted_writer boolean := coalesce(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
  parent_type text;
BEGIN
  SELECT story_type INTO parent_type FROM public.stories WHERE id = NEW.story_id;
  IF parent_type = 'remembrance' AND NOT trusted_writer THEN
    RAISE EXCEPTION 'Remembrance gallery photos are Worker-controlled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grave_photos_remembrance_security ON public.grave_photos;
CREATE TRIGGER grave_photos_remembrance_security
BEFORE INSERT OR UPDATE ON public.grave_photos
FOR EACH ROW EXECUTE FUNCTION public.enforce_remembrance_grave_photo_security();

-- Blocks apply consistently to both story and photo discovery surfaces.
DROP POLICY IF EXISTS "story_photos_public_select" ON public.story_photos;
CREATE POLICY "story_photos_public_select"
  ON public.story_photos FOR SELECT
  USING (
    deleted_at IS NULL
    AND visibility = 'public'
    AND moderation_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_photos.story_id
        AND s.is_public = true
        AND s.publication_status = 'published'
        AND s.moderation_status = 'approved'
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.user_blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = s.user_id
        )
    )
  );

DROP POLICY IF EXISTS "grave_photos_public_select" ON public.grave_photos;
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
        AND NOT EXISTS (
          SELECT 1 FROM public.user_blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = s.user_id
        )
    )
  );

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
    CASE WHEN s.has_originated_relatives
      THEN coalesce(s.public_biography, 'This public biography is being prepared.')
      ELSE coalesce(s.public_biography, s.biography) END,
    s.location, s.inscription, s.symbols, s.family_name, s.notes,
    s.sources, s.source_urls,
    coalesce(CASE WHEN g.user_corrected THEN g.lat END, s.latitude),
    coalesce(CASE WHEN g.user_corrected THEN g.lng END, s.longitude),
    coalesce(g.user_corrected, s.user_corrected),
    CASE WHEN g.user_corrected THEN false ELSE s.low_confidence END,
    s.client_timestamp, coalesce(s.image_url, (
      SELECT sp.image_url FROM public.story_photos sp
      WHERE sp.story_id = s.id AND sp.photo_role = 'primary'
        AND sp.visibility = 'public' AND sp.moderation_status = 'approved'
        AND sp.deleted_at IS NULL LIMIT 1
    )), s.portrait_left_url, s.portrait_right_url,
    s.created_at, s.updated_at, coalesce(up.display_name, 'Anonymous'),
    s.user_id, s.grave_id, g.marker_style, s.mentions, s.story_type,
    s.publication_status
  FROM public.stories s
  LEFT JOIN public.user_prefs up ON up.user_id = s.user_id
  LEFT JOIN public.graves g ON g.id = s.grave_id
  WHERE s.is_public = true AND s.publication_status = 'published'
    AND s.moderation_status = 'approved' AND s.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = s.user_id
    )
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.global_public_stories(p_limit integer DEFAULT 500)
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
    CASE WHEN s.has_originated_relatives
      THEN coalesce(s.public_biography, 'This public biography is being prepared.')
      ELSE coalesce(s.public_biography, s.biography) END,
    s.location, s.inscription, s.symbols, s.family_name, s.notes,
    s.sources, s.source_urls,
    coalesce(CASE WHEN g.user_corrected THEN g.lat END, s.latitude),
    coalesce(CASE WHEN g.user_corrected THEN g.lng END, s.longitude),
    coalesce(g.user_corrected, s.user_corrected),
    CASE WHEN g.user_corrected THEN false ELSE s.low_confidence END,
    s.client_timestamp, s.image_url, s.portrait_left_url,
    s.portrait_right_url, s.created_at, s.updated_at,
    coalesce(up.display_name, 'Anonymous'), s.grave_id, g.marker_style,
    s.mentions, s.story_type, s.user_id
  FROM public.stories s
  LEFT JOIN public.user_prefs up ON up.user_id = s.user_id
  LEFT JOIN public.graves g ON g.id = s.grave_id
  WHERE s.is_public = true AND s.publication_status = 'published'
    AND s.moderation_status = 'approved' AND s.deleted_at IS NULL
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = s.user_id
    )
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
$$;

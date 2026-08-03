-- ================================================================
-- GraveStory: service-role human moderation for remembrances
-- Migration 036 may already be live. Keep it immutable and apply this
-- forward-only operator path before enabling the feature.
-- ================================================================

-- Failed draft cleanup must permit a same-timestamp retry. Migration 036's
-- index included soft-deleted rows, so a failed primary-photo link could make
-- the form's stable retry key unusable forever.
DROP INDEX IF EXISTS public.stories_remembrance_idempotency;
CREATE UNIQUE INDEX stories_remembrance_idempotency
  ON public.stories (user_id, client_timestamp, story_type)
  WHERE story_type = 'remembrance'
    AND client_timestamp IS NOT NULL
    AND deleted_at IS NULL;

-- Once deletion begins, a late client link must not create a new active photo
-- row. The upload Worker also rechecks after R2 put; this database gate closes
-- the remaining authorization-to-insert window.
CREATE OR REPLACE FUNCTION public.block_remembrance_photo_during_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stories AS s
    WHERE s.id = NEW.story_id
      AND s.story_type = 'remembrance'
      AND (
        s.deleted_at IS NOT NULL
        OR s.moderation_status = 'removed'
        OR s.publication_status = 'removed'
      )
  ) THEN
    RAISE EXCEPTION 'cannot add a photo while remembrance deletion is in progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_photos_block_remembrance_deletion ON public.story_photos;
CREATE TRIGGER story_photos_block_remembrance_deletion
BEFORE INSERT ON public.story_photos
FOR EACH ROW EXECUTE FUNCTION public.block_remembrance_photo_during_deletion();

-- Removed remembrances are terminal. This database gate backs the Worker CAS
-- filters so a visibility request, delayed moderation call, or account-delete
-- retry cannot revive a story after deletion/takedown has started.
CREATE OR REPLACE FUNCTION public.block_remembrance_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.story_type = 'remembrance'
    AND (OLD.moderation_status = 'removed' OR OLD.publication_status = 'removed')
    AND (
      NEW.moderation_status <> 'removed'
      OR NEW.publication_status <> 'removed'
      OR NEW.is_public IS TRUE
    ) THEN
    RAISE EXCEPTION 'removed remembrances cannot be reactivated'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stories_block_remembrance_reactivation ON public.stories;
CREATE TRIGGER stories_block_remembrance_reactivation
BEFORE UPDATE ON public.stories
FOR EACH ROW EXECUTE FUNCTION public.block_remembrance_reactivation();

-- Reserve one of four durable upload slots before writing private R2. The
-- story row lock serializes concurrent reservations, and the row remains until
-- the corresponding story_photos insert links it (or an explicit discard
-- releases it). This prevents parallel/lost-response uploads from bypassing the
-- four-photo storage limit.
CREATE TABLE IF NOT EXISTS public.remembrance_photo_uploads (
  upload_id uuid PRIMARY KEY,
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  content_revision bigint NOT NULL CHECK (content_revision > 0),
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 3),
  writer_token uuid,
  write_started_at timestamptz,
  uploaded_at timestamptz,
  linked_at timestamptz,
  cleanup_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, slot)
);

ALTER TABLE public.remembrance_photo_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.remembrance_photo_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remembrance_photo_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_remembrance_photo_upload(
  p_story_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_upload_id uuid,
  p_object_key text,
  p_writer_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision bigint;
  v_slot smallint;
  v_existing public.remembrance_photo_uploads%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role upload reservation is required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'expected revision must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_writer_token IS NULL THEN
    RAISE EXCEPTION 'writer token is required' USING ERRCODE = '22023';
  END IF;
  IF p_object_key IS NULL OR p_object_key !~ (
    '^stories/' || p_user_id::text || '/' || p_story_id::text || '/'
      || p_upload_id::text || '\\.(jpg|png|webp)$'
  ) THEN
    RAISE EXCEPTION 'upload object key is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT s.content_revision
    INTO v_revision
  FROM public.stories AS s
  WHERE s.id = p_story_id
    AND s.user_id = p_user_id
    AND s.story_type = 'remembrance'
    AND s.deleted_at IS NULL
    AND s.moderation_status <> 'removed'
    AND s.publication_status <> 'removed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'remembrance is not available for upload' USING ERRCODE = 'P0002';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'remembrance revision changed during upload' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_existing
  FROM public.remembrance_photo_uploads AS r
  WHERE r.upload_id = p_upload_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.cleanup_claimed_at IS NOT NULL THEN
      RAISE EXCEPTION 'upload reservation is being reconciled'
        USING ERRCODE = '40001';
    END IF;
    IF v_existing.story_id IS DISTINCT FROM p_story_id
      OR v_existing.user_id IS DISTINCT FROM p_user_id
      OR v_existing.content_revision IS DISTINCT FROM p_expected_revision
      OR v_existing.object_key IS DISTINCT FROM p_object_key THEN
      RAISE EXCEPTION 'upload id is already reserved for different content'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing.linked_at IS NOT NULL THEN
      RETURN jsonb_build_object('slot', v_existing.slot, 'disposition', 'linked');
    END IF;
    IF v_existing.uploaded_at IS NOT NULL THEN
      RETURN jsonb_build_object('slot', v_existing.slot, 'disposition', 'uploaded');
    END IF;
    IF v_existing.writer_token IS NOT NULL
      AND v_existing.write_started_at > now() - interval '5 minutes' THEN
      RETURN jsonb_build_object('slot', v_existing.slot, 'disposition', 'busy');
    END IF;
    UPDATE public.remembrance_photo_uploads AS r
    SET writer_token = p_writer_token,
        write_started_at = now()
    WHERE r.upload_id = p_upload_id;
    RETURN jsonb_build_object('slot', v_existing.slot, 'disposition', 'write');
  END IF;

  SELECT candidate.slot::smallint
    INTO v_slot
  FROM generate_series(0, 3) AS candidate(slot)
  WHERE NOT EXISTS (
      SELECT 1 FROM public.remembrance_photo_uploads AS r
      WHERE r.story_id = p_story_id AND r.slot = candidate.slot
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.story_photos AS sp
      WHERE sp.story_id = p_story_id
        AND sp.sort_order = candidate.slot
        AND sp.deleted_at IS NULL
    )
  ORDER BY candidate.slot
  LIMIT 1;

  IF v_slot IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.remembrance_photo_uploads (
    upload_id, story_id, user_id, object_key, content_revision, slot,
    writer_token, write_started_at
  ) VALUES (
    p_upload_id, p_story_id, p_user_id, p_object_key, p_expected_revision, v_slot,
    p_writer_token, now()
  );
  RETURN jsonb_build_object('slot', v_slot, 'disposition', 'write');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_remembrance_photo_upload(
  p_upload_id uuid,
  p_story_id uuid,
  p_user_id uuid,
  p_object_key text,
  p_writer_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role upload release is required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.remembrance_photo_uploads AS r
  WHERE r.upload_id = p_upload_id
    AND r.story_id = p_story_id
    AND r.user_id = p_user_id
    AND r.object_key = p_object_key
    AND r.linked_at IS NULL
    AND (
      (p_writer_token IS NOT NULL AND r.writer_token = p_writer_token)
      OR (p_writer_token IS NULL AND r.writer_token IS NULL)
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_remembrance_photo_upload(
  p_upload_id uuid,
  p_story_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_object_key text,
  p_writer_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role upload confirmation is required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.remembrance_photo_uploads AS r
  SET uploaded_at = coalesce(r.uploaded_at, now()),
      writer_token = NULL,
      write_started_at = NULL
  FROM public.stories AS s
  WHERE r.upload_id = p_upload_id
    AND r.story_id = p_story_id
    AND r.user_id = p_user_id
    AND r.object_key = p_object_key
    AND r.content_revision = p_expected_revision
    AND r.writer_token = p_writer_token
    AND r.linked_at IS NULL
    AND r.cleanup_claimed_at IS NULL
    AND s.id = r.story_id
    AND s.user_id = r.user_id
    AND s.story_type = 'remembrance'
    AND s.content_revision = p_expected_revision
    AND s.deleted_at IS NULL
    AND s.moderation_status <> 'removed'
    AND s.publication_status <> 'removed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_remembrance_photo_upload_discard(
  p_upload_id uuid,
  p_story_id uuid,
  p_user_id uuid,
  p_object_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role upload discard claim is required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.remembrance_photo_uploads AS r
  SET cleanup_claimed_at = now()
  WHERE r.upload_id = p_upload_id
    AND r.story_id = p_story_id
    AND r.user_id = p_user_id
    AND r.object_key = p_object_key
    AND r.linked_at IS NULL
    AND r.cleanup_claimed_at IS NULL
    AND r.writer_token IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_expired_remembrance_photo_uploads(
  p_story_id uuid,
  p_user_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE(upload_id uuid, object_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role upload reconciliation is required' USING ERRCODE = '42501';
  END IF;
  IF p_cutoff IS NULL OR p_cutoff > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'cleanup cutoff must be at least 15 minutes old' USING ERRCODE = '22023';
  END IF;

  PERFORM s.id
  FROM public.stories AS s
  WHERE s.id = p_story_id
    AND s.user_id = p_user_id
    AND s.story_type = 'remembrance'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remembrance not found for upload reconciliation' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.remembrance_photo_uploads AS r
  SET cleanup_claimed_at = now(),
      writer_token = NULL,
      write_started_at = NULL
  WHERE r.story_id = p_story_id
    AND r.user_id = p_user_id
    AND r.linked_at IS NULL
    AND r.created_at <= p_cutoff
    AND (
      r.cleanup_claimed_at IS NULL
      OR r.cleanup_claimed_at <= now() - interval '5 minutes'
    )
    AND (
      r.writer_token IS NULL
      OR r.write_started_at <= now() - interval '5 minutes'
    )
  RETURNING r.upload_id, r.object_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_remembrance_photo_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.stories AS s
    WHERE s.id = NEW.story_id AND s.story_type = 'remembrance'
  ) THEN
    UPDATE public.remembrance_photo_uploads AS r
    SET linked_at = coalesce(r.linked_at, now())
    FROM public.stories AS s
    WHERE r.story_id = NEW.story_id
      AND r.user_id = NEW.user_id
      AND r.object_key = NEW.object_key
      AND r.slot = NEW.sort_order
      AND r.cleanup_claimed_at IS NULL
      AND r.uploaded_at IS NOT NULL
      AND r.writer_token IS NULL
      AND s.id = r.story_id
      AND s.user_id = r.user_id
      AND s.story_type = 'remembrance'
      AND s.content_revision = r.content_revision
      AND s.deleted_at IS NULL
      AND s.moderation_status <> 'removed'
      AND s.publication_status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'story photo has no matching Worker upload reservation'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_photos_link_remembrance_upload ON public.story_photos;
CREATE TRIGGER story_photos_link_remembrance_upload
BEFORE INSERT ON public.story_photos
FOR EACH ROW EXECUTE FUNCTION public.link_remembrance_photo_upload();

REVOKE ALL ON FUNCTION public.reserve_remembrance_photo_upload(
  uuid, uuid, bigint, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_remembrance_photo_upload(
  uuid, uuid, bigint, uuid, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.release_remembrance_photo_upload(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_remembrance_photo_upload(
  uuid, uuid, uuid, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.claim_remembrance_photo_upload_discard(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_remembrance_photo_upload_discard(
  uuid, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.moderate_remembrance_operator(
  p_story_id uuid,
  p_expected_revision bigint,
  p_expected_photo_ids uuid[],
  p_expected_object_keys text[],
  p_worker_origin text,
  p_decision text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_revision bigint;
  v_requested_visibility text;
  v_moderation_status text;
  v_publication_status text;
  v_is_public boolean;
  v_expected_ids uuid[];
  v_expected_keys text[];
  v_current_ids uuid[];
  v_current_keys text[];
  v_primary_object_key text;
  v_primary_image_url text;
  v_photo_count integer;
  v_updated integer;
  v_public boolean := p_decision = 'approved';
  v_target_moderation_status text := CASE WHEN p_decision = 'review' THEN 'pending' ELSE p_decision END;
  v_target_publication_status text := CASE WHEN p_decision = 'approved' THEN 'published'
    WHEN p_decision = 'rejected' THEN 'rejected' ELSE 'pending' END;
BEGIN
  -- SECURITY DEFINER is defense in depth only. Keep an explicit caller check
  -- so a future accidental grant cannot turn this into a client approval API.
  IF coalesce(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service-role moderation is required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected', 'review') THEN
    RAISE EXCEPTION 'decision must be approved, rejected, or review' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'expected revision must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'a moderation reason of 1-1000 characters is required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_origin IS NULL
    OR p_worker_origin !~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9](:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'worker origin must be an exact lowercase HTTPS origin' USING ERRCODE = '22023';
  END IF;
  IF p_expected_photo_ids IS NULL OR p_expected_object_keys IS NULL
    OR cardinality(p_expected_photo_ids) <> cardinality(p_expected_object_keys)
    OR cardinality(p_expected_photo_ids) < 1
    OR cardinality(p_expected_photo_ids) > 4 THEN
    RAISE EXCEPTION 'expected photo ids and object keys must contain the same 1-4 items'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.user_id, s.content_revision, s.requested_visibility,
         s.moderation_status, s.publication_status, s.is_public
    INTO v_user_id, v_revision, v_requested_visibility,
         v_moderation_status, v_publication_status, v_is_public
  FROM public.stories AS s
  WHERE s.id = p_story_id
    AND s.story_type = 'remembrance'
    AND s.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'remembrance not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'remembrance revision changed; reload the queue item'
      USING ERRCODE = '40001';
  END IF;
  IF v_requested_visibility <> 'public' THEN
    RAISE EXCEPTION 'remembrance is no longer awaiting public review'
      USING ERRCODE = '40001';
  END IF;

  SELECT array_agg(expected.photo_id ORDER BY expected.photo_id),
         array_agg(expected.object_key ORDER BY expected.photo_id),
         count(*)::integer
    INTO v_expected_ids, v_expected_keys, v_photo_count
  FROM unnest(p_expected_photo_ids, p_expected_object_keys)
    AS expected(photo_id, object_key);

  IF EXISTS (
    SELECT 1
    FROM unnest(p_expected_photo_ids, p_expected_object_keys)
      AS expected(photo_id, object_key)
    WHERE expected.photo_id IS NULL
      OR expected.object_key IS NULL
      OR btrim(expected.object_key) = ''
      OR expected.object_key NOT LIKE
        'stories/' || v_user_id::text || '/' || p_story_id::text || '/%'
  ) OR (
    SELECT count(DISTINCT photo_id)
    FROM unnest(p_expected_photo_ids) AS ids(photo_id)
  ) <> v_photo_count THEN
    RAISE EXCEPTION 'expected photo set is invalid' USING ERRCODE = '22023';
  END IF;

  -- Lock the reviewed rows before comparing and updating them. A newly added
  -- photo remains pending/private and is never approved by this exact-set call.
  PERFORM sp.id
  FROM public.story_photos AS sp
  WHERE sp.story_id = p_story_id
    AND sp.deleted_at IS NULL
  FOR UPDATE;

  SELECT array_agg(sp.id ORDER BY sp.id),
         array_agg(sp.object_key ORDER BY sp.id),
         count(*)::integer
    INTO v_current_ids, v_current_keys, v_photo_count
  FROM public.story_photos AS sp
  WHERE sp.story_id = p_story_id
    AND sp.user_id = v_user_id
    AND sp.deleted_at IS NULL;

  IF v_current_ids IS DISTINCT FROM v_expected_ids
    OR v_current_keys IS DISTINCT FROM v_expected_keys THEN
    RAISE EXCEPTION 'remembrance photo set changed; reload the queue item'
      USING ERRCODE = '40001';
  END IF;

  SELECT sp.object_key
    INTO v_primary_object_key
  FROM public.story_photos AS sp
  WHERE sp.story_id = p_story_id
    AND sp.id = ANY(p_expected_photo_ids)
    AND sp.photo_role = 'primary'
    AND sp.deleted_at IS NULL;

  IF v_primary_object_key IS NULL THEN
    RAISE EXCEPTION 'reviewed photo set has no primary image' USING ERRCODE = '22023';
  END IF;
  v_primary_image_url := p_worker_origin || '/story-photo?key='
    || replace(v_primary_object_key, '/', '%2F');

  -- A lost response can be retried with the same exact inputs without
  -- changing state a second time. A conflicting terminal decision is refused.
  IF v_moderation_status IN ('approved', 'rejected') THEN
    IF v_moderation_status <> v_target_moderation_status
      OR v_publication_status <> v_target_publication_status
      OR v_is_public IS DISTINCT FROM v_public
      OR EXISTS (
        SELECT 1
        FROM public.story_photos AS sp
        WHERE sp.id = ANY(p_expected_photo_ids)
          AND (sp.moderation_status <> v_target_moderation_status
            OR sp.visibility <> CASE WHEN v_public THEN 'public' ELSE 'private' END)
      ) THEN
      RAISE EXCEPTION 'remembrance already has a conflicting moderation result'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.story_photos AS sp
    SET image_url = p_worker_origin || '/story-photo?key='
        || replace(sp.object_key, '/', '%2F'),
        updated_at = now()
    WHERE sp.id = ANY(p_expected_photo_ids)
      AND sp.story_id = p_story_id
      AND sp.deleted_at IS NULL
      AND sp.image_url IS DISTINCT FROM p_worker_origin || '/story-photo?key='
        || replace(sp.object_key, '/', '%2F');
    UPDATE public.stories AS s
    SET image_url = v_primary_image_url
    WHERE s.id = p_story_id
      AND s.image_url IS DISTINCT FROM v_primary_image_url;
    RETURN true;
  END IF;

  IF v_moderation_status <> 'pending' THEN
    RAISE EXCEPTION 'remembrance is not pending moderation' USING ERRCODE = '40001';
  END IF;

  UPDATE public.story_photos AS sp
  SET image_url = p_worker_origin || '/story-photo?key='
        || replace(sp.object_key, '/', '%2F'),
      moderation_status = v_target_moderation_status,
      visibility = CASE WHEN v_public THEN 'public' ELSE 'private' END,
      updated_at = now()
  WHERE sp.story_id = p_story_id
    AND sp.user_id = v_user_id
    AND sp.id = ANY(p_expected_photo_ids)
    AND sp.deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_photo_count THEN
    RAISE EXCEPTION 'remembrance photo set changed during moderation'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.stories AS s
  SET image_url = v_primary_image_url,
      moderation_status = v_target_moderation_status,
      moderation_reason = btrim(p_reason),
      moderation_attempted_at = now(),
      publication_status = v_target_publication_status,
      is_public = v_public
  WHERE s.id = p_story_id
    AND s.story_type = 'remembrance'
    AND s.content_revision = p_expected_revision
    AND s.requested_visibility = 'public'
    AND s.moderation_status = 'pending'
    AND s.deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'remembrance changed during moderation' USING ERRCODE = '40001';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_remembrance_operator(
  uuid, bigint, uuid[], text[], text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_remembrance_operator(
  uuid, bigint, uuid[], text[], text, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.claim_expired_remembrance_photo_uploads(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_remembrance_photo_uploads(
  uuid, uuid, timestamptz
) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_remembrance_photo_upload(
  uuid, uuid, uuid, bigint, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_remembrance_photo_upload(
  uuid, uuid, uuid, bigint, text, uuid
) TO service_role;

-- ================================================================
-- GraveStory: repair remembrance photo object-key validation
-- Forward-only fix for migration 037. Do not edit or re-run 037.
-- ================================================================

-- Migration 037 used two backslashes in a standard-conforming PostgreSQL
-- string for its regular expression. That pattern expected a literal
-- backslash in otherwise valid object keys, so every photo reservation failed
-- before R2 upload. Exact comparisons avoid escape-sensitive regex behavior.
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
  IF p_object_key IS NULL OR p_object_key NOT IN (
    'stories/' || p_user_id::text || '/' || p_story_id::text || '/'
      || p_upload_id::text || '.jpg',
    'stories/' || p_user_id::text || '/' || p_story_id::text || '/'
      || p_upload_id::text || '.png',
    'stories/' || p_user_id::text || '/' || p_story_id::text || '/'
      || p_upload_id::text || '.webp'
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

REVOKE ALL ON FUNCTION public.reserve_remembrance_photo_upload(
  uuid, uuid, bigint, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_remembrance_photo_upload(
  uuid, uuid, bigint, uuid, text, uuid
) TO service_role;

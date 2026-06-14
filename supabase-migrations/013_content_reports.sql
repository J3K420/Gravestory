-- ================================================================
-- GraveStory: content reports (user-flagged AI biographies)
-- Paste into Supabase SQL editor and run.
-- ================================================================
--
-- Powers the in-app "Report this story" button on every AI-generated bio
-- (web + mobile). Satisfies Google Play's AI-Generated Content policy
-- (in-app reporting requirement) and is the operational channel for the
-- defamation / privacy-takedown mitigation: a grieving relative who finds
-- a wrong or hurtful public bio can flag it without needing an account.
--
-- RLS DESIGN (matches the scan_credits pattern — see reference-rls-load-bearing):
--   * INSERT is open to EVERYONE (anon + authenticated) so guests can report.
--   * There is NO SELECT / UPDATE / DELETE policy, so normal anon/authenticated
--     roles can never read, edit, or delete reports. Only the service role
--     (which bypasses RLS) can read them — via the Supabase dashboard or the
--     local metrics-digest tool. This keeps one user from enumerating others'
--     reports and keeps the queue tamper-proof.
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  story_ts     TEXT,                       -- the reported story's client timestamp (links to the local/cloud row)
  grave_id     UUID        REFERENCES public.graves(id) ON DELETE SET NULL,
  person_name  TEXT,                       -- denormalized so a report is readable even if the story is later deleted
  reason       TEXT        NOT NULL CHECK (reason IN (
                 'factual_error', 'wrong_person', 'offensive', 'privacy', 'other')),
  note         TEXT,                       -- optional free-text from the reporter (length-capped on the client)
  reporter_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL when reported by a guest
  is_public    BOOLEAN     NOT NULL DEFAULT FALSE,  -- was the reported bio a public/global story? (triage priority)
  platform     TEXT,                       -- 'web' | 'mobile' (light context)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_reports_created
  ON public.content_reports (created_at DESC);

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Anyone (guest or signed-in) may file a report. A signed-in user may only
-- stamp their OWN id as reporter (or leave it NULL); a guest leaves it NULL.
-- This prevents a signed-in user from forging a report as someone else while
-- still allowing fully anonymous reports.
CREATE POLICY "content_reports_insert_anyone"
  ON public.content_reports FOR INSERT
  WITH CHECK (reporter_id IS NULL OR reporter_id = auth.uid());

-- TABLE-LEVEL GRANT (required, not optional). An RLS policy only governs WHICH
-- rows a role may touch — the role still needs table-level INSERT privilege
-- first. A brand-new table does NOT inherit anon's grants, so without this the
-- anon (guest) insert is rejected with "new row violates row-level security
-- policy" (PostgREST 401 / SQLSTATE 42501) even though the policy WITH CHECK
-- passes. Verified necessary on this project 2026-06-14. See migration 009 +
-- memory reference-rls-load-bearing. GRANT is idempotent.
GRANT INSERT ON public.content_reports TO anon;
GRANT INSERT ON public.content_reports TO authenticated;

-- NO SELECT / UPDATE / DELETE policies or grants on purpose: reports are
-- write-only for clients and readable only by the service role (dashboard /
-- digest).

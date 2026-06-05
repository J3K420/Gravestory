-- Scan events table: one row per successful scan per user.
-- Client can INSERT and SELECT their own rows only.
-- No UPDATE or DELETE policy means those operations are blocked by RLS.
-- Monthly scan count = COUNT(*) WHERE user_id = me AND scanned_at >= start of month.

CREATE TABLE IF NOT EXISTS scan_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scanned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_events_user_month
  ON scan_events (user_id, scanned_at);

ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

-- Users can see their own scan history
CREATE POLICY "users_select_own_scans"
  ON scan_events FOR SELECT
  USING (auth.uid() = user_id);

-- Users can record a new scan for themselves
CREATE POLICY "users_insert_own_scans"
  ON scan_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE policies — rows are immutable once written.

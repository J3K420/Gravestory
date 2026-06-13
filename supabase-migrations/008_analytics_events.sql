-- Funnel telemetry: one row per product event (scan_started, verification_rejected,
-- bio_shown, story_saved, made_public, paywall_shown, …). Lets us see WHERE users
-- fall off in the scan funnel instead of inferring from the lifetime scan_events counter
-- (which is empty for is_unlimited testers and only counts completed scans anyway).
--
-- user_id is NULLABLE: guests and signed-out events carry NULL.
-- Client may INSERT only. No SELECT/UPDATE/DELETE policy means reads happen
-- service-side (SQL editor / service role), never from the browser or app.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event       text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform    text,                       -- 'web' | 'ios' | 'android'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_event_created
  ON analytics_events (event, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_user_created
  ON analytics_events (user_id, created_at);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Anyone (authenticated or anon) may log an event for themselves or as a guest.
-- A signed-in user can only attribute an event to their own uid; guest rows use NULL.
CREATE POLICY "anyone_insert_own_events"
  ON analytics_events FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- No SELECT / UPDATE / DELETE policies — events are immutable and read service-side only.

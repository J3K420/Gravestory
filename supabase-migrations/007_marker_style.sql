-- 007_marker_style.sql
-- Per-grave marker style for the user's My Cemetery map (mobile).
-- Stores the chosen GraveMarkers.js style id (e.g. 'cross', 'obelisk', 'rose').
-- NULL / unknown values fall back to the default 'book' marker client-side,
-- so existing stories are unaffected. Not shown on the global community map.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS marker_style text;

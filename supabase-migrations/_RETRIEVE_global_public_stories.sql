-- ================================================================
-- RETRIEVAL TASK — NOT a migration. Do NOT run this top-to-bottom.
-- ================================================================
--
-- The `global_public_stories` RPC (read by js/map-global.js +
-- mobile/src/screens/GlobalMapScreen.js to populate the community
-- global map) was authored directly in the Supabase SQL editor and
-- was NEVER captured in a migration file. It is the ONLY grave/story
-- RPC missing from this repo. That gap blocks two planned features:
--   * global-map pin scaling (the 500-row fetch cap / clustering)
--   * marker packs (needs to join graves.marker_style into its output)
--
-- GOAL: recover the live function body and paste it into the marked
-- block below, then commit this file so the definition is finally
-- under version control.
--
-- This file has NO numeric prefix and is named _RETRIEVE_* on purpose
-- so it is never mistaken for a runnable migration in the 001–010
-- sequence. Once the body is filled in and reviewed, we may rename it
-- to a proper NNN_*.sql migration (CREATE OR REPLACE is idempotent).
-- ================================================================


-- ----------------------------------------------------------------
-- STEP 1 — RUN THIS in the Supabase SQL editor (Dashboard → SQL
-- Editor → New query) and copy the `definition` column from the
-- result. This is the ONLY statement here meant to be executed.
-- ----------------------------------------------------------------
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'global_public_stories';

-- If the query above returns MORE THAN ONE row (an overloaded function
-- with different argument signatures), run this instead to disambiguate
-- and see each variant's argument list alongside its body:
--
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        pg_get_functiondef(p.oid)                 AS definition
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'global_public_stories';


-- ================================================================
-- STEP 2 — PASTE the recovered function body between the markers
-- below (replace this whole placeholder), then save + commit.
-- ================================================================

-- >>> BEGIN RECOVERED global_public_stories DEFINITION >>>

-- (paste the `definition` text from STEP 1 here)

-- <<< END RECOVERED global_public_stories DEFINITION <<<


-- ================================================================
-- STEP 3 — Once pasted, confirm these four facts (they decide the
-- pin-scaling and marker-packs plans — see the project memory):
--   1. ORDER BY column — is the surviving set really "most recent",
--      and by which column (created_at / client_timestamp /
--      updated_at)?
--   2. Where p_limit is applied (and the default value).
--   3. Whether any dedup / DISTINCT / GROUP BY happens INSIDE the
--      function, or only client-side in map-global.js.
--   4. The exact RETURN columns (so a future marker_style join and
--      any bbox/viewport params slot in cleanly).
-- ================================================================

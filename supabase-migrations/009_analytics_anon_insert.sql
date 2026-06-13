-- ⚠️ CONFIRMED NO-OP (2026-06-13) — DO NOT NEED TO RUN.
-- A role_table_grants check showed `anon` ALREADY has INSERT (in fact full CRUD)
-- on analytics_events on this project, so guest telemetry was never blocked. This
-- file is kept only as a harmless, idempotent safety net / documentation. The
-- original concern (below) was based on a wrong assumption about this project's
-- default grants. See memory: reference-rls-load-bearing.
--
-- Fix: allow GUEST (signed-out) telemetry into analytics_events.
--
-- Migration 008 added an RLS INSERT policy that permits user_id IS NULL (guest
-- events), but an RLS policy only governs WHICH rows a role may touch — the role
-- still needs table-level INSERT privilege first. Every prior table in this repo
-- is authenticated-only, so `anon` was never granted INSERT and Supabase's default
-- public-schema grants do not reliably give it. Result: guest logEvent inserts were
-- silently rejected (logEvent swallows the error), so the funnel showed ZERO guest
-- events — false "guests don't engage" data.
--
-- This grants table-level INSERT to anon + authenticated. The 008 RLS policy still
-- constrains rows (a signed-in user can only attribute to their own uid; guests use
-- NULL). GRANT is idempotent — safe to run even if the privilege already exists.
--
-- To check whether this was needed on your project:
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'analytics_events' and grantee in ('anon','authenticated');
-- If 'anon | INSERT' is already present, this migration is a harmless no-op.

GRANT INSERT ON public.analytics_events TO anon;
GRANT INSERT ON public.analytics_events TO authenticated;

-- No SELECT/UPDATE/DELETE grants — events stay write-only from clients; reads are
-- service-side only (consistent with the 008 policy design).

-- Fix: allow GUEST (and signed-in) reports to actually insert into content_reports.
--
-- Migration 013 created the table + an RLS INSERT policy permitting reporter_id
-- IS NULL (guest reports), but the brand-new table did not inherit anon's
-- table-level INSERT grant. Result: every report submission was rejected with
-- "new row violates row-level security policy" (PostgREST 401 / SQLSTATE 42501)
-- — the RLS policy passes, but the role lacks the underlying privilege.
-- Confirmed live on this project 2026-06-14 via an anon-key insert test.
--
-- This grant is the same fix pattern as migration 009 (analytics_events).
-- Idempotent — safe to run even if already applied. Run this if you already ran
-- migration 013 before it included the GRANT lines.
--
-- To verify afterward:
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'content_reports' and grantee in ('anon','authenticated');
-- You should see anon | INSERT and authenticated | INSERT (and no SELECT).

GRANT INSERT ON public.content_reports TO anon;
GRANT INSERT ON public.content_reports TO authenticated;

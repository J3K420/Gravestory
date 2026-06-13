-- GraveStory — analytics & monetization queries
-- Paste any of these into the Supabase SQL editor. Read-only (no writes).
-- Requires migration 008_analytics_events.sql to be run first for the funnel queries.
--
-- Tester model reminder: only the 2 dev accounts are is_unlimited; the ~12 closed
-- testers are normal free users buying with a Google Play test card. So the
-- monetization funnel below IS exercised by the cohort.

-- ─────────────────────────────────────────────────────────────────────
-- VERIFY THE MIGRATION TOOK
-- ─────────────────────────────────────────────────────────────────────

-- Table exists and RLS is on
select tablename, rowsecurity
from pg_tables
where tablename = 'analytics_events';

-- Exactly one INSERT policy, no SELECT/UPDATE/DELETE
select policyname, cmd
from pg_policies
where tablename = 'analytics_events';

-- CRITICAL: does the anon role have table-level INSERT? Without it, GUEST events
-- are silently rejected (the RLS policy permits NULL user_id, but the anon role
-- needs the table grant first). Expect BOTH 'anon | INSERT' and
-- 'authenticated | INSERT'. If 'anon' is missing, run migration 009.
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'analytics_events'
  and grantee in ('anon', 'authenticated');

-- ─────────────────────────────────────────────────────────────────────
-- SANITY: ARE EVENTS LANDING (both signed-in AND guest)?
-- ─────────────────────────────────────────────────────────────────────

-- Most recent events (after a scan or tapping "See an example")
select event, platform, created_at, props
from analytics_events
order by created_at desc
limit 20;

-- Both auth paths producing events? Do one signed-in action and one signed-out
-- (guest) action, then expect TWO rows here, both with count > 0. If 'guest' is
-- missing or zero, the anon INSERT grant (migration 009) is the likely cause.
select
  case when user_id is not null then 'signed_in' else 'guest' end as auth_path,
  count(*) as event_count
from analytics_events
group by user_id is not null
order by user_id is not null;

-- Event volume by type, last 7 days
select event, count(*) as n
from analytics_events
where created_at > now() - interval '7 days'
group by event
order by n desc;

-- ─────────────────────────────────────────────────────────────────────
-- SCAN FUNNEL — where do people drop off?
-- ─────────────────────────────────────────────────────────────────────

-- Absolute counts down the funnel, last 30 days
select
  count(*) filter (where event = 'scan_started')          as started,
  count(*) filter (where event = 'verification_rejected') as verify_rejected,
  count(*) filter (where event = 'ocr_done')              as ocr_done,
  count(*) filter (where event = 'bio_cache_hit')         as cache_hits,
  count(*) filter (where event = 'bio_shown')             as bio_shown,
  count(*) filter (where event = 'story_saved')           as saved,
  count(*) filter (where event = 'made_public')           as made_public,
  count(*) filter (where event = 'pipeline_error')        as errors
from analytics_events
where created_at > now() - interval '30 days';

-- Per-user funnel (distinct users reaching each stage) — engagement view
select
  count(distinct user_id) filter (where event = 'scan_started') as users_scanned,
  count(distinct user_id) filter (where event = 'bio_shown')    as users_got_bio,
  count(distinct user_id) filter (where event = 'story_saved')  as users_saved,
  count(distinct user_id) filter (where event = 'scan_limit_hit') as users_hit_wall
from analytics_events
where created_at > now() - interval '30 days';

-- OCR confidence distribution (props->>'confidence' is high/medium/low)
select props->>'confidence' as confidence, count(*) as n
from analytics_events
where event = 'ocr_done'
group by 1
order by n desc;

-- Pipeline errors broken out by stage/reason (research timeouts surface here)
select props->>'stage' as stage, props->>'reason' as reason, count(*) as n
from analytics_events
where event = 'pipeline_error'
group by 1, 2
order by n desc;

-- Sample-story engagement (first-run "See an example" taps)
select platform, count(*) as views
from analytics_events
where event = 'sample_viewed'
group by platform;

-- ─────────────────────────────────────────────────────────────────────
-- MONETIZATION — does the test purchase actually grant credits?
-- ─────────────────────────────────────────────────────────────────────

-- Credits per user, most recently updated first. After a tester's test-card
-- buy, `purchased` should bump. If it doesn't, the RevenueCat→Worker webhook
-- didn't fire — that's the fragile link to investigate.
select user_id, purchased, updated_at
from scan_credits
order by updated_at desc
limit 20;

-- Who hit the wall vs who bought (conversion at the paywall)
select
  count(distinct user_id) filter (where event = 'scan_limit_hit') as hit_wall
from analytics_events
where created_at > now() - interval '30 days';
-- ^ compare against scan_credits rows created/bumped in the same window

-- Lifetime scans per user (excludes the 2 is_unlimited dev accounts, which
-- never write scan_events)
select user_id, count(*) as scans, max(scanned_at) as last_scan
from scan_events
group by user_id
order by scans desc;

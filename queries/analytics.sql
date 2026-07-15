set session characteristics as transaction read only;
set transaction read only;

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

-- ─────────────────────────────────────────────────────────────────────
-- DOES THE 3-SCAN LIMIT HELP? — conversion + scans-per-user (S66)
-- ─────────────────────────────────────────────────────────────────────
-- Two theses to test:
--   (A) High-intent: GraveStory users must be in a cemetery AND already know the
--       app, so they self-select as high-intent → conversion should run ABOVE the
--       ~2% consumer-freemium benchmark. (1) below measures it.
--   (B) The 10→3 cut only changes economics for users who'd have done 4-10 free
--       scans; if most users do <=3 anyway, the cut is cost INSURANCE, not a daily
--       saving. (2) below shows the real distribution.
-- All of these use scan_events / scan_credits, so the 2 is_unlimited dev accounts
-- (which never write scan_events) are naturally excluded from the denominators.

-- (1) HEADLINE CONVERSION RATE — % of users who EVER scanned that have bought
--     at least one credit pack. This is the number that confirms/refutes the
--     high-intent thesis. >2% beats the benchmark; 8-15%+ strongly confirms it.
with scanners as (
  select distinct user_id from scan_events
),
buyers as (
  select distinct user_id from scan_credits where purchased > 0
)
select
  (select count(*) from scanners)                                      as users_who_scanned,
  (select count(*) from buyers
     where user_id in (select user_id from scanners))                  as scanners_who_bought,
  round(
    100.0 * (select count(*) from buyers
               where user_id in (select user_id from scanners))
    / nullif((select count(*) from scanners), 0)
  , 1)                                                                  as conversion_pct;

-- (2) SCANS-PER-USER DISTRIBUTION — does the 3-cap actually bite, or do most
--     users stop on their own before scan 4? Buckets the lifetime scan count.
--     If most users sit in 1-3, the 10->3 change cost almost nothing day-to-day
--     (it's spike/abuse insurance); a fat 4+ tail means the old cap was leaking.
with per_user as (
  select user_id, count(*) as scans
  from scan_events
  group by user_id
)
select
  case
    when scans = 1            then '1 scan'
    when scans = 2            then '2 scans'
    when scans = 3            then '3 scans (at the new free cap)'
    when scans between 4 and 9 then '4-9 scans (would have used old 10-cap)'
    else                           '10+ scans (heavy / purchased)'
  end as bucket,
  count(*) as users,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_of_scanners
from per_user
group by 1
order by min(scans);

-- (3) AVG FREE-SCAN COST PER NON-BUYER — the economic weight of the free tier.
--     Multiply avg_free_scans by your per-scan cost (~$0.08) for $/free user.
--     Compare to the worst-case ceiling: old 10*$0.08=$0.80, new 3*$0.08=$0.24.
select
  count(*)                              as free_users_who_scanned,
  round(avg(scans), 2)                  as avg_free_scans_per_user,
  max(scans)                            as max_free_scans
from (
  select se.user_id, count(*) as scans
  from scan_events se
  left join scan_credits sc
    on sc.user_id = se.user_id and sc.purchased > 0
  where sc.user_id is null            -- never bought = pure free rider
  group by se.user_id
) free_riders;

-- (4) CONVERSION TIMING — at how many scans had a BUYER bought? (did they pay
--     near the new 3-scan wall, or only after many free scans under the old cap?)
--     For each buyer, counts scans they logged at/before their first purchase
--     time. A cluster at ~3 supports "paywall at peak intent" working as intended.
select
  scans_before_purchase,
  count(*) as buyers
from (
  select sc.user_id,
         count(se.id) filter (where se.scanned_at <= sc.updated_at) as scans_before_purchase
  from scan_credits sc
  join scan_events se on se.user_id = sc.user_id
  where sc.purchased > 0
  group by sc.user_id, sc.updated_at
) t
group by scans_before_purchase
order by scans_before_purchase;

-- ─────────────────────────────────────────────────────────────────────
-- LOADING TIME + DROP-OFF DURING THE WAIT (S67, mobile)
-- ─────────────────────────────────────────────────────────────────────
-- The research pipeline takes up to ~30s. These read the dur_ms now carried on
-- bio_shown / pipeline_error, and the new scan_abandoned event fired when a user
-- leaves the loading screen (back-out or backgrounds the app) before it finishes.
-- CAVEAT: scan_abandoned is best-effort — a hard task-switcher kill can suspend
-- JS before the insert sends, so true abandonment is AT LEAST what's shown here.
-- stepIndex on scan_abandoned: 0 verify, 1 OCR, 2 research, 3 biography, 4 finish.

-- (1) PIPELINE DURATION DISTRIBUTION — how long does a successful scan take?
--     Split cached (bio-cache hit, near-instant) vs full pipeline so the cache
--     hits don't flatter the average. Times in seconds.
select
  case when (props->>'cached')::boolean then 'cache hit' else 'full pipeline' end as kind,
  count(*)                                              as n,
  round(avg((props->>'dur_ms')::numeric)/1000, 1)       as avg_s,
  round((percentile_cont(0.5)  within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1) as median_s,
  round((percentile_cont(0.9)  within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1) as p90_s,
  round(max((props->>'dur_ms')::numeric)/1000, 1)       as max_s
from analytics_events
where event = 'bio_shown'
  and props ? 'dur_ms'
  and created_at > now() - interval '30 days'
group by 1;

-- (2) ABANDONMENT RATE — of scans that started, how many were left mid-load?
--     started = scan_started; abandoned = scan_abandoned. (Not a per-user join;
--     a fast ratio. A high rate vs the duration above = the wait is too long.)
select
  count(*) filter (where event = 'scan_started')   as started,
  count(*) filter (where event = 'scan_abandoned') as abandoned,
  round(100.0 * count(*) filter (where event = 'scan_abandoned')
        / nullif(count(*) filter (where event = 'scan_started'), 0), 1) as abandon_pct
from analytics_events
where created_at > now() - interval '30 days';

-- (3) WHERE in the pipeline do people give up? Buckets scan_abandoned by stage,
--     with how long they'd waited before bailing. A cluster at stage 2 (research)
--     with high wait_s = the 30s research dwell is the drop-off culprit.
select
  case (props->>'stepIndex')::int
    when 0 then '0 verify'
    when 1 then '1 OCR'
    when 2 then '2 research'
    when 3 then '3 biography'
    when 4 then '4 finishing'
    else '?' end                                        as stage,
  count(*)                                              as abandoned,
  round(avg((props->>'dur_ms')::numeric)/1000, 1)       as avg_wait_s
from analytics_events
where event = 'scan_abandoned'
  and created_at > now() - interval '30 days'
group by 1
order by 1;

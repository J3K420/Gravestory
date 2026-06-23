-- ════════════════════════════════════════════════════════════════════════
-- GraveStory — ONE-SHOT APP DASHBOARD
-- ════════════════════════════════════════════════════════════════════════
-- Paste this WHOLE file into the Supabase SQL editor and hit Run. It returns
-- one result set per section (Supabase shows them stacked, newest query at the
-- bottom — scroll through them). 100% READ-ONLY: every statement is a SELECT,
-- nothing is written or changed. Safe to run anytime, as often as you like.
--
-- Covers every app table: users, stories, graves, scans, credits, purchases,
-- tributes, photos, content reports, and the analytics funnel incl. the S67
-- loading-time / abandonment telemetry.
--
-- Each section starts with a `section` label column so you can tell the result
-- sets apart. Counts default to "all time"; rate/funnel sections note their
-- window inline. The 2 is_unlimited dev accounts (j3k420@, james.edmonds26@)
-- never write scan_events, so they fall out of scan/conversion denominators
-- naturally — but they DO appear in the user/story counts below.
--
-- If a section errors with "relation ... does not exist", that table/migration
-- isn't in this project — comment that block out. All tables here are from
-- migrations 001–017 + the base `stories` table.
-- ════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────
-- 0. HEADLINE — the whole app on one row
-- ────────────────────────────────────────────────────────────────────────
select
  'HEADLINE' as section,
  (select count(*) from auth.users)                                   as total_users,
  (select count(*) from auth.users
     where created_at > now() - interval '7 days')                    as new_users_7d,
  (select count(*) from public.stories where deleted_at is null)      as stories_live,
  (select count(*) from public.stories where is_public = true
     and deleted_at is null)                                          as stories_public,
  (select count(*) from public.graves)                               as graves,
  (select count(*) from public.scan_events)                          as scans_all_time,
  (select count(distinct user_id) from public.scan_credits
     where purchased > 0)                                            as paying_users,
  (select coalesce(sum(purchased), 0) from public.scan_credits)      as credits_outstanding,
  (select count(*) from public.content_reports)                      as content_reports;


-- ────────────────────────────────────────────────────────────────────────
-- 1. USERS — growth + sign-in method + activity
-- ────────────────────────────────────────────────────────────────────────

-- New users per day, last 30 days
select 'users · signups/day' as section,
       date_trunc('day', created_at)::date as day,
       count(*) as new_users
from auth.users
where created_at > now() - interval '30 days'
group by 1, 2
order by day desc;

-- Sign-in provider split (google vs email) + how many are tester-unlimited
select 'users · provider' as section,
       coalesce(raw_app_meta_data->>'provider', 'email') as provider,
       count(*) as users,
       count(*) filter (where (raw_app_meta_data->>'is_unlimited')::boolean) as unlimited_testers
from auth.users
group by 1
order by users desc;

-- Engagement: users who have ever scanned / saved / bought
select 'users · engagement' as section,
       (select count(distinct user_id) from public.scan_events)                     as ever_scanned,
       (select count(distinct user_id) from public.stories where deleted_at is null) as ever_saved_story,
       (select count(distinct user_id) from public.scan_credits where purchased > 0) as ever_bought,
       (select count(distinct user_id) from public.tributes)                         as ever_left_tribute;


-- ────────────────────────────────────────────────────────────────────────
-- 2. STORIES — volume, public share rate, source, recent
-- ────────────────────────────────────────────────────────────────────────

-- Story totals + how many are public / from camera / soft-deleted
select 'stories · totals' as section,
       count(*)                                          as rows_total,
       count(*) filter (where deleted_at is null)        as live,
       count(*) filter (where deleted_at is not null)    as soft_deleted,
       count(*) filter (where is_public and deleted_at is null) as public_live,
       count(*) filter (where source = 'camera')         as from_camera,
       count(*) filter (where source = 'library')        as from_library,
       count(*) filter (where grave_id is not null)      as linked_to_grave
from public.stories;

-- Stories created per day, last 30 days (created_at is the cloud insert time)
select 'stories · created/day' as section,
       date_trunc('day', created_at)::date as day,
       count(*) as stories
from public.stories
where created_at > now() - interval '30 days'
group by 1, 2
order by day desc;

-- 15 most recent stories (a quick eyeball of what people are scanning)
select 'stories · recent' as section,
       created_at, name, dates, location, is_public, source
from public.stories
where deleted_at is null
order by created_at desc
limit 15;


-- ────────────────────────────────────────────────────────────────────────
-- 3. GRAVES + MAP — canonical stones, public pins, corrections
-- ────────────────────────────────────────────────────────────────────────
select 'graves · totals' as section,
       count(*)                                   as graves_total,
       count(*) filter (where is_public)          as public_on_global_map,
       count(*) filter (where user_corrected)     as location_corrected,
       count(*) filter (where marker_style is not null) as marker_staked,
       (select count(*) from public.grave_photos) as photos_in_gallery
from public.graves;

-- Marker style popularity (which pins people pick for the global map)
select 'graves · marker styles' as section,
       coalesce(marker_style, '(default/book)') as marker_style,
       count(*) as graves
from public.graves
group by 1
order by graves desc;


-- ────────────────────────────────────────────────────────────────────────
-- 4. SCANS + FREEMIUM — usage, the 3-scan cap, conversion
-- ────────────────────────────────────────────────────────────────────────

-- Scan volume over time
select 'scans · volume' as section,
       count(*)                                                as scans_all_time,
       count(*) filter (where scanned_at > now() - interval '7 days')  as scans_7d,
       count(*) filter (where scanned_at > now() - interval '30 days') as scans_30d,
       count(distinct user_id)                                 as distinct_scanners
from public.scan_events;

-- Scans-per-user distribution — does the 3-scan free cap actually bite?
with per_user as (
  select user_id, count(*) as scans from public.scan_events group by user_id
)
select 'scans · per-user buckets' as section,
       case
         when scans = 1             then '1 scan'
         when scans = 2             then '2 scans'
         when scans = 3             then '3 scans (at free cap)'
         when scans between 4 and 9 then '4-9 scans'
         else                            '10+ scans (heavy/bought)'
       end as bucket,
       count(*) as users,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from per_user
group by 1
order by min(scans);

-- HEADLINE CONVERSION — % of users who ever scanned that bought a pack
with scanners as (select distinct user_id from public.scan_events),
     buyers   as (select distinct user_id from public.scan_credits where purchased > 0)
select 'freemium · conversion' as section,
       (select count(*) from scanners)                                     as users_who_scanned,
       (select count(*) from buyers where user_id in (select user_id from scanners)) as scanners_who_bought,
       round(100.0 * (select count(*) from buyers where user_id in (select user_id from scanners))
             / nullif((select count(*) from scanners), 0), 1)              as conversion_pct;


-- ────────────────────────────────────────────────────────────────────────
-- 5. PURCHASES / CREDITS — money in, what they bought
-- ────────────────────────────────────────────────────────────────────────

-- Current credit balances (most recently topped-up first)
select 'credits · balances' as section,
       count(*)                       as users_with_credit_rows,
       count(*) filter (where purchased > 0) as users_with_credits,
       coalesce(sum(purchased), 0)    as total_credits_outstanding
from public.scan_credits;

-- Purchase events from the RevenueCat webhook ledger (the real "sales" log).
-- amount = credits granted; product_id = which pack. Idempotency table from
-- migration 017 — if this errors, that migration isn't applied.
select 'purchases · by pack' as section,
       product_id,
       count(*)            as purchases,
       sum(amount)         as credits_granted
from public.revenuecat_events
group by 1
order by purchases desc;

-- Recent purchases
select 'purchases · recent' as section,
       processed_at, product_id, amount, user_id
from public.revenuecat_events
order by processed_at desc
limit 15;


-- ────────────────────────────────────────────────────────────────────────
-- 6. TRIBUTES + COMMUNITY
-- ────────────────────────────────────────────────────────────────────────
select 'tributes' as section,
       count(*)                              as total,
       count(*) filter (where type='candle') as candles,
       count(*) filter (where type='flower') as flowers,
       count(distinct user_id)               as users_who_left_one,
       count(distinct grave_id)              as graves_with_tributes
from public.tributes;


-- ────────────────────────────────────────────────────────────────────────
-- 7. CONTENT REPORTS — moderation queue (privacy/accuracy flags)
-- ────────────────────────────────────────────────────────────────────────
select 'reports · by reason' as section,
       reason,
       count(*)                          as n,
       count(*) filter (where is_public) as on_public_story
from public.content_reports
group by 1
order by n desc;

-- The actual reports to triage (newest first)
select 'reports · queue' as section,
       created_at, reason, person_name, is_public, platform, note
from public.content_reports
order by created_at desc
limit 20;


-- ════════════════════════════════════════════════════════════════════════
-- 8. ANALYTICS FUNNEL  (requires migration 008; guest events need 009)
-- ════════════════════════════════════════════════════════════════════════

-- Are events even landing? Volume by type, last 7 days
select 'funnel · event volume 7d' as section,
       event, count(*) as n
from public.analytics_events
where created_at > now() - interval '7 days'
group by event
order by n desc;

-- The scan funnel — absolute counts down the pipeline, last 30 days
select 'funnel · scan funnel 30d' as section,
       count(*) filter (where event='scan_started')          as started,
       count(*) filter (where event='verification_rejected') as verify_rejected,
       count(*) filter (where event='ocr_done')              as ocr_done,
       count(*) filter (where event='bio_cache_hit')         as cache_hits,
       count(*) filter (where event='bio_shown')             as bio_shown,
       count(*) filter (where event='scan_abandoned')        as abandoned,
       count(*) filter (where event='pipeline_error')        as errors,
       count(*) filter (where event='story_saved')           as saved,
       count(*) filter (where event='made_public')           as made_public,
       count(*) filter (where event='paywall_shown')         as paywall_shown,
       count(*) filter (where event='purchase_completed')    as purchases
from public.analytics_events
where created_at > now() - interval '30 days';

-- Guest vs signed-in event split (guest rows = NULL user_id, allowed by the
-- analytics_events INSERT policy in migration 008)
select 'funnel · auth split' as section,
       case when user_id is not null then 'signed_in' else 'guest' end as auth_path,
       count(*) as events
from public.analytics_events
group by user_id is not null
order by user_id is not null;

-- OCR confidence distribution
select 'funnel · ocr confidence' as section,
       props->>'confidence' as confidence, count(*) as n
from public.analytics_events
where event='ocr_done'
group by 1 order by n desc;

-- Pipeline errors by stage/reason (research timeouts surface here)
select 'funnel · errors' as section,
       props->>'stage' as stage, props->>'reason' as reason, count(*) as n
from public.analytics_events
where event='pipeline_error'
group by 1, 2 order by n desc;


-- ════════════════════════════════════════════════════════════════════════
-- 9. LOADING TIME + ABANDONMENT  (S67 — needs the d3a5390c OTA or later;
--    rows from older builds lack dur_ms and are skipped)
-- ════════════════════════════════════════════════════════════════════════

-- Pipeline duration — how long a successful scan takes (cached vs full), seconds
select 'loading · duration' as section,
       case when (props->>'cached')::boolean then 'cache hit' else 'full pipeline' end as kind,
       count(*)                                                                        as n,
       round(avg((props->>'dur_ms')::numeric)/1000, 1)                                 as avg_s,
       round((percentile_cont(0.5) within group (order by (props->>'dur_ms')::numeric))/1000, 1) as median_s,
       round((percentile_cont(0.9) within group (order by (props->>'dur_ms')::numeric))/1000, 1) as p90_s,
       round(max((props->>'dur_ms')::numeric)/1000, 1)                                 as max_s
from public.analytics_events
where event='bio_shown' and props ? 'dur_ms'
  and created_at > now() - interval '30 days'
group by 1;

-- Abandonment rate — of scans started, how many were left mid-load (last 30d)
select 'loading · abandon rate' as section,
       count(*) filter (where event='scan_started')   as started,
       count(*) filter (where event='scan_abandoned') as abandoned,
       round(100.0 * count(*) filter (where event='scan_abandoned')
             / nullif(count(*) filter (where event='scan_started'), 0), 1) as abandon_pct
from public.analytics_events
where created_at > now() - interval '30 days';

-- Where do people give up? scan_abandoned bucketed by pipeline stage + wait
select 'loading · abandon by stage' as section,
       case (props->>'stepIndex')::int
         when 0 then '0 verify' when 1 then '1 OCR' when 2 then '2 research'
         when 3 then '3 biography' when 4 then '4 finishing' else '?' end as stage,
       count(*)                                        as abandoned,
       round(avg((props->>'dur_ms')::numeric)/1000, 1) as avg_wait_s
from public.analytics_events
where event='scan_abandoned' and created_at > now() - interval '30 days'
group by 1
order by 1;

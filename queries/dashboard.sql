-- ════════════════════════════════════════════════════════════════════════
-- GraveStory — ONE-SHOT APP DASHBOARD  (single result table)
-- ════════════════════════════════════════════════════════════════════════
-- Paste this WHOLE file into the Supabase SQL editor and hit Run. It returns
-- ONE table: (grp, metric, total, excl_mine, detail).
--   total     = the raw number (everyone, including your own accounts)
--   excl_mine = the same number with the 3 OWNER accounts removed (the real-user
--               figure). Shows '—' on rows where "mine" is meaningless
--               (distributions: marker styles, packs, OCR confidence, errors).
-- 100% READ-ONLY — every branch is a SELECT, nothing is written or changed.
--
-- Why one big query: the Supabase SQL editor only displays the LAST statement's
-- result, so a file of many separate SELECTs shows only one table. This unions
-- everything into a single result, ordered by a hidden `ord`.
--
-- Owner accounts are resolved once in the `me` CTE (dot-insensitive email match).
-- Update that list if owner accounts change. All values are text so UNION types
-- line up. Covers migrations 001–017 + the base `stories` table. If a branch
-- errors "relation does not exist", delete that branch + its `union all`.
-- ════════════════════════════════════════════════════════════════════════

with me as (
  select id as user_id
  from auth.users
  where lower(replace(email, '.', '')) in (
    'j3k420@gmailcom', 'jamesedmonds26@gmailcom', 'edmondsj46@gmailcom'
  )
),
d as (

  -- ░░ 0. HEADLINE ░░
  select 10 as ord, 'HEADLINE' as grp, 'total users' as metric,
         (select count(*)::text from auth.users) as total,
         (select count(*)::text from auth.users where id not in (select user_id from me)) as excl_mine,
         '' as detail
  union all select 12, 'HEADLINE', 'stories live',
         (select count(*)::text from public.stories where deleted_at is null),
         (select count(*)::text from public.stories where deleted_at is null and user_id not in (select user_id from me)), ''
  union all select 13, 'HEADLINE', 'stories public',
         (select count(*)::text from public.stories where is_public and deleted_at is null),
         (select count(*)::text from public.stories where is_public and deleted_at is null and user_id not in (select user_id from me)), ''
  union all select 15, 'HEADLINE', 'scans all-time',
         (select count(*)::text from public.scan_events),
         (select count(*)::text from public.scan_events where user_id not in (select user_id from me)), ''
  union all select 16, 'HEADLINE', 'paying users',
         (select count(distinct user_id)::text from public.scan_credits where purchased > 0),
         (select count(distinct user_id)::text from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)), ''
  union all select 17, 'HEADLINE', 'credits sold (lifetime)',
         (select coalesce(sum(purchased),0)::text from public.scan_credits),
         (select coalesce(sum(purchased),0)::text from public.scan_credits where user_id not in (select user_id from me)),
         'total ever purchased, not unused balance'
  union all select 18, 'HEADLINE', 'content reports',
         (select count(*)::text from public.content_reports),
         (select count(*)::text from public.content_reports where reporter_id is null or reporter_id not in (select user_id from me)), ''
  union all select 19, 'HEADLINE', 'graves',
         (select count(*)::text from public.graves), '—', 'no per-user owner column'

  -- ░░ 1. USERS ░░
  union all select 20, 'USERS', 'signups (7d)',
         (select count(*)::text from auth.users where created_at > now() - interval '7 days'),
         (select count(*)::text from auth.users where created_at > now() - interval '7 days' and id not in (select user_id from me)), ''
  union all select 21, 'USERS', 'signups (30d)',
         (select count(*)::text from auth.users where created_at > now() - interval '30 days'),
         (select count(*)::text from auth.users where created_at > now() - interval '30 days' and id not in (select user_id from me)), ''
  union all select 22, 'USERS', 'ever scanned',
         (select count(distinct user_id)::text from public.scan_events),
         (select count(distinct user_id)::text from public.scan_events where user_id not in (select user_id from me)), ''
  union all select 23, 'USERS', 'ever saved a story',
         (select count(distinct user_id)::text from public.stories where deleted_at is null),
         (select count(distinct user_id)::text from public.stories where deleted_at is null and user_id not in (select user_id from me)), ''
  union all select 24, 'USERS', 'ever bought',
         (select count(distinct user_id)::text from public.scan_credits where purchased > 0),
         (select count(distinct user_id)::text from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)), ''
  union all select 25, 'USERS', 'ever left a tribute',
         (select count(distinct user_id)::text from public.tributes),
         (select count(distinct user_id)::text from public.tributes where user_id not in (select user_id from me)), ''
  -- provider split (one row per provider) — distribution, no excl_mine
  union all
  select 26, 'USERS', 'provider: ' || coalesce(raw_app_meta_data->>'provider','email'),
         count(*)::text, '—',
         (count(*) filter (where (raw_app_meta_data->>'is_unlimited')::boolean))::text || ' unlimited testers'
  from auth.users group by coalesce(raw_app_meta_data->>'provider','email')

  -- ░░ 2. STORIES ░░
  union all select 30, 'STORIES', 'rows total',
         (select count(*)::text from public.stories),
         (select count(*)::text from public.stories where user_id not in (select user_id from me)), ''
  union all select 31, 'STORIES', 'live',
         (select count(*)::text from public.stories where deleted_at is null),
         (select count(*)::text from public.stories where deleted_at is null and user_id not in (select user_id from me)), ''
  union all select 32, 'STORIES', 'soft-deleted',
         (select count(*)::text from public.stories where deleted_at is not null),
         (select count(*)::text from public.stories where deleted_at is not null and user_id not in (select user_id from me)), ''
  union all select 33, 'STORIES', 'public (live)',
         (select count(*)::text from public.stories where is_public and deleted_at is null),
         (select count(*)::text from public.stories where is_public and deleted_at is null and user_id not in (select user_id from me)), ''
  union all select 34, 'STORIES', 'from camera',
         (select count(*)::text from public.stories where source = 'camera'),
         (select count(*)::text from public.stories where source = 'camera' and user_id not in (select user_id from me)), ''
  union all select 35, 'STORIES', 'from library',
         (select count(*)::text from public.stories where source = 'library'),
         (select count(*)::text from public.stories where source = 'library' and user_id not in (select user_id from me)), ''
  union all select 36, 'STORIES', 'linked to grave',
         (select count(*)::text from public.stories where grave_id is not null),
         (select count(*)::text from public.stories where grave_id is not null and user_id not in (select user_id from me)), ''
  union all select 37, 'STORIES', 'created (7d)',
         (select count(*)::text from public.stories where created_at > now() - interval '7 days'),
         (select count(*)::text from public.stories where created_at > now() - interval '7 days' and user_id not in (select user_id from me)), ''
  union all select 38, 'STORIES', 'created (30d)',
         (select count(*)::text from public.stories where created_at > now() - interval '30 days'),
         (select count(*)::text from public.stories where created_at > now() - interval '30 days' and user_id not in (select user_id from me)), ''

  -- ░░ 3. GRAVES + MAP ░░  (graves/grave_photos have no per-user owner column → no excl_mine)
  union all select 40, 'GRAVES', 'total',                (select count(*)::text from public.graves), '—', ''
  union all select 41, 'GRAVES', 'public on global map', (select count(*)::text from public.graves where is_public), '—', ''
  union all select 42, 'GRAVES', 'location corrected',   (select count(*)::text from public.graves where user_corrected), '—', ''
  union all select 43, 'GRAVES', 'marker staked',        (select count(*)::text from public.graves where marker_style is not null), '—', ''
  union all select 44, 'GRAVES', 'photos in gallery',
         (select count(*)::text from public.grave_photos),
         (select count(*)::text from public.grave_photos where user_id not in (select user_id from me)), ''
  -- marker style popularity (one row per style) — distribution
  union all
  select 45, 'GRAVES', 'marker: ' || coalesce(marker_style,'(default/book)'), count(*)::text, '—', ''
  from public.graves group by coalesce(marker_style,'(default/book)')

  -- ░░ 4. SCANS + FREEMIUM ░░
  union all select 50, 'SCANS', 'all-time',
         (select count(*)::text from public.scan_events),
         (select count(*)::text from public.scan_events where user_id not in (select user_id from me)), ''
  union all select 51, 'SCANS', 'last 7d',
         (select count(*)::text from public.scan_events where scanned_at > now() - interval '7 days'),
         (select count(*)::text from public.scan_events where scanned_at > now() - interval '7 days' and user_id not in (select user_id from me)), ''
  union all select 52, 'SCANS', 'last 30d',
         (select count(*)::text from public.scan_events where scanned_at > now() - interval '30 days'),
         (select count(*)::text from public.scan_events where scanned_at > now() - interval '30 days' and user_id not in (select user_id from me)), ''
  union all select 53, 'SCANS', 'distinct scanners',
         (select count(distinct user_id)::text from public.scan_events),
         (select count(distinct user_id)::text from public.scan_events where user_id not in (select user_id from me)), ''
  -- scans-per-user buckets — distribution
  union all
  select 54, 'SCANS',
         'bucket: ' || case
           when scans = 1 then '1 scan'
           when scans = 2 then '2 scans'
           when scans = 3 then '3 scans (free cap)'
           when scans between 4 and 9 then '4-9 scans'
           else '10+ scans' end,
         count(*)::text, '—',
         round(100.0 * count(*) / sum(count(*)) over (), 1)::text || '% of scanners'
  from (select user_id, count(*) as scans from public.scan_events group by user_id) pu
  group by 1, case
           when scans = 1 then '1 scan'
           when scans = 2 then '2 scans'
           when scans = 3 then '3 scans (free cap)'
           when scans between 4 and 9 then '4-9 scans'
           else '10+ scans' end
  -- headline conversion (scanners who bought / scanners) — total vs excl-mine
  union all
  select 55, 'FREEMIUM', 'conversion %',
         coalesce(round(100.0 * (select count(*) from (select distinct user_id from public.scan_credits where purchased > 0) b
                                  where b.user_id in (select distinct user_id from public.scan_events))
                  / nullif((select count(distinct user_id) from public.scan_events), 0), 1)::text, '0') || '%',
         coalesce(round(100.0 * (select count(*) from (select distinct user_id from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)) b
                                  where b.user_id in (select distinct user_id from public.scan_events where user_id not in (select user_id from me)))
                  / nullif((select count(distinct user_id) from public.scan_events where user_id not in (select user_id from me)), 0), 1)::text, '0') || '%',
         (select count(distinct user_id) from public.scan_events)::text || ' scanners'

  -- ░░ 5. PURCHASES / CREDITS ░░
  union all select 60, 'CREDITS', 'users with credits',
         (select count(*)::text from public.scan_credits where purchased > 0),
         (select count(*)::text from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)), ''
  union all select 61, 'CREDITS', 'credits sold (lifetime)',
         (select coalesce(sum(purchased),0)::text from public.scan_credits),
         (select coalesce(sum(purchased),0)::text from public.scan_credits where user_id not in (select user_id from me)),
         'sum of purchased; never expires + not decremented on use'
  -- TRUE outstanding balance: per buyer, purchased minus paid scans consumed.
  -- Free scans burn first: paid_used = greatest(scans - FREE, 0); unused =
  -- greatest(purchased - paid_used, 0). ⚠ The `3` is SCAN_LIMIT_FREE_USER (S66) —
  -- update it if the free allowance changes. total = all buyers; excl_mine = buyers
  -- minus owner accounts (via the `me` anti-join).
  union all
  select 62, 'CREDITS', 'credits unused (outstanding)',
         (select coalesce(sum(greatest(sc.purchased - greatest(coalesce(se.scans,0) - 3 /*free*/, 0), 0)),0)::text
            from public.scan_credits sc
            left join (select user_id, count(*) as scans from public.scan_events group by user_id) se on se.user_id = sc.user_id
            where sc.purchased > 0),
         (select coalesce(sum(greatest(sc.purchased - greatest(coalesce(se.scans,0) - 3 /*free*/, 0), 0)),0)::text
            from public.scan_credits sc
            left join (select user_id, count(*) as scans from public.scan_events group by user_id) se on se.user_id = sc.user_id
            where sc.purchased > 0 and sc.user_id not in (select user_id from me)),
         'real balance still redeemable'
  -- purchases by pack (one row per pack) — distribution
  union all
  select 63, 'PURCHASES', 'pack: ' || coalesce(product_id,'(unknown)'),
         count(*)::text || ' buys', '—', coalesce(sum(amount),0)::text || ' credits'
  from public.revenuecat_events group by coalesce(product_id,'(unknown)')

  -- ░░ 6. TRIBUTES ░░
  union all select 70, 'TRIBUTES', 'total',
         (select count(*)::text from public.tributes),
         (select count(*)::text from public.tributes where user_id not in (select user_id from me)), ''
  union all select 71, 'TRIBUTES', 'candles',
         (select count(*)::text from public.tributes where type='candle'),
         (select count(*)::text from public.tributes where type='candle' and user_id not in (select user_id from me)), ''
  union all select 72, 'TRIBUTES', 'flowers',
         (select count(*)::text from public.tributes where type='flower'),
         (select count(*)::text from public.tributes where type='flower' and user_id not in (select user_id from me)), ''
  union all select 73, 'TRIBUTES', 'graves with tributes',
         (select count(distinct grave_id)::text from public.tributes),
         (select count(distinct grave_id)::text from public.tributes where user_id not in (select user_id from me)), ''

  -- ░░ 7. CONTENT REPORTS (moderation) ░░
  union all select 80, 'REPORTS', 'total',
         (select count(*)::text from public.content_reports),
         (select count(*)::text from public.content_reports where reporter_id is null or reporter_id not in (select user_id from me)), ''
  union all select 81, 'REPORTS', 'on public stories',
         (select count(*)::text from public.content_reports where is_public),
         (select count(*)::text from public.content_reports where is_public and (reporter_id is null or reporter_id not in (select user_id from me))), ''
  -- by reason (one row per reason) — distribution
  union all
  select 82, 'REPORTS', 'reason: ' || reason, count(*)::text, '—', ''
  from public.content_reports group by reason

  -- ░░ 8. ANALYTICS FUNNEL (migration 008) — events carry user_id, so excl_mine works ░░
  union all select 90, 'FUNNEL', 'scan_started (30d)',
         (select count(*)::text from public.analytics_events where event='scan_started' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='scan_started' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 94, 'FUNNEL', 'bio_shown (30d)',
         (select count(*)::text from public.analytics_events where event='bio_shown' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='bio_shown' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 95, 'FUNNEL', 'pipeline_error (30d)',
         (select count(*)::text from public.analytics_events where event='pipeline_error' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='pipeline_error' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 96, 'FUNNEL', 'story_saved (30d)',
         (select count(*)::text from public.analytics_events where event='story_saved' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='story_saved' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 98, 'FUNNEL', 'paywall_shown (30d)',
         (select count(*)::text from public.analytics_events where event='paywall_shown' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='paywall_shown' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 99, 'FUNNEL', 'purchase_completed (30d)',
         (select count(*)::text from public.analytics_events where event='purchase_completed' and created_at > now() - interval '30 days'),
         (select count(*)::text from public.analytics_events where event='purchase_completed' and created_at > now() - interval '30 days' and (user_id is null or user_id not in (select user_id from me))), ''
  union all select 100,'FUNNEL', 'events: guest',     (select count(*)::text from public.analytics_events where user_id is null), '—', ''
  union all select 101,'FUNNEL', 'events: signed-in',
         (select count(*)::text from public.analytics_events where user_id is not null),
         (select count(*)::text from public.analytics_events where user_id is not null and user_id not in (select user_id from me)), ''
  -- OCR confidence (one row per level) — distribution
  union all
  select 102, 'FUNNEL', 'ocr confidence: ' || coalesce(props->>'confidence','(none)'), count(*)::text, '—', ''
  from public.analytics_events where event='ocr_done' group by coalesce(props->>'confidence','(none)')
  -- pipeline errors by stage (one row per stage/reason) — distribution
  union all
  select 103, 'FUNNEL', 'error: ' || coalesce(props->>'stage','?') || '/' || coalesce(props->>'reason','?'), count(*)::text, '—', ''
  from public.analytics_events where event='pipeline_error' group by coalesce(props->>'stage','?'), coalesce(props->>'reason','?')

  -- ░░ 9. LOADING TIME + ABANDONMENT (S67 — needs the d3a5390c OTA or later) ░░
  -- duration of successful scans (cached vs full), seconds — one row per kind, distribution
  union all
  select 110, 'LOADING',
         'duration (' || (case when (props->>'cached')::boolean then 'cache hit' else 'full pipeline' end) || ')',
         coalesce(round(avg((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's avg', '—',
         'p90 ' || coalesce(round((percentile_cont(0.9) within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1)::text, '—')
           || 's · max ' || coalesce(round(max((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's · n=' || count(*)::text
  from public.analytics_events
  where event='bio_shown' and props ? 'dur_ms' and created_at > now() - interval '30 days'
  group by (props->>'cached')::boolean
  -- abandonment rate (single row) — total vs excl-mine
  union all
  select 111, 'LOADING', 'abandon rate (30d)',
         coalesce(round(100.0 * count(*) filter (where event='scan_abandoned')
               / nullif(count(*) filter (where event='scan_started'), 0), 1)::text, '0') || '%',
         coalesce(round(100.0 * count(*) filter (where event='scan_abandoned' and (user_id is null or user_id not in (select user_id from me)))
               / nullif(count(*) filter (where event='scan_started' and (user_id is null or user_id not in (select user_id from me))), 0), 1)::text, '0') || '%',
         count(*) filter (where event='scan_abandoned')::text || ' of ' || count(*) filter (where event='scan_started')::text || ' scans'
  from public.analytics_events where created_at > now() - interval '30 days'
  -- abandonment by stage (one row per stage) — distribution
  union all
  select 112, 'LOADING',
         'abandon at: ' || (case (props->>'stepIndex')::int
           when 0 then 'verify' when 1 then 'OCR' when 2 then 'research'
           when 3 then 'biography' when 4 then 'finishing' else '?' end),
         count(*)::text, '—',
         'avg wait ' || coalesce(round(avg((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's'
  from public.analytics_events
  where event='scan_abandoned' and created_at > now() - interval '30 days'
  group by (props->>'stepIndex')::int

)
select grp, metric, total, excl_mine, detail
from d
order by ord, metric;


-- ════════════════════════════════════════════════════════════════════════
-- CONTENT REPORTS — full contents for triage  (SECOND statement)
-- ════════════════════════════════════════════════════════════════════════
-- The Supabase SQL editor shows only the LAST statement's result, so running
-- the whole file displays THIS reports table. To see the main dashboard above
-- instead, highlight just the `with me as ( … order by ord, metric;` block and
-- Run Selection. Reports are readable ONLY here (service role) — the table has
-- no SELECT policy for normal users by design.
--
-- Triage priority: a `privacy` or `offensive` reason on a PUBLIC story is the
-- urgent case (a wrong/hurtful bio about a living person, visible on the global
-- map). `on_public` = true + that reason → review and make private / correct /
-- remove. factual_error / wrong_person on a private story = quality, lower urgency.
-- `mine` flags reports filed by your own 3 owner accounts (test taps).
select
  cr.created_at,
  cr.reason,
  cr.person_name,
  cr.is_public                                              as on_public,
  cr.platform,
  cr.note,
  case when cr.reporter_id is null then 'guest' else 'signed-in' end as reporter,
  case when cr.reporter_id in (
         select id from auth.users
         where lower(replace(email,'.','')) in (
           'j3k420@gmailcom','jamesedmonds26@gmailcom','edmondsj46@gmailcom')
       ) then 'yes' else 'no' end                           as mine,
  cr.story_ts,
  cr.grave_id
from public.content_reports cr
order by cr.created_at desc;

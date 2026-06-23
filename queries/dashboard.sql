-- ════════════════════════════════════════════════════════════════════════
-- GraveStory — ONE-SHOT APP DASHBOARD  (single result table)
-- ════════════════════════════════════════════════════════════════════════
-- Paste this WHOLE file into the Supabase SQL editor and hit Run. It returns
-- ONE table with every app metric as a row: (grp, metric, value, detail).
-- 100% READ-ONLY — every branch is a SELECT, nothing is written or changed.
--
-- Why one big query: the Supabase SQL editor only displays the LAST statement's
-- result, so a file of many separate SELECTs shows only one table. This unions
-- everything into a single result you can read top-to-bottom (ordered by `ord`,
-- which is hidden-ish at the end — sort by it if the editor reorders).
--
-- Every value is cast to text so the UNION's column types line up. Distributions
-- (scan buckets, marker styles, errors, etc.) appear as one row PER bucket.
-- Windows: counts are all-time unless the metric name says 7d/30d.
--
-- If a branch errors with "relation ... does not exist", that table/migration
-- isn't in this project — delete that branch's SELECT + its UNION ALL.
-- Covers migrations 001–017 + the base `stories` table.
-- ════════════════════════════════════════════════════════════════════════

-- Owner accounts resolved ONCE here (dot-insensitive: Gmail ignores dots but
-- auth.users stores the literal signup string, so james.edmonds26 / jamesedmonds26
-- both normalize and match). Update this list if owner accounts change.
with me as (
  select id as user_id
  from auth.users
  where lower(replace(email, '.', '')) in (
    'j3k420@gmailcom', 'jamesedmonds26@gmailcom', 'edmondsj46@gmailcom'
  )
),
d as (

  -- ░░ MY ACCOUNTS — your own footprint, to subtract from the totals below ░░
  -- Your 3 accounts (incl. is_unlimited dev accounts) DO write scan_events,
  -- stories, tributes, reports — so they inflate the headline counts. These rows
  -- show your share of each so you can discount yourself.
  select 1 as ord, 'MY ACCOUNTS' as grp, 'accounts found' as metric,
         (select count(*)::text from me) as value,
         'of 3 expected — fewer means an email didn''t match' as detail
  union all select 2, 'MY ACCOUNTS', 'my scans',          (select count(*)::text from public.scan_events where user_id in (select user_id from me)), 'subtract from SCANS all-time'
  union all select 3, 'MY ACCOUNTS', 'my stories live',   (select count(*)::text from public.stories where deleted_at is null and user_id in (select user_id from me)), 'subtract from STORIES live'
  union all select 4, 'MY ACCOUNTS', 'my stories public', (select count(*)::text from public.stories where is_public and deleted_at is null and user_id in (select user_id from me)), 'subtract from STORIES public'
  union all select 5, 'MY ACCOUNTS', 'my tributes',       (select count(*)::text from public.tributes where user_id in (select user_id from me)), 'subtract from TRIBUTES total'
  union all select 6, 'MY ACCOUNTS', 'my content reports',(select count(*)::text from public.content_reports where reporter_id in (select user_id from me)), 'subtract from REPORTS total'
  union all select 7, 'MY ACCOUNTS', 'my credits sold',   (select coalesce(sum(purchased),0)::text from public.scan_credits where user_id in (select user_id from me)), 'subtract from CREDITS sold'

  -- ░░ 0. HEADLINE ░░
  union all select 10 as ord, 'HEADLINE' as grp, 'total users'           as metric, (select count(*)::text from auth.users) as value, '' as detail
  union all select 11, 'HEADLINE', 'new users (7d)',     (select count(*)::text from auth.users where created_at > now() - interval '7 days'), ''
  union all select 12, 'HEADLINE', 'stories live',       (select count(*)::text from public.stories where deleted_at is null), ''
  union all select 13, 'HEADLINE', 'stories public',     (select count(*)::text from public.stories where is_public and deleted_at is null), ''
  union all select 14, 'HEADLINE', 'graves',             (select count(*)::text from public.graves), ''
  union all select 15, 'HEADLINE', 'scans all-time',     (select count(*)::text from public.scan_events), ''
  union all select 16, 'HEADLINE', 'paying users',       (select count(distinct user_id)::text from public.scan_credits where purchased > 0), ''
  union all select 17, 'HEADLINE', 'credits sold (lifetime)',(select coalesce(sum(purchased),0)::text from public.scan_credits), 'total ever purchased, not unused balance'
  union all select 18, 'HEADLINE', 'content reports',    (select count(*)::text from public.content_reports), ''

  -- ░░ 1. USERS ░░
  union all select 20, 'USERS', 'signups (7d)',  (select count(*)::text from auth.users where created_at > now() - interval '7 days'), ''
  union all select 21, 'USERS', 'signups (30d)', (select count(*)::text from auth.users where created_at > now() - interval '30 days'), ''
  union all select 22, 'USERS', 'ever scanned',  (select count(distinct user_id)::text from public.scan_events), ''
  union all select 23, 'USERS', 'ever saved a story', (select count(distinct user_id)::text from public.stories where deleted_at is null), ''
  union all select 24, 'USERS', 'ever bought',   (select count(distinct user_id)::text from public.scan_credits where purchased > 0), ''
  union all select 25, 'USERS', 'ever left a tribute', (select count(distinct user_id)::text from public.tributes), ''
  -- provider split (one row per provider)
  union all
  select 26, 'USERS', 'provider: ' || coalesce(raw_app_meta_data->>'provider','email'),
         count(*)::text,
         (count(*) filter (where (raw_app_meta_data->>'is_unlimited')::boolean))::text || ' unlimited testers'
  from auth.users group by coalesce(raw_app_meta_data->>'provider','email')

  -- ░░ 2. STORIES ░░
  union all select 30, 'STORIES', 'rows total',     (select count(*)::text from public.stories), ''
  union all select 31, 'STORIES', 'live',           (select count(*)::text from public.stories where deleted_at is null), ''
  union all select 32, 'STORIES', 'soft-deleted',   (select count(*)::text from public.stories where deleted_at is not null), ''
  union all select 33, 'STORIES', 'public (live)',  (select count(*)::text from public.stories where is_public and deleted_at is null), ''
  union all select 34, 'STORIES', 'from camera',    (select count(*)::text from public.stories where source = 'camera'), ''
  union all select 35, 'STORIES', 'from library',   (select count(*)::text from public.stories where source = 'library'), ''
  union all select 36, 'STORIES', 'linked to grave',(select count(*)::text from public.stories where grave_id is not null), ''
  union all select 37, 'STORIES', 'created (7d)',   (select count(*)::text from public.stories where created_at > now() - interval '7 days'), ''
  union all select 38, 'STORIES', 'created (30d)',  (select count(*)::text from public.stories where created_at > now() - interval '30 days'), ''

  -- ░░ 3. GRAVES + MAP ░░
  union all select 40, 'GRAVES', 'total',                (select count(*)::text from public.graves), ''
  union all select 41, 'GRAVES', 'public on global map', (select count(*)::text from public.graves where is_public), ''
  union all select 42, 'GRAVES', 'location corrected',   (select count(*)::text from public.graves where user_corrected), ''
  union all select 43, 'GRAVES', 'marker staked',        (select count(*)::text from public.graves where marker_style is not null), ''
  union all select 44, 'GRAVES', 'photos in gallery',    (select count(*)::text from public.grave_photos), ''
  -- marker style popularity (one row per style)
  union all
  select 45, 'GRAVES', 'marker: ' || coalesce(marker_style,'(default/book)'), count(*)::text, ''
  from public.graves group by coalesce(marker_style,'(default/book)')

  -- ░░ 4. SCANS + FREEMIUM ░░
  union all select 50, 'SCANS', 'all-time',           (select count(*)::text from public.scan_events), ''
  union all select 51, 'SCANS', 'last 7d',            (select count(*)::text from public.scan_events where scanned_at > now() - interval '7 days'), ''
  union all select 52, 'SCANS', 'last 30d',           (select count(*)::text from public.scan_events where scanned_at > now() - interval '30 days'), ''
  union all select 53, 'SCANS', 'distinct scanners',  (select count(distinct user_id)::text from public.scan_events), ''
  -- scans-per-user buckets (does the 3-cap bite?) — one row per bucket
  union all
  select 54, 'SCANS',
         'bucket: ' || case
           when scans = 1 then '1 scan'
           when scans = 2 then '2 scans'
           when scans = 3 then '3 scans (free cap)'
           when scans between 4 and 9 then '4-9 scans'
           else '10+ scans' end,
         count(*)::text,
         round(100.0 * count(*) / sum(count(*)) over (), 1)::text || '% of scanners'
  from (select user_id, count(*) as scans from public.scan_events group by user_id) pu
  group by 1, case
           when scans = 1 then '1 scan'
           when scans = 2 then '2 scans'
           when scans = 3 then '3 scans (free cap)'
           when scans between 4 and 9 then '4-9 scans'
           else '10+ scans' end
  -- headline conversion
  union all
  select 55, 'FREEMIUM', 'conversion %',
         coalesce(round(100.0 * (select count(*) from (select distinct user_id from public.scan_credits where purchased > 0) b
                                  where b.user_id in (select distinct user_id from public.scan_events))
                  / nullif((select count(distinct user_id) from public.scan_events), 0), 1)::text, '0') || '%',
         (select count(distinct user_id) from public.scan_events)::text || ' scanners'

  -- ░░ 5. PURCHASES / CREDITS ░░
  union all select 60, 'CREDITS', 'users with credits', (select count(*)::text from public.scan_credits where purchased > 0), ''
  union all select 61, 'CREDITS', 'credits sold (lifetime)', (select coalesce(sum(purchased),0)::text from public.scan_credits), 'sum of purchased; credits never expire + are not decremented on use'
  -- TRUE outstanding balance: per buyer, purchased minus the paid scans they've
  -- consumed. The free scans are spent first, so paid credits only burn after the
  -- free allowance: paid_used = greatest(scans - FREE, 0); unused = greatest(
  -- purchased - paid_used, 0). Summed across all buyers = unused credits people
  -- can still cash in (the real liability, since credits never expire). LEFT JOIN
  -- so a buyer who has never scanned counts their full purchased amount as unused.
  -- ⚠ The `3` below is SCAN_LIMIT_FREE_USER (S66). If the free allowance changes,
  --   update this literal or the outstanding number drifts.
  union all
  select 62, 'CREDITS', 'credits unused (outstanding)',
         coalesce(sum(greatest(sc.purchased - greatest(coalesce(se.scans, 0) - 3 /* free allowance */, 0), 0)), 0)::text,
         'real balance still redeemable'
  from public.scan_credits sc
  left join (select user_id, count(*) as scans from public.scan_events group by user_id) se
    on se.user_id = sc.user_id
  where sc.purchased > 0
  -- OWNER ACCOUNTS subtotal for credits (uses the `me` CTE). Same unused formula
  -- as ord 62, so this is directly subtractable from the total.
  union all
  select 63, 'CREDITS', 'mine (my 3 accounts)',
         coalesce(sum(sc.purchased),0)::text || ' sold',
         coalesce(sum(greatest(sc.purchased - greatest(coalesce(se.scans, 0) - 3 /* free allowance */, 0), 0)), 0)::text || ' unused'
  from public.scan_credits sc
  join me on me.user_id = sc.user_id
  left join (select user_id, count(*) as scans from public.scan_events group by user_id) se
    on se.user_id = sc.user_id
  -- purchases by pack (one row per pack) — revenuecat_events ledger (migration 017)
  union all
  select 64, 'PURCHASES', 'pack: ' || coalesce(product_id,'(unknown)'),
         count(*)::text || ' buys', coalesce(sum(amount),0)::text || ' credits'
  from public.revenuecat_events group by coalesce(product_id,'(unknown)')

  -- ░░ 6. TRIBUTES ░░
  union all select 70, 'TRIBUTES', 'total',   (select count(*)::text from public.tributes), ''
  union all select 71, 'TRIBUTES', 'candles', (select count(*)::text from public.tributes where type='candle'), ''
  union all select 72, 'TRIBUTES', 'flowers', (select count(*)::text from public.tributes where type='flower'), ''
  union all select 73, 'TRIBUTES', 'graves with tributes', (select count(distinct grave_id)::text from public.tributes), ''

  -- ░░ 7. CONTENT REPORTS (moderation) ░░
  union all select 80, 'REPORTS', 'total', (select count(*)::text from public.content_reports), ''
  union all select 81, 'REPORTS', 'on public stories', (select count(*)::text from public.content_reports where is_public), ''
  -- by reason (one row per reason)
  union all
  select 82, 'REPORTS', 'reason: ' || reason, count(*)::text, ''
  from public.content_reports group by reason

  -- ░░ 8. ANALYTICS FUNNEL (migration 008) ░░
  union all select 90, 'FUNNEL', 'scan_started (30d)',          (select count(*)::text from public.analytics_events where event='scan_started' and created_at > now() - interval '30 days'), ''
  union all select 91, 'FUNNEL', 'verification_rejected (30d)', (select count(*)::text from public.analytics_events where event='verification_rejected' and created_at > now() - interval '30 days'), ''
  union all select 92, 'FUNNEL', 'ocr_done (30d)',              (select count(*)::text from public.analytics_events where event='ocr_done' and created_at > now() - interval '30 days'), ''
  union all select 93, 'FUNNEL', 'bio_cache_hit (30d)',         (select count(*)::text from public.analytics_events where event='bio_cache_hit' and created_at > now() - interval '30 days'), ''
  union all select 94, 'FUNNEL', 'bio_shown (30d)',             (select count(*)::text from public.analytics_events where event='bio_shown' and created_at > now() - interval '30 days'), ''
  union all select 95, 'FUNNEL', 'pipeline_error (30d)',        (select count(*)::text from public.analytics_events where event='pipeline_error' and created_at > now() - interval '30 days'), ''
  union all select 96, 'FUNNEL', 'story_saved (30d)',           (select count(*)::text from public.analytics_events where event='story_saved' and created_at > now() - interval '30 days'), ''
  union all select 97, 'FUNNEL', 'made_public (30d)',           (select count(*)::text from public.analytics_events where event='made_public' and created_at > now() - interval '30 days'), ''
  union all select 98, 'FUNNEL', 'paywall_shown (30d)',         (select count(*)::text from public.analytics_events where event='paywall_shown' and created_at > now() - interval '30 days'), ''
  union all select 99, 'FUNNEL', 'purchase_completed (30d)',    (select count(*)::text from public.analytics_events where event='purchase_completed' and created_at > now() - interval '30 days'), ''
  union all select 100,'FUNNEL', 'events: guest',               (select count(*)::text from public.analytics_events where user_id is null), ''
  union all select 101,'FUNNEL', 'events: signed-in',           (select count(*)::text from public.analytics_events where user_id is not null), ''
  -- OCR confidence (one row per level)
  union all
  select 102, 'FUNNEL', 'ocr confidence: ' || coalesce(props->>'confidence','(none)'), count(*)::text, ''
  from public.analytics_events where event='ocr_done' group by coalesce(props->>'confidence','(none)')
  -- pipeline errors by stage (one row per stage/reason)
  union all
  select 103, 'FUNNEL', 'error: ' || coalesce(props->>'stage','?') || '/' || coalesce(props->>'reason','?'), count(*)::text, ''
  from public.analytics_events where event='pipeline_error' group by coalesce(props->>'stage','?'), coalesce(props->>'reason','?')

  -- ░░ 9. LOADING TIME + ABANDONMENT (S67 — needs the d3a5390c OTA or later) ░░
  -- duration of successful scans (cached vs full), seconds — one row per kind
  union all
  select 110, 'LOADING',
         'duration (' || (case when (props->>'cached')::boolean then 'cache hit' else 'full pipeline' end) || ')',
         coalesce(round(avg((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's avg',
         'p90 ' || coalesce(round((percentile_cont(0.9) within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1)::text, '—')
           || 's · max ' || coalesce(round(max((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's · n=' || count(*)::text
  from public.analytics_events
  where event='bio_shown' and props ? 'dur_ms' and created_at > now() - interval '30 days'
  group by (props->>'cached')::boolean
  -- abandonment rate (single row)
  union all
  select 111, 'LOADING', 'abandon rate (30d)',
         coalesce(round(100.0 * count(*) filter (where event='scan_abandoned')
               / nullif(count(*) filter (where event='scan_started'), 0), 1)::text, '0') || '%',
         count(*) filter (where event='scan_abandoned')::text || ' of ' || count(*) filter (where event='scan_started')::text || ' scans'
  from public.analytics_events where created_at > now() - interval '30 days'
  -- abandonment by stage (one row per stage)
  union all
  select 112, 'LOADING',
         'abandon at: ' || (case (props->>'stepIndex')::int
           when 0 then 'verify' when 1 then 'OCR' when 2 then 'research'
           when 3 then 'biography' when 4 then 'finishing' else '?' end),
         count(*)::text,
         'avg wait ' || coalesce(round(avg((props->>'dur_ms')::numeric)/1000, 1)::text, '—') || 's'
  from public.analytics_events
  where event='scan_abandoned' and created_at > now() - interval '30 days'
  group by (props->>'stepIndex')::int

)
select grp, metric, value, detail
from d
order by ord, metric;

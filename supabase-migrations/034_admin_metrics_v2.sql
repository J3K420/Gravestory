-- ════════════════════════════════════════════════════════════════════════
-- Migration 034 — admin dashboard v2: superset metrics + daily time-series
-- ════════════════════════════════════════════════════════════════════════
-- Extends admin_metrics_summary() (migration 030) with the distributions the
-- dashboard wasn't surfacing — provider split, scans-per-user buckets, marker
-- popularity, tributes, conversion timing, free-scan cost, and loading-time
-- percentiles — all lifted from queries/dashboard.sql + queries/analytics.sql
-- (proven, in-use). ALL existing keys are preserved (dashboard v1 still reads
-- them); this only ADDS. Also adds admin_daily_series(p_days) for the trend
-- charts. CREATE OR REPLACE, so re-running is safe; same name = no Worker change.
--
-- Lockdown identical to 030: SECURITY DEFINER + pinned search_path, EXECUTE
-- revoked from anon/authenticated and granted only to service_role.
-- ⚠ Free-scan allowance constant `3` (SCAN_LIMIT_FREE_USER) appears in the
--   credits + buckets math — keep in sync with the app + dashboard.sql.
-- ⚠ Owner emails duplicated from dashboard.sql/030 — keep all in sync.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.admin_metrics_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with me as (
    select id as user_id
    from auth.users
    where lower(replace(email, '.', '')) in (
      'j3k420@gmailcom', 'jamesedmonds26@gmailcom', 'edmondsj46@gmailcom'
    )
  )
  select jsonb_build_object(

    -- ── PRODUCT / USAGE (unchanged from 030) ─────────────────────────
    'scans', jsonb_build_object(
      'today',    (select count(*) from public.scan_events where scanned_at >= date_trunc('day', now())),
      'today_real',    (select count(*) from public.scan_events where scanned_at >= date_trunc('day', now()) and user_id not in (select user_id from me)),
      'last_7d',  (select count(*) from public.scan_events where scanned_at > now() - interval '7 days'),
      'last_7d_real',  (select count(*) from public.scan_events where scanned_at > now() - interval '7 days' and user_id not in (select user_id from me)),
      'last_30d', (select count(*) from public.scan_events where scanned_at > now() - interval '30 days'),
      'last_30d_real', (select count(*) from public.scan_events where scanned_at > now() - interval '30 days' and user_id not in (select user_id from me)),
      'lifetime', (select count(*) from public.scan_events),
      'lifetime_real', (select count(*) from public.scan_events where user_id not in (select user_id from me)),
      'distinct_scanners', (select count(distinct user_id) from public.scan_events),
      'distinct_scanners_real', (select count(distinct user_id) from public.scan_events where user_id not in (select user_id from me)),
      -- NEW: scans-per-user buckets (real users only — owner accounts excluded).
      'per_user_buckets', (select coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb) from (
        select case
                 when scans = 1 then '1'
                 when scans = 2 then '2'
                 when scans = 3 then '3 (free cap)'
                 when scans between 4 and 9 then '4-9'
                 else '10+'
               end as bucket, count(*) as n
        from (select user_id, count(*) as scans from public.scan_events
              where user_id not in (select user_id from me) group by user_id) pu
        group by 1) b)
    ),

    'users', jsonb_build_object(
      'total',         (select count(*) from auth.users),
      'total_real',    (select count(*) from auth.users where id not in (select user_id from me)),
      'signups_7d',    (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'signups_7d_real',  (select count(*) from auth.users where created_at > now() - interval '7 days' and id not in (select user_id from me)),
      'signups_30d',   (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'signups_30d_real', (select count(*) from auth.users where created_at > now() - interval '30 days' and id not in (select user_id from me)),
      'ever_scanned',  (select count(distinct user_id) from public.scan_events),
      'ever_scanned_real',  (select count(distinct user_id) from public.scan_events where user_id not in (select user_id from me)),
      'ever_bought',   (select count(distinct user_id) from public.scan_credits where purchased > 0),
      'ever_bought_real',   (select count(distinct user_id) from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)),
      -- NEW: sign-in provider split (distribution — no owner-exclusion).
      'by_provider', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
        select coalesce(raw_app_meta_data->>'provider', 'email') as provider, count(*) as n
        from auth.users group by 1) p)
    ),

    'stories', jsonb_build_object(
      'live',          (select count(*) from public.stories where deleted_at is null),
      'live_real',     (select count(*) from public.stories where deleted_at is null and user_id not in (select user_id from me)),
      'public',        (select count(*) from public.stories where is_public and deleted_at is null),
      'public_real',   (select count(*) from public.stories where is_public and deleted_at is null and user_id not in (select user_id from me)),
      'new_7d',        (select count(*) from public.stories where created_at > now() - interval '7 days' and deleted_at is null),
      'new_7d_real',   (select count(*) from public.stories where created_at > now() - interval '7 days' and deleted_at is null and user_id not in (select user_id from me)),
      'new_30d',       (select count(*) from public.stories where created_at > now() - interval '30 days' and deleted_at is null),
      'new_30d_real',  (select count(*) from public.stories where created_at > now() - interval '30 days' and deleted_at is null and user_id not in (select user_id from me))
    ),

    'graves', jsonb_build_object(
      'total',           (select count(*) from public.graves),
      'public',          (select count(*) from public.graves where is_public),
      'corrected',       (select count(*) from public.graves where user_corrected),
      'marker_staked',   (select count(*) from public.graves where marker_style is not null),
      'photos',          (select count(*) from public.grave_photos),
      'photos_real',     (select count(*) from public.grave_photos where user_id not in (select user_id from me)),
      -- NEW: marker-style popularity (distribution).
      'marker_breakdown', (select coalesce(jsonb_object_agg(style, n), '{}'::jsonb) from (
        select coalesce(marker_style, '(default/book)') as style, count(*) as n
        from public.graves group by 1) m)
    ),

    -- NEW: tributes breakdown.
    'tributes', jsonb_build_object(
      'total',   (select count(*) from public.tributes),
      'candles', (select count(*) from public.tributes where type = 'candle'),
      'flowers', (select count(*) from public.tributes where type = 'flower'),
      'graves_with_tributes', (select count(distinct grave_id) from public.tributes)
    ),

    -- ── MONEY IN (unchanged keys + new conversion_timing / free_scan_cost) ──
    'money_in', jsonb_build_object(
      'credits_sold_gross', (select coalesce(sum(amount), 0) from public.revenuecat_events where amount > 0),
      'credits_sold_gross_real', (select coalesce(sum(amount), 0) from public.revenuecat_events where amount > 0 and (user_id is null or user_id not in (select user_id from me))),
      'credits_clawed_back',(select coalesce(-sum(amount), 0) from public.revenuecat_events where amount < 0),
      'purchase_count',     (select count(*) from public.revenuecat_events where amount > 0),
      'purchase_count_real',(select count(*) from public.revenuecat_events where amount > 0 and (user_id is null or user_id not in (select user_id from me))),
      'refund_count',       (select count(*) from public.revenuecat_events where amount < 0),
      'paying_users',       (select count(distinct user_id) from public.scan_credits where purchased > 0),
      'paying_users_real',  (select count(distinct user_id) from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)),
      'credits_outstanding',(select coalesce(sum(greatest(sc.purchased - greatest(coalesce(se.scans, 0) - 3 /*free*/, 0), 0)), 0)
                               from public.scan_credits sc
                               left join (select user_id, count(*) as scans from public.scan_events group by user_id) se on se.user_id = sc.user_id
                               where sc.purchased > 0),
      'pack_breakdown',     (select coalesce(jsonb_object_agg(pid, row_to_json(b)), '{}'::jsonb) from (
                                 select coalesce(product_id, '(unknown)') as pid,
                                        count(*) filter (where amount > 0) as buys,
                                        coalesce(sum(amount) filter (where amount > 0), 0) as credits
                                 from public.revenuecat_events group by coalesce(product_id, '(unknown)')) b),
      'pack_breakdown_real',(select coalesce(jsonb_object_agg(pid, row_to_json(b)), '{}'::jsonb) from (
                                 select coalesce(product_id, '(unknown)') as pid,
                                        count(*) filter (where amount > 0) as buys,
                                        coalesce(sum(amount) filter (where amount > 0), 0) as credits
                                 from public.revenuecat_events
                                 where user_id is null or user_id not in (select user_id from me)
                                 group by coalesce(product_id, '(unknown)')) b),
      -- NEW: at how many scans had each buyer bought? (peak-intent check)
      'conversion_timing', (select coalesce(jsonb_object_agg(scans_before::text, buyers), '{}'::jsonb) from (
        select scans_before_purchase as scans_before, count(*) as buyers from (
          select sc.user_id,
                 count(se.id) filter (where se.scanned_at <= sc.updated_at) as scans_before_purchase
          from public.scan_credits sc
          join public.scan_events se on se.user_id = sc.user_id
          where sc.purchased > 0
          group by sc.user_id, sc.updated_at) t
        group by scans_before_purchase) ct),
      -- NEW: avg free scans per pure free-rider (× ~$0.08 = $/free user).
      'free_scan_avg', (select coalesce(round(avg(scans), 2), 0) from (
        select se.user_id, count(*) as scans
        from public.scan_events se
        left join public.scan_credits sc on sc.user_id = se.user_id and sc.purchased > 0
        where sc.user_id is null
        group by se.user_id) fr)
    ),

    'conversion', jsonb_build_object(
      'scanners',      (select count(distinct user_id) from public.scan_events),
      'scanner_buyers',(select count(*) from (select distinct user_id from public.scan_credits where purchased > 0) b
                          where b.user_id in (select distinct user_id from public.scan_events)),
      'pct',           (select coalesce(round(100.0 * (select count(*) from (select distinct user_id from public.scan_credits where purchased > 0) b
                          where b.user_id in (select distinct user_id from public.scan_events))
                          / nullif((select count(distinct user_id) from public.scan_events), 0), 1), 0)),
      'scanners_real', (select count(distinct user_id) from public.scan_events where user_id not in (select user_id from me)),
      'scanner_buyers_real',(select count(*) from (select distinct user_id from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)) b
                          where b.user_id in (select distinct user_id from public.scan_events where user_id not in (select user_id from me))),
      'pct_real',      (select coalesce(round(100.0 * (select count(*) from (select distinct user_id from public.scan_credits where purchased > 0 and user_id not in (select user_id from me)) b
                          where b.user_id in (select distinct user_id from public.scan_events where user_id not in (select user_id from me)))
                          / nullif((select count(distinct user_id) from public.scan_events where user_id not in (select user_id from me)), 0), 1), 0))
    ),

    -- NEW: loading-time percentiles (30d, cached vs full pipeline), seconds.
    'loading', (select coalesce(jsonb_object_agg(kind, row_to_json(l)), '{}'::jsonb) from (
      select case when (props->>'cached')::boolean then 'cache_hit' else 'full' end as kind,
             count(*) as n,
             round(avg((props->>'dur_ms')::numeric)/1000, 1) as avg_s,
             round((percentile_cont(0.5) within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1) as median_s,
             round((percentile_cont(0.9) within group (order by (props->>'dur_ms')::numeric))::numeric/1000, 1) as p90_s,
             round(max((props->>'dur_ms')::numeric)/1000, 1) as max_s
      from public.analytics_events
      where event = 'bio_shown' and props ? 'dur_ms' and created_at > now() - interval '30 days'
      group by 1) l),

    'reports', jsonb_build_object(
      'total',     (select count(*) from public.content_reports),
      'total_real',(select count(*) from public.content_reports where reporter_id is null or reporter_id not in (select user_id from me)),
      'on_public', (select count(*) from public.content_reports where is_public),
      'on_public_real', (select count(*) from public.content_reports where is_public and (reporter_id is null or reporter_id not in (select user_id from me))),
      'urgent',    (select count(*) from public.content_reports where is_public and reason in ('privacy', 'offensive')),
      'urgent_real',(select count(*) from public.content_reports where is_public and reason in ('privacy', 'offensive') and (reporter_id is null or reporter_id not in (select user_id from me))),
      'by_reason', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from (select reason, count(*) as n from public.content_reports group by reason) r)
    ),

    'generated_at', now()
  );
$$;

revoke all on function public.admin_metrics_summary() from public, anon, authenticated;
grant execute on function public.admin_metrics_summary() to service_role;

comment on function public.admin_metrics_summary() is
  'Admin dashboard metric aggregates (v2 superset) as one jsonb blob. Read-only, SECURITY DEFINER, service_role-only. Called by the Worker /admin/metrics route. Mirrors queries/dashboard.sql + analytics.sql.';


-- ════════════════════════════════════════════════════════════════════════
-- admin_daily_series(p_days) — daily counts for the trend charts
-- ════════════════════════════════════════════════════════════════════════
-- One row per calendar day for the last p_days (default 30): scans (total +
-- owner-excluded), signups, new public stories. generate_series gives a dense
-- day axis (no gaps) so the line chart doesn't skip empty days. Returns a jsonb
-- ARRAY ordered oldest→newest. Service-role only; exposes counts, no PII.
create or replace function public.admin_daily_series(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with me as (
    select id as user_id from auth.users
    where lower(replace(email, '.', '')) in (
      'j3k420@gmailcom', 'jamesedmonds26@gmailcom', 'edmondsj46@gmailcom')
  ),
  -- Clamp the window to a sane range (1..365 days).
  days as (
    select generate_series(
      (current_date - (least(greatest(p_days, 1), 365) - 1))::date,
      current_date,
      interval '1 day'
    )::date as day
  ),
  scans as (
    select scanned_at::date as day,
           count(*) as scans,
           count(*) filter (where user_id not in (select user_id from me)) as scans_real
    from public.scan_events
    where scanned_at >= current_date - 365
    group by 1
  ),
  signups as (
    select created_at::date as day, count(*) as n
    from auth.users where created_at >= current_date - 365 group by 1
  ),
  pubstories as (
    select created_at::date as day, count(*) as n
    from public.stories
    where is_public and deleted_at is null and created_at >= current_date - 365
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'scans', coalesce(s.scans, 0),
           'scans_real', coalesce(s.scans_real, 0),
           'signups', coalesce(su.n, 0),
           'new_public_stories', coalesce(ps.n, 0)
         ) order by d.day), '[]'::jsonb)
  from days d
  left join scans s   on s.day  = d.day
  left join signups su on su.day = d.day
  left join pubstories ps on ps.day = d.day;
$$;

revoke all on function public.admin_daily_series(integer) from public, anon, authenticated;
grant execute on function public.admin_daily_series(integer) to service_role;

comment on function public.admin_daily_series(integer) is
  'Daily scans/signups/new-public-stories series for the admin dashboard trend charts. Read-only, SECURITY DEFINER, service_role-only.';

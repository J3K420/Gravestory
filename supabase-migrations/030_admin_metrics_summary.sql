-- ════════════════════════════════════════════════════════════════════════
-- Migration 030 — admin_metrics_summary()  (admin dashboard backend)
-- ════════════════════════════════════════════════════════════════════════
-- ONE read-only SECURITY DEFINER function that returns a single jsonb blob of
-- every headline metric the admin dashboard renders. The Cloudflare Worker
-- (/admin/metrics) calls it via /rest/v1/rpc/admin_metrics_summary with the
-- SERVICE-ROLE key; the browser never touches Supabase directly (the metrics
-- tables have no SELECT policy by design — see migrations 008/013 and the
-- reference-rls-load-bearing note).
--
-- WHY A FUNCTION (not REST counts from the Worker): the aggregates here need
-- sum()/count(distinct)/group-by and access to auth.users — none of which
-- PostgREST can do over plain table reads. One SECURITY DEFINER function does
-- it in a single round-trip and reuses the exact, already-trusted expressions
-- from queries/dashboard.sql + queries/analytics.sql (byte-faithful, including
-- the `me` owner-exclusion CTE so real-user figures drop the 3 owner accounts).
--
-- 100% READ-ONLY: every statement inside is a SELECT. Nothing is written.
--
-- SECURITY: SECURITY DEFINER runs with the function owner's rights (so it can
-- read auth.users + the locked metrics tables), but EXECUTE is granted ONLY to
-- service_role. anon/authenticated are REVOKEd, so a leaked anon key still
-- cannot call it. search_path is pinned to defeat the classic SECURITY DEFINER
-- search-path hijack.
--
-- ⚠ The free-scan allowance constant `3` (SCAN_LIMIT_FREE_USER, S66) appears in
-- the "credits unused" math — update it here if the free allowance ever changes.
-- ⚠ Owner emails are duplicated from dashboard.sql — keep the two in sync.
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

    -- ── PRODUCT / USAGE ──────────────────────────────────────────────
    'scans', jsonb_build_object(
      'today',    (select count(*) from public.scan_events
                     where scanned_at >= date_trunc('day', now())),
      'last_7d',  (select count(*) from public.scan_events
                     where scanned_at > now() - interval '7 days'),
      'last_30d', (select count(*) from public.scan_events
                     where scanned_at > now() - interval '30 days'),
      'lifetime', (select count(*) from public.scan_events),
      'distinct_scanners', (select count(distinct user_id) from public.scan_events)
    ),

    'users', jsonb_build_object(
      'total',         (select count(*) from auth.users),
      'total_real',    (select count(*) from auth.users where id not in (select user_id from me)),
      'signups_7d',    (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'signups_30d',   (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'ever_scanned',  (select count(distinct user_id) from public.scan_events),
      'ever_bought',   (select count(distinct user_id) from public.scan_credits where purchased > 0)
    ),

    'stories', jsonb_build_object(
      'live',          (select count(*) from public.stories where deleted_at is null),
      'public',        (select count(*) from public.stories where is_public and deleted_at is null),
      'public_real',   (select count(*) from public.stories
                          where is_public and deleted_at is null and user_id not in (select user_id from me)),
      'new_7d',        (select count(*) from public.stories
                          where created_at > now() - interval '7 days' and deleted_at is null),
      'new_30d',       (select count(*) from public.stories
                          where created_at > now() - interval '30 days' and deleted_at is null)
    ),

    'graves', jsonb_build_object(
      'total',           (select count(*) from public.graves),
      'public',          (select count(*) from public.graves where is_public),
      'corrected',       (select count(*) from public.graves where user_corrected),
      'marker_staked',   (select count(*) from public.graves where marker_style is not null),
      'photos',          (select count(*) from public.grave_photos)
    ),

    -- ── MONEY IN ─────────────────────────────────────────────────────
    -- gross credits sold = sum of positive grant amounts in the durable ledger
    -- (revenuecat_events). scan_credits.purchased is net-of-clawbacks + never
    -- decremented on use, so it is the WRONG number for "sold". paying_users
    -- comes from scan_credits (who currently holds a positive balance ever).
    -- pack_breakdown groups the ledger by product_id; NOTE the live grant path
    -- inserts product_id = NULL (worker 017/026), so this will usually bucket
    -- under "(unknown)" until/unless the worker is changed to populate it.
    'money_in', jsonb_build_object(
      'credits_sold_gross', (select coalesce(sum(amount), 0) from public.revenuecat_events where amount > 0),
      'credits_clawed_back',(select coalesce(-sum(amount), 0) from public.revenuecat_events where amount < 0),
      'purchase_count',     (select count(*) from public.revenuecat_events where amount > 0),
      'refund_count',       (select count(*) from public.revenuecat_events where amount < 0),
      'paying_users',       (select count(distinct user_id) from public.scan_credits where purchased > 0),
      'credits_outstanding',(select coalesce(sum(greatest(sc.purchased
                                - greatest(coalesce(se.scans, 0) - 3 /*free allowance*/, 0), 0)), 0)
                               from public.scan_credits sc
                               left join (select user_id, count(*) as scans
                                            from public.scan_events group by user_id) se
                                 on se.user_id = sc.user_id
                               where sc.purchased > 0),
      'pack_breakdown',     (select coalesce(jsonb_object_agg(pid, row_to_json(b)), '{}'::jsonb)
                               from (
                                 select coalesce(product_id, '(unknown)') as pid,
                                        count(*) filter (where amount > 0)        as buys,
                                        coalesce(sum(amount) filter (where amount > 0), 0) as credits
                                 from public.revenuecat_events
                                 group by coalesce(product_id, '(unknown)')
                               ) b)
    ),

    -- conversion = scanners who also bought / scanners (the freemium funnel KPI)
    'conversion', jsonb_build_object(
      'scanners',      (select count(distinct user_id) from public.scan_events),
      'scanner_buyers',(select count(*) from (
                          select distinct user_id from public.scan_credits where purchased > 0
                        ) b where b.user_id in (select distinct user_id from public.scan_events)),
      'pct',           (select coalesce(round(
                          100.0 * (select count(*) from (
                                     select distinct user_id from public.scan_credits where purchased > 0
                                   ) b where b.user_id in (select distinct user_id from public.scan_events))
                          / nullif((select count(distinct user_id) from public.scan_events), 0), 1), 0))
    ),

    -- ── HEALTH ───────────────────────────────────────────────────────
    -- content_reports has NO status column — there is no "pending" state. We
    -- surface the raw total + the urgent subset (privacy/offensive on a PUBLIC
    -- story = a hurtful/wrong bio on the global map, the one to act on now).
    'reports', jsonb_build_object(
      'total',     (select count(*) from public.content_reports),
      'on_public', (select count(*) from public.content_reports where is_public),
      'urgent',    (select count(*) from public.content_reports
                      where is_public and reason in ('privacy', 'offensive')),
      'by_reason', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
                      from (select reason, count(*) as n from public.content_reports group by reason) r)
    ),

    'generated_at', now()
  );
$$;

-- Lock down: service-role only. The metrics this exposes (auth.users counts,
-- revenue, scan volume) must never be reachable from the public anon key.
revoke all on function public.admin_metrics_summary() from public, anon, authenticated;
grant execute on function public.admin_metrics_summary() to service_role;

comment on function public.admin_metrics_summary() is
  'Admin dashboard metric aggregates as one jsonb blob. Read-only, SECURITY DEFINER, service_role-only. Called by the Worker /admin/metrics route. Mirrors queries/dashboard.sql.';

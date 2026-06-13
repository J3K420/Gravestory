-- AUDIT — for every public table: is RLS enabled, and how many policies guard it?
-- This is the real safety check. Broad anon/authenticated GRANTs (which this
-- project hands out by default) are only safe if RLS is ENABLED and a policy
-- exists for each operation a client should NOT be able to do.
--
-- DANGER ROWS: rls_enabled = false on any table holding user data, OR a table
-- with grants but zero policies (RLS on + no policy = all client ops denied,
-- which is safe-but-check; RLS OFF + broad grants = fully exposed).

select
  t.tablename,
  c.relrowsecurity              as rls_enabled,
  count(p.policyname)           as policy_count
from pg_tables t
join pg_class c       on c.relname = t.tablename
left join pg_policies p on p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, c.relrowsecurity
order by rls_enabled, t.tablename;

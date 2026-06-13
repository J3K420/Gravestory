-- CHECK 2 — exactly one INSERT policy, no SELECT/UPDATE/DELETE
-- Expected: one row, cmd = INSERT. Any SELECT/UPDATE/DELETE row = misconfig
-- (clients could read or alter events).

select policyname, cmd
from pg_policies
where tablename = 'analytics_events';

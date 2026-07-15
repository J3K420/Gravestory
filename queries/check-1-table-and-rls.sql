set session characteristics as transaction read only;
set transaction read only;

-- CHECK 1 — table exists and RLS is enabled
-- Expected: one row, rowsecurity = true.

select tablename, rowsecurity
from pg_tables
where tablename = 'analytics_events';

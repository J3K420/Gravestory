-- CHECK 3 — does the anon role have table-level INSERT?
-- Without it, GUEST (signed-out) events are silently rejected even though the
-- RLS policy permits NULL user_id.
-- Expected: BOTH 'anon | INSERT' and 'authenticated | INSERT'.
-- If 'anon' is missing, run migration 009_analytics_anon_insert.sql.

select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'analytics_events'
  and grantee in ('anon', 'authenticated');

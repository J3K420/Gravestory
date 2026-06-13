-- AUDIT — scan_credits is the highest-stakes table: it controls how many paid
-- scans a user has. It's meant to be SERVICE-ROLE-WRITE-ONLY (clients can read
-- their own row, but only the RevenueCat webhook/service role may change
-- `purchased`). If a client could UPDATE it, a user could grant themselves
-- unlimited scans.
--
-- Confirm: (1) RLS is enabled, and (2) there is NO client INSERT/UPDATE/DELETE
-- policy (only a SELECT-own policy, if any). Table-level grants to anon/
-- authenticated are fine ONLY because RLS denies the un-policied operations.

-- (a) RLS on?
select relname, relrowsecurity as rls_enabled
from pg_class
where relname = 'scan_credits';

-- (b) What policies exist, and for which commands?
select policyname, cmd, roles
from pg_policies
where tablename = 'scan_credits';
-- HEALTHY: at most a SELECT policy (users read own credits). NO INSERT/UPDATE/
-- DELETE policy for anon/authenticated. If you see an UPDATE/INSERT policy open
-- to authenticated, that's a credit-granting hole — investigate immediately.

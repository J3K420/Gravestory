-- CHECK 4 — are both auth paths producing events?
-- First do ONE signed-in action and ONE signed-out (guest) action in the app/web,
-- then run this.
-- Expected: TWO rows ('signed_in' and 'guest'), both with count > 0.
-- If 'guest' is missing or 0, the anon INSERT grant (migration 009) is the cause.

select
  case when user_id is not null then 'signed_in' else 'guest' end as auth_path,
  count(*) as event_count
from analytics_events
group by user_id is not null
order by user_id is not null;

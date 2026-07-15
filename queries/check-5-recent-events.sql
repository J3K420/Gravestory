set session characteristics as transaction read only;
set transaction read only;

-- CHECK 5 — most recent 10 events, with platform and props
-- Eyeball that real events are flowing (e.g. scan_started, ocr_done, bio_shown,
-- sample_viewed) with sensible platform ('web'|'ios'|'android') and props.

select event, platform, created_at, props
from analytics_events
order by created_at desc
limit 10;

# GraveStory metrics digest

A local "what changed" report on the funnel telemetry (`analytics_events`) plus
`scan_events`, `scan_credits`, and `stories`. Tells you each day where users fall
off in the scan funnel, whether GPS is resolving cemetery names, which research
sources earn their cost, and whether purchases are landing as credits.

## Why this runs locally (not as a scheduled cloud agent)

The `analytics_events` / `scan_events` / `scan_credits` tables have **no SELECT
policy** by design — reads require the Supabase **service-role key**, which
bypasses RLS. That key must never live in the repo (a `/schedule` cloud routine
checks the repo out into a sandbox). So the digest runs on your machine, where
the key sits in a gitignored `.env`.

If you later want a hands-off morning digest, the right move is a Supabase MCP
connector + a `/schedule` routine, or a local Windows Task Scheduler job that runs
this script and emails/pushes the output — see "Automating" below.

## One-time setup

```powershell
cd tools/metrics-digest
npm install
Copy-Item .env.example .env
# then edit .env and paste the service_role key
```

Get the key from: **Supabase dashboard → Project Settings → API → `service_role`**.

## Run it

```powershell
npm run digest            # last 24h vs the prior 24h  (the daily glance)
npm run week              # last 7 days
node digest.mjs --hours 72
node digest.mjs --json    # machine-readable, for piping into something else
```

## What it shows

- **WHAT CHANGED** — the lead. Headline metrics with ▲/▼ vs the prior identical
  window. Says "all flat" loudly when nothing moved, "QUIET" when zero events.
- **SCAN FUNNEL** — `started → ocr_done → bio_shown → saved → made public`, each
  with a % of the prior step, plus cache hits, scan-limit hits, errors, guest split.
- **CEMETERY RESOLUTION** — the launch-doc #1b hypothesis as a number: % of GPS
  scans that resolved a cemetery name (the top-tier Tavily disambiguator).
  Flags ⚠ below 50%.
- **RESEARCH YIELD** — average hits per source per scan (Tavily is ~85% of variable
  cost — this is the data to decide whether to trim slots), plus dry-scan count.
- **ENGAGEMENT** — maps opened, tributes, shares, sample views.
- **MONETIZATION** — paywall shown, purchases ✓/✗, and a webhook cross-check
  (purchases vs `scan_credits` bumps — flags if credits didn't land).
- **TOTALS** — slow-moving context (all-time scans, public stories).

## Automating (optional, later)

Windows Task Scheduler can run this daily and pipe the output somewhere you'll see
it. Quickest path — a `.cmd` that writes the digest to a file you check, or pipes
to a notifier:

```powershell
# Example: run at 8am daily, append to a dated log
schtasks /create /tn "GraveStory digest" /tr "node \"%CD%\digest.mjs\" >> \"%USERPROFILE%\gravestory-digest.log\"" /sc daily /st 08:00
```

For phone push, swap the redirect for a curl to a Pushover/ntfy webhook, or wire a
Supabase MCP connector and use `/schedule` so it runs without your PC on.

## Notes

- Read-only. The service-role key *can* write, but this script only SELECTs.
- Safe to run as often as you like; it pulls a bounded window (≤50k events).
- `scan_events` has no per-row timestamp filter issues, but if a query is denied
  the script degrades gracefully (shows `—`) rather than crashing.

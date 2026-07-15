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
# then edit .env for the selected target
```

For an approved production read, get the URL and key from **Supabase dashboard →
Project Settings → API**. For local reads, use the disposable local stack's
service-role key. Never reuse a production key for the local target.

## Select a target and run it

```powershell
# Disposable local Supabase (default local URL is loopback only)
npm run digest -- --target local --confirm local-read
npm run week -- --target local --confirm local-read

# Production requires separate approval plus explicit production-named URL and key
node digest.mjs --target production --confirm production-read --hours 72
node digest.mjs --target production --confirm production-read --json
```

There is deliberately no production URL default. Omitting `--target`, using the
wrong confirmation phrase, or selecting production without an exact HTTPS
`SUPABASE_PRODUCTION_URL` and `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY` fails before
any request is made. Local reads use `SUPABASE_LOCAL_SERVICE_ROLE_KEY` and an
optional loopback-only `SUPABASE_LOCAL_URL`, so a credential cannot silently
cross targets. The explicit production URL must also match the reviewed,
non-secret origin allowlist in `tools/supabase-target-policy.mjs`; the allowlist authorizes a destination
but does not supply a default or grant approval. A production read still requires
the owner's explicit approval; the command-line confirmation does not grant it.

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

Windows Task Scheduler can run this daily. Create an environment-specific
`run-local-digest.cmd` outside the repository with absolute paths (Task Scheduler
does not guarantee a working directory and direct actions do not interpret `>>`):

```bat
@echo off
"C:\Program Files\nodejs\node.exe" "C:\absolute\path\to\GraveStory\tools\metrics-digest\digest.mjs" --target local --confirm local-read >> "%USERPROFILE%\gravestory-digest.log" 2>&1
```

Then register that wrapper from PowerShell after resolving its absolute path:

```powershell
$wrapper = (Resolve-Path 'C:\absolute\path\to\run-local-digest.cmd').Path
schtasks.exe /create /tn 'GraveStory local digest' /tr "`"$wrapper`"" /sc daily /st 08:00
```

For phone push, swap the redirect for a curl to a Pushover/ntfy webhook, or wire a
Supabase MCP connector and use `/schedule` so it runs without your PC on.

## Notes

- Read-only. The service-role key *can* write, but this script only SELECTs.
- The window is limited to 8,760 whole hours and each event query is capped at 50k rows.
- `scan_events` has no per-row timestamp filter issues, but if a query is denied
  the script degrades gracefully (shows `—`) rather than crashing.

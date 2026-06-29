# GraveStory — Admin Metrics Dashboard

A single page you open on any device (Windows, phone) to watch the app's vital
signs: product/usage, money in, runway (money out), the conversion funnel, and
content-moderation health.

## How it's wired

```
[ browser ] --GET /admin/metrics (Bearer ADMIN_KEY)--> [ Cloudflare Worker ]
                                                          ├─ Supabase (service-role) — LIVE
                                                          ├─ RevenueCat API          — optional
                                                          ├─ Google Cloud billing    — optional
                                                          └─ Tavily — DERIVED + deep-link (no API)
```

The browser never touches Supabase. The Worker holds the service-role key and
returns only aggregated JSON. Every number is tagged **live / derived /
degraded / error** so you always know how much to trust it.

**Why a Worker, not a plain static page:** the metrics tables
(`analytics_events`, `scan_events`, `scan_credits`, `revenuecat_events`,
`content_reports`) have RLS with **no SELECT policy** — the public anon key
literally cannot read them. Reads require the service-role key, which only the
Worker holds.

---

## One-time setup (owner)

### 1. Run migration 030 in the Supabase SQL editor
Paste `supabase-migrations/030_admin_metrics_summary.sql` into the Supabase SQL
editor and Run. Then verify:

```sql
select admin_metrics_summary();          -- returns the metrics jsonb blob
```

It is locked to `service_role`, so confirm the lockdown holds (run as anon —
this should ERROR, which is correct):

```sql
set role anon;
select admin_metrics_summary();          -- expect: permission denied
reset role;
```

### 2. Set the ADMIN_KEY Worker secret
Pick a long random string (this IS a real secret — unlike the public
`CLIENT_KEY`):

```bash
cd worker
wrangler secret put ADMIN_KEY
# paste the random string when prompted
wrangler deploy
```

### 3. Open the dashboard
Deploy the static page with the rest of the site (it's at
`/metrics-dashboard/` on GitHub Pages). Open it and either:
- type the key into the unlock box (stored in `sessionStorage` only), **or**
- bookmark `https://<your-pages-site>/metrics-dashboard/#<ADMIN_KEY>` — the key
  in the URL hash is read once, saved to the session, then stripped from the
  address bar. (Hash, not query string, so it never lands in server logs.)

That's it — **Supabase product/usage/money-in/funnel/health are LIVE** after
steps 1–3.

---

## Optional: light up the remaining sources

These default to **degraded** (the card shows a fallback + a deep-link button)
and turn **live** automatically once configured.

### Google Cloud spend (live month-to-date)

**Cheap (no setup)** — set a budget + a number you paste when you glance at the
console; the card shows `$X / budget $Y`:
```bash
wrangler secret put GCLOUD_MONTHLY_BUDGET   # e.g. 50
wrangler secret put GCLOUD_LAST_SPEND       # e.g. 6.40  (update when you check)
```

**Live (auto, via BigQuery billing export)** — one-time GCP setup, then the card
shows real month-to-date spend with no manual updates:
1. **Enable the export:** GCP console → Billing → **Billing export** → enable
   **Standard usage cost** export to a BigQuery dataset. (Takes a few hours to
   start populating; up to ~5 days to backfill the current month.)
2. **Create a service account** with roles **BigQuery Job User** (on the project
   that runs the query) + **BigQuery Data Viewer** (on the billing dataset).
   Create a **JSON key** for it.
3. **Find the export table name** in BigQuery — it looks like
   `your-project.billing_dataset.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`.
4. **Set the Worker secrets** (paste the matching values from the JSON key):
   ```bash
   wrangler secret put GCP_SA_EMAIL        # client_email from the JSON
   wrangler secret put GCP_SA_PRIVATE_KEY  # private_key from the JSON (the whole
                                           # -----BEGIN...END----- block; \n-escaped is fine)
   wrangler secret put GCP_PROJECT_ID      # project that runs the query
   wrangler secret put GCP_BILLING_TABLE   # the full table name from step 3
   wrangler deploy
   ```
The Worker mints a short-lived OAuth token from the service account (RS256 JWT)
and runs a `SUM(cost)+credits` query for the current invoice month. If anything
is missing/misconfigured, the card degrades to the budget + last-pasted number
instead of breaking.

### RevenueCat (live MRR / revenue)
The in-DB credits ledger already drives Money-in, so this is the authoritative
*cross-check* (MRR, 28-day revenue, active subs). To wire it:
1. RevenueCat dashboard → **Project settings → API keys** → create a **v2 Secret
   key** and grant it the **`charts_metrics:overview:read`** permission (the
   overview-metrics endpoint needs that scope).
2. Grab your **project id** (in the dashboard URL, or the Worker will auto-find
   it via `GET /v2/projects` using the same key).
3. Set the secrets:
   ```bash
   wrangler secret put REVENUECAT_SECRET_KEY   # the v2 secret key (sk_...)
   wrangler secret put REVENUECAT_PROJECT_ID   # optional — auto-discovered if omitted
   wrangler deploy
   ```
⚠️ RevenueCat's docs are ambiguous about whether a *secret* key can hold the
`charts_metrics` scope or whether that endpoint requires an **OAuth** token. The
Worker tries the secret key and, if RevenueCat rejects it, the card shows the
exact API error (e.g. a 403 scope message) instead of breaking — so you'll know
immediately whether you need the OAuth path. Either way the DB ledger keeps
Money-in populated.

### Tavily
**No usage API exists.** The card shows an **estimate** from your lifetime scan
count (~10 credits / ~$0.08 per scan; $30 / 4000-credit monthly plan) plus an
**Open Tavily ↗** button for the authoritative balance. This is by design — you
cannot embed (iframe) the Tavily dashboard, so a deep-link is correct.

---

## "Exclude my accounts" toggle

The dashboard defaults to showing **real-user** numbers — the 3 owner accounts
(`j3k420`, `jamesedmonds26`, `edmondsj46`) are excluded from scans, signups,
stories, money-in, conversion, and content reports. Toggle the **"Exclude my
accounts"** button in the controls bar to flip every card between real-user and
all-accounts (including yours). The toggle re-renders instantly from the cached
data — no refetch. (Graves have no per-user owner column, so the Graves card is
always raw; grave-photos counts do honor the toggle.) The owner-account list
lives in the `me` CTE of migration 030 — keep it in sync with `queries/dashboard.sql`.

## Notes on the numbers

- **Est. revenue ($)** is reconstructed from credits sold via the price table
  (5/$1.99, 20/$5.99, 60/$12.99, 150/$24.99). There is **no dollar column in
  Supabase**. If `revenuecat_events.product_id` is NULL (the current live grant
  path inserts NULL), the per-pack breakdown can't attribute packs and the page
  falls back to a blended per-credit estimate — labeled as reconstructed.
- **Credits sold** here is the **gross** figure — `sum(amount)` of positive
  grants in the `revenuecat_events` ledger. This intentionally differs from the
  hand-run `queries/dashboard.sql` "credits sold" (which sums
  `scan_credits.purchased`, a figure that is net-of-clawbacks and that
  dashboard.sql itself annotates as "not unused balance"). The ledger sum is the
  truer "ever sold" number; the two won't match once any refund has happened.
- **Content reports** have no "resolved" state in the schema, so the page shows
  the raw total + the **urgent** subset (privacy/offensive on a public story).
- Cross-check any time against the terminal digest:
  `node tools/metrics-digest/digest.mjs --json` — it reads the same tables.

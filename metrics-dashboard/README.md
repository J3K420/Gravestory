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

### Google Cloud spend
Two levels:
- **Cheap (no setup):** set two Worker vars so the card shows your budget and a
  number you paste in periodically:
  ```bash
  wrangler secret put GCLOUD_MONTHLY_BUDGET   # e.g. 50
  wrangler secret put GCLOUD_LAST_SPEND       # e.g. 6.40  (update when you check)
  ```
- **Live:** enable Cloud Billing → BigQuery export in the GCP console, add a
  service-account, and extend `adminGoogleCloud()` to query the export dataset.
  (Stubbed; the handler is shaped to drop the live query in.)

### RevenueCat
The in-DB credits ledger already gives you purchases / credits sold / est.
revenue, so this is a *cross-check*, not essential. To wire it:
```bash
wrangler secret put REVENUECAT_SECRET_KEY    # a READ-ONLY RevenueCat secret key
```
Then extend `adminRevenueCat()` with your RevenueCat project id. (Stubbed
to `degraded` until then — RevenueCat's REST surface for a raw revenue total is
limited, so the DB ledger remains the primary money-in source.)

### Tavily
**No usage API exists.** The card shows an **estimate** from your lifetime scan
count (~10 credits / ~$0.08 per scan; $30 / 4000-credit monthly plan) plus an
**Open Tavily ↗** button for the authoritative balance. This is by design — you
cannot embed (iframe) the Tavily dashboard, so a deep-link is correct.

---

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

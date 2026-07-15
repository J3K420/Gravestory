# Twelve-Factor evidence basis

This companion is evidence, not cross-batch scope. Each child SPEC remains the complete implementation contract for its own branch.

## Standards

- Updated manifesto: https://github.com/twelve-factor/twelve-factor, `next` at `3ad5a5f36312cc8ad876abae1bd691acd790d4d1`
- Original published methodology: https://12factor.net/
- GraveStory audit baseline: `38da4a3664828b24b85a7ab83b060636fd537060`

## Repository evidence by factor

| Factor | Concrete gap or disposition | File-level evidence |
|---|---|---|
| I. Codebase | Product monorepo contains independently released units; apply factors per unit instead of forcing a repository split | `index.html`; `mobile/package.json`; `worker/wrangler.toml`; `tools/metrics-digest/package.json` |
| II. Dependencies | Mobile and metrics have lockfiles, but runtime/CLI pins are incomplete; Worker has no manifest/lock; web Supabase CDN selector floats | `mobile/package.json`; `mobile/package-lock.json`; `mobile/eas.json`; `tools/metrics-digest/package.json`; `tools/metrics-digest/package-lock.json`; `index.html`; `worker/wrangler.toml` |
| III. Config | Secrets use environment mechanisms by design, but public handles are duplicated and missing `ALLOWED_ORIGIN` becomes wildcard | `worker/worker.js`; `worker/wrangler.toml`; `js/config.js`; `js/auth.js`; `mobile/app.config.js`; `mobile/src/lib/config.js`; `mobile/src/lib/supabase.js` |
| IV. Backing services | Worker bindings are configurable; several client/local-tool resource locators require source edits or ambient defaults | `worker/wrangler.toml`; `worker/worker.js`; `mobile/src/lib/api-internetarchive.js`; `mobile/app.config.js`; `tools/metrics-digest/digest.mjs`; `js/auth.js` |
| V. Build/release/run | Platforms issue releases, but no common append-only candidate/final provenance record exists | `mobile/eas.json`; `mobile/app.config.js`; `worker/wrangler.toml`; `docs/cloudflare-pages-cutover.md`; `docs/cloudflare-pages-manifest.txt` |
| VI. Processes | Worker is request-stateless; mobile persistence is intentional user-device product state | `worker/worker.js`; `mobile/src/lib/storage.js`; `mobile/src/lib/pending.js`; `mobile/src/lib/sync.js` |
| VII. Port binding | Cloudflare and Expo own service exposure; GraveStory has no production port-binding server | `worker/worker.js`; `worker/wrangler.toml`; `index.html`; `mobile/app.config.js` |
| VIII. Concurrency | Worker concurrency is platform-managed; no scheduled/queue handlers or independently scaled process types exist | `worker/worker.js`; `mobile/src/screens/CameraScreen.js`; `mobile/src/lib/api-tavily.js` |
| IX. Disposability | Device retries are durable, but many Worker upstream calls lack deadlines and mutating routes need duplicate-delivery classification | `worker/worker.js`; `mobile/src/lib/pending.js`; `mobile/src/lib/sync.js`; `supabase-migrations/017_revenuecat_idempotency.sql`; `supabase-migrations/029_scan_reservations_budget.sql` |
| X. Dev/prod parity | No reproducible local Supabase bootstrap; manual SQL inventory and EAS profile differences are not verified together | `supabase-migrations/`; `mobile/eas.json`; `CLAUDE.md`; `docs/s78-scan-metering-rollout.md` |
| XI. Logs | Worker uses platform event streams, but existing event fields lack a complete structured/redaction contract | `worker/worker.js`; `project-context.md`; `tools/metrics-digest/digest.mjs` |
| XII. Admin processes | SQL and tester/admin tasks are manual; metrics tooling has an implicit project target and no unified task catalog | `supabase-migrations/`; `CLAUDE.md`; `tools/metrics-digest/digest.mjs`; `tools/metrics-digest/README.md` |

## Evidence limits

- Repository comments describe the intended Wrangler/EAS secret mechanisms; remote secret presence was not checked.
- Live Supabase migration state and schema parity were not inspected.
- No external resource was connected, created, mutated, or deployed.
- A local Supabase stack can cover Auth/PostgREST/RLS semantics only after repository bootstrap prerequisites are made reproducible; plain PostgreSQL is not equivalent for those behaviors.

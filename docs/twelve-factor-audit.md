# GraveStory Twelve-Factor audit

Status: baseline audit and implementation roadmap

Audit date: 2026-07-14

GraveStory baseline: `38da4a3664828b24b85a7ab83b060636fd537060`

Standard: updated [Twelve-Factor Manifesto repository](https://github.com/twelve-factor/twelve-factor), `next` branch at `3ad5a5f36312cc8ad876abae1bd691acd790d4d1`, cross-checked against [12factor.net](https://12factor.net/)

## Executive assessment

GraveStory is a product monorepo containing three production deployment units and one local administrative tool:

| Unit | Runtime and release platform | Persistent state |
|---|---|---|
| Static web | Vanilla HTML/CSS/JS on Cloudflare Pages Direct Upload | Supabase; browser state |
| Mobile | Expo SDK 54 / React Native through EAS Build and EAS Update | Supabase; intentional per-user device storage and offline files |
| API proxy | Cloudflare Worker | Supabase and Cloudflare R2 |
| Metrics digest | Local Node.js one-off process | Read-only Supabase access |

Background-work inventory:

- The Worker exports only a request `fetch` handler; there is no queue consumer, scheduled handler, cron process, or repository-defined worker pool.
- Mobile scan orchestration can continue while the app is backgrounded long enough to send a local completion notification. It is not a separately deployed background process, and mobile OS suspension remains possible.
- Pending scans and sync retries are durable device queues resumed by application activity rather than an always-running daemon.
- The web service worker is a browser-managed background event handler: it activates a versioned application cache, maintains a separate tile cache, and serves network-first or cache-first fetches. It is not a server process, and every deployed web-asset change must advance its cache version.
- The metrics digest is an operator-invoked local one-off task, intentionally not a scheduled cloud agent.

The Worker is already close to the process-oriented factors: it is request-scoped, platform-scaled, emits logs to stdout/stderr, and stores durable data in backing services. The highest-risk gaps are around the system that surrounds runtime execution:

1. Dependency and verification tooling is not deterministic across all units, and pull requests have no automated verification.
2. A missing Worker `ALLOWED_ORIGIN` silently becomes `*`, turning configuration absence into an access-control bypass.
3. Database changes are manually pasted into the production SQL editor without a machine-checked migration ledger or reproducible local schema.
4. Releases have platform identifiers, but there is no common immutable record tying web, Worker, mobile, configuration, and migration state to one reviewed commit.
5. Deploy-varying public resource handles are committed in several client files, so changing an attachment can require an application-code edit.

No audit step connected to production, inspected live data, changed remote configuration, rotated a secret, or deployed an artifact.

## Staging re-evaluation

The earlier suggestion that a fully integrated “realish” preview would require a duplicate remote Supabase/Cloudflare graph was over-scoped if read as a Twelve-Factor requirement. No factor mandates that infrastructure.

- Factor I says one codebase has many deploys and explicitly counts each developer's local environment as a deploy. It describes staging as typical, not compulsory.
- Factor III requires deploy-varying configuration to be separate from code. It does not require a fixed set of named environments.
- Factor IV requires backing services to be replaceable attachments addressed through configuration. It does not require every attachment to have a continuously running clone.
- Factor X requires development and production to use similar tools and the same backing-service types/versions where behavior matters. It targets time, personnel, and tool divergence; it does not prescribe a complete remote duplicate.

GraveStory should use the smallest parity mechanism that proves the risk:

| Surface | Smallest justified preview/parity mechanism | When a remote staging resource adds value |
|---|---|---|
| Static web | Serve the exact allowlisted files locally and verify service-worker/cache behavior in a browser | A Cloudflare preview checks Pages headers, routing, and edge behavior |
| Worker | Unit tests plus local `wrangler dev`/runtime emulation with explicit non-secret test config | A preview Worker checks real bindings, edge behavior, and provider network policy |
| Supabase | Migration inventory/static checks plus a version-pinned local Supabase stack for Auth, PostgREST, and RLS semantics once bootstrap prerequisites are reproducible; plain PostgreSQL is only a limited syntax aid | A separate project checks hosted-provider behavior and remote migration application without production risk |
| Mobile | Expo local development plus the existing development, preview, and phase9 contracts | An EAS preview build checks native signing, injected variables, update channels, and real-device behavior |
| Cross-component | Contract tests, recorded fixtures, and explicit resource-handle substitution | A full graph checks OAuth callbacks, webhooks, R2, hosted auth, and real platform integration end to end |

A full remote staging graph is therefore optional. It can catch provider-specific integration failures and reduce production-only testing, but it also duplicates projects, buckets, secrets, OAuth/webhook configuration, test data policy, drift management, and cost. It becomes justified only when a concrete change cannot be safely verified through the lower-cost mechanisms above. Provisioning or connecting it requires a separate proposal and explicit approval.

## Priority order

| Priority | Gap | Why it comes now | Planned batch |
|---|---|---|---|
| P0 | Deterministic toolchain and verification entry point | Every later batch needs repeatable local and PR checks | [01 Deterministic verification](../_bmad-output/specs/spec-deterministic-verification/SPEC.md) |
| P0 | Fail-closed Worker configuration contract | Missing config currently widens access; tests need Batch 01's harness | [02 Worker config contract](../_bmad-output/specs/spec-worker-config-contract/SPEC.md) |
| P0 | Migration and admin-task change control | Schema drift and manual ordering make later release automation unsafe | [03 Supabase change control](../_bmad-output/specs/spec-supabase-change-control/SPEC.md) |
| P1 | Per-deploy config and attached-resource handles | Release records need authoritative configuration identity before they can be deterministic | [04 Deploy config and resources](../_bmad-output/specs/spec-deploy-config-resources/SPEC.md) |
| P1 | Immutable release provenance and preflight | Consumes the configuration contract and ties platform releases to reviewed source | [05 Release provenance](../_bmad-output/specs/spec-release-provenance/SPEC.md) |
| P2 | Runtime, logging, parity, and applicability hardening | Mostly documentation/platform mapping; code changes follow observed need | [06 Runtime operations](../_bmad-output/specs/spec-runtime-operations/SPEC.md) |

## Factor-by-factor result

### I. Codebase — partial, with an intentional monorepo exception

Evidence:

- Git is the single revision-control source for all GraveStory components.
- The repository contains independently released web, mobile, Worker, and local-tool units.
- Production, preview, and developer releases are revisions of this repository, but they do not share one synchronized deployment cadence.

The manifesto's strict one-codebase-to-one-app definition does not map cleanly to this product monorepo. Splitting the repository would make coordinated security, API, schema, and client changes harder and is not justified by a current operational problem.

Decision: keep the monorepo and apply factors II–XII independently to each deployable unit. Record component ownership, release IDs, and configuration contracts so a commit can identify exactly which units changed. Do not treat shared product code as proof that all units form one runtime process.

### II. Dependencies — partial; foundational gap

Evidence:

- `mobile/package-lock.json` and `tools/metrics-digest/package-lock.json` are lockfile-v3 inputs; `npm ci` can reproduce their resolved graphs even though the manifests use compatible ranges.
- Neither package declares a supported Node runtime or `packageManager`, so the same lockfile can still execute under an unintended runtime or package-manager release.
- `mobile/eas.json` allows any EAS CLI version at or above 16.
- The Worker has no `package.json` or lockfile and deployment instructions rely on ambient `npx wrangler`.
- The repository has no Node runtime pin.
- The static web loads Leaflet 1.9.4 exactly, but loads Supabase from the floating CDN selector `@2`.
- BMad scripts depend on Python 3.11+ and `uv`; that contract is documented in the tooling but not verified repository-wide.

Required outcome: pin supported runtimes and command-line dependencies, require lockfile installs where a package manager exists, pin browser CDN assets exactly, and add one safe verification entry point. Do not rewrite application dependency ranges merely because a lockfile exists. Preserve the explicit rule that the static web application gains no framework, bundler, TypeScript, or npm runtime.

The mobile package currently declares Expo SDK 54 while `mobile/AGENTS.md` requires exact Expo v56 documentation before any mobile code. That is an instruction/version mismatch to reconcile before editing mobile configuration; it is not permission to upgrade Expo.

### III. Config — partial; security-critical gap

Evidence:

- Repository configuration and comments require true Worker credentials to use Wrangler secrets, and the EAS build reads sensitive values from environment variables; remote secret presence was not inspected.
- `worker/wrangler.toml` commits deploy-specific origins and resource URLs.
- Web and mobile commit the Worker URL, client key, Supabase URL, and public Supabase anon key in separate files.
- The public anon key and client key are shipped to clients by design; they must not be documented as confidential credentials.
- `worker/worker.js` uses `env.ALLOWED_ORIGIN || '*'`. An absent value therefore selects the least restrictive behavior.
- Some code flags are product behavior shared across deploys; those are internal application configuration and need not become environment variables.

Required outcome: define granular required/optional values for each unit, fail closed for missing security controls, validate release configuration without printing values, and centralize deploy-varying public handles at the boundary of each unit.

Implementation status (2026-07-16): `deploy/config/contract.json`, the component attestations, and `tools/deploy-config.mjs` now validate the public, secret-name, and binding contract without printing supplied values. Static web resolves one versioned no-build boundary; Expo resolves public substitutions through `app.config.js`/`extra`; Worker, database, and metrics inputs remain environment/binding injected. Remote presence is explicitly unverified rather than inferred.

### IV. Backing services — partial

Evidence:

- The Worker accesses Supabase through `env.SUPABASE_URL`, R2 through the `IMAGES` binding, and its public bucket through `env.R2_PUBLIC_URL`.
- Mobile and web Supabase/Worker handles are hardcoded in client source, so swapping a project or endpoint requires a code change.
- Worker attachments include Supabase, R2, Gemini, Tavily, WikiTree, Overpass, RevenueCat webhooks and management APIs, and Google BigQuery/OAuth for billing metrics.
- Client attachments include the Worker, Supabase, RevenueCat, the Google Maps build key, Wikidata SPARQL, Chronicling America, Wikipedia/Wikimedia, Internet Archive, Nominatim, Photon, OpenStreetMap tiles, and pinned browser libraries.
- The local metrics digest attaches to Supabase with a service-role credential and currently carries a default project URL in code.
- Stable provider API paths are application code; per-deploy credentials, project/bucket identifiers, and replaceable resource locators are configuration.

Required outcome: document every attached resource, its locator source, credential class, owner, and validation rule. Make deploy-specific handles replaceable through that unit's release configuration while retaining public-by-design identifiers in distributable artifacts.

Implementation status (2026-07-16): `docs/deploy-configuration.md` inventories each attachment and `deploy/config/compatibility.json` preserves locators for cached web and installed mobile generations. Retirement requires allowed evidence plus owner approval; repository checks fail when a required legacy browser origin or supported-generation locator is dropped.

### V. Build, release, run — partial; major operational gap

Evidence:

- EAS Build, EAS Update, Cloudflare Pages, and Cloudflare Workers create immutable platform releases and support rollback.
- The Pages runbook records an allowlisted 22-file staging bundle.
- The current cutover runbook records an EAS runtime, update group, update ID, reviewed commit, and previous group.
- Worker, web, mobile, and database operations are manually coordinated. There is no common append-only release manifest.
- A Worker deploy can combine current local source with remote Wrangler secrets, and a manual SQL migration can change runtime behavior without a repository-recorded release link.

Required outcome: add non-deploying preflight tooling and a two-phase append-only record. Preflight emits an immutable candidate tied to reviewed source, configuration identity, migration state, and current rollback baseline. After an explicitly approved release, finalization writes a new immutable record referencing the candidate and the returned platform or database execution evidence; it never edits the candidate. Run remains platform-managed.

Implementation status (2026-07-15): repository-local provenance tooling, component genesis metadata, canonical record hashes, serialized execution-intent leases, baseline revalidation, and immutable final/abandon records are implemented in `tools/release-control.mjs`, `release/baselines.json`, and `docs/release-provenance.md`. No platform action is invoked. Ordinary Pages and Worker eligibility remains blocked because their preceding rollback releases are not recorded; database eligibility remains blocked on unverified live state and the missing pre-001 baseline. Candidate configuration authority also remains fail-closed until Batch 04 supplies the deploy-config contract rather than accepting ad-hoc identity.

### VI. Processes — compliant for server execution; client exception documented

Evidence:

- The Cloudflare Worker stores durable data in Supabase/R2 and does not rely on local filesystem or cross-request memory.
- Static Pages has no server process.
- Mobile intentionally persists authentication, stories, sync state, portraits, exports, and pending scans on the device.

The stateless-process rule applies to horizontally replaceable server processes, not to a user's installed offline-capable client. Mobile persistence is product state and must remain user-scoped, retry-safe, and recoverable. It is not a Twelve-Factor defect.

### VII. Port binding — platform-managed, not directly applicable

Cloudflare Worker handlers and Pages assets are exposed by Cloudflare's runtime; Expo is a native client. None of these units owns a long-running HTTP server or binds a configurable port. Local development servers may bind ports, but they are development tooling rather than the production application contract.

No custom server wrapper should be introduced merely to imitate this factor.

### VIII. Concurrency — platform-managed, currently applicable only as design discipline

Cloudflare schedules concurrent Worker invocations. Mobile performs bounded asynchronous request fan-out inside one client process. GraveStory has no independently scalable web/worker process types, queues, or scheduled jobs.

Required outcome: document those boundaries and keep handlers stateless/idempotent. Add a separate process type only when an actual workload requires independent scaling.

### IX. Disposability — partial

Evidence:

- Worker requests start on demand and do not need a warm local state.
- Paid-scan reservations and RevenueCat event handling have expiration/idempotency mechanisms in repository migrations and Worker code.
- Mobile sync and pending-scan paths persist retryable state across interruption.
- Mobile has explicit timeouts on several expensive calls, but many Worker upstream `fetch` calls have no abort signal or application deadline.

Required outcome: verify configuration failure is immediate, bound Worker upstream calls, test duplicate delivery on mutating routes, document retry/idempotency boundaries, and keep shutdown/startup responsibility with Cloudflare and Expo. Do not add lifecycle machinery with no persistent server process to manage.

### X. Dev/prod parity — partial; major data-layer gap

Evidence:

- There is no standard Supabase CLI project or reproducible local database bootstrap.
- Migration files are ordered SQL plus special `VERIFY` and `_RETRIEVE` scripts, with a missing migration number 027 and historical documentation that no longer describes the full set.
- Operators apply changes manually in the Supabase SQL editor.
- EAS defines `development`, `preview`, `phase9`, and `production` profiles; non-production profiles can lack values available only in the production environment.
- There is no equivalent checked preview configuration for the production Worker resource graph.

Required outcome: validate repository migration history, document parity claims honestly, and provide safe local/CI checks. Prefer configuration substitution, fixtures, local/runtime emulation, and existing preview profiles. A new remote Supabase/Cloudflare/EAS graph is optional, not a compliance requirement, and remains an explicit external-state decision.

### XI. Logs — partial

Evidence:

- Worker failures use `console.warn` and `console.error`, which Cloudflare captures as event streams.
- The Worker does not write log files or manage log routing.
- Existing records include identifiers and truncated upstream details; there is no repository-wide structured-field/redaction contract.
- Mobile console output is client diagnostics, not a central server event stream.
- The local metrics digest deliberately prints its result to stdout.

Required outcome: inventory both existing and future Worker events, define bounded event names and allowed fields, prevent secrets and sensitive payloads from being logged, and document Cloudflare tail/query procedures. Log draining, retention, and third-party observability remain platform/owner decisions.

### XII. Admin processes — partial; major operational gap

Evidence:

- Migrations and tester/admin SQL are run manually in the Supabase editor.
- `tools/metrics-digest` is version-controlled, uses the same Supabase API, and reads its service-role credential from local environment.
- Verification and retrieval SQL files are mixed into the migration directory.
- One-off tasks are not uniformly tied to a reviewed release, configuration contract, safety class, or audit record.

Required outcome: create a checked task catalog and migration ledger, reject uncataloged SQL/task entrypoints, require explicit environment selection and confirmation instead of an implicit production target, and separate read-only verification from mutation. Live execution always requires the existing production approval gates.

## Verification and publishing contract

Every code-change batch must:

1. Start from the freshly synced `origin/main` in an isolated clean branch.
2. Implement only its linked BMad spec and preserve unrelated work.
3. Run relevant automated tests, static checks, and safe operational dry runs.
4. Run the actual `bmad-code-review` workflow: Blind Hunter and Edge Case Hunter always, plus Acceptance Auditor whenever a spec/story is supplied.
5. Fix findings or record evidence-backed triage before commit.
6. Re-run verification against the final staged diff.
7. Commit, push, open a PR, verify remote checks, merge, fetch the resulting main commit, and only then start the next branch.

Documentation-only batches still receive preservation and link checks. They do not pretend to be code-review runs.

The final runtime-operations batch also rewrites this baseline into a terminal reconciliation: each original gap must be marked implemented, compliant, platform-managed, approval-blocked, or explicitly deferred with rationale.

## Approval boundaries

The following are explicitly outside ungated repository implementation:

- production web, Worker, mobile build, or OTA deployment;
- live Supabase query or mutation, including migration application;
- secret creation, rotation, copying, or remote presence checks that reveal values;
- EAS, Cloudflare, Supabase, RevenueCat, Play Console, or GitHub Pages production-setting changes;
- destructive Git operations, hard deletion of story data, legacy-site retirement, or allowlist contraction.

Repository code, tests, dry-run tooling, documentation, branches, commits, PRs, and merges remain ungated when they do not cross those boundaries.

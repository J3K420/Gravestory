# GraveStory runtime operations contract

Status: repository-enforced operational contract

This document maps Twelve-Factor factors VI–XI to GraveStory's actual platforms. It does not create a server, queue, scheduler, staging stack, or log vendor. Cloudflare, Expo, the browser, and the operator retain the lifecycle responsibilities they already own.

## Process, port, concurrency, and disposal ownership

| Component | Startup and process owner | Port exposure | Concurrency owner | Disposal and persistent state |
|---|---|---|---|---|
| Cloudflare Pages | Cloudflare serves an immutable Direct Upload bundle; GraveStory has no server process | Cloudflare HTTPS edge | Cloudflare | A new upload replaces the served release. Pages keeps no GraveStory process state; browser and Supabase state are separate attachments. |
| Web service worker | The browser starts `sw.js` for install, activate, and fetch events | None; it intercepts the current origin | Browser event scheduler | Activation removes old application caches while retaining the separately versioned tile cache. Every deployed web-asset change advances `CACHE`. |
| Cloudflare Worker | Cloudflare starts request-isolated invocations of `worker/worker.js` | Cloudflare HTTPS edge; no application-owned port | Cloudflare scales request invocations | No cross-request memory or filesystem is authoritative. Durable state is Supabase or R2. Each upstream operation has the deadline enforced by `worker/runtime.js`. |
| Expo client | Android/iOS starts the installed application; Metro starts only development sessions | Native client, no inbound production port | One user-device process with bounded asynchronous fan-out | Authentication, user-scoped stories, sync watermarks, portraits, and pending scan photos are intentional product state. The OS may suspend or kill the process at any time. |
| Local completion notification | Expo Notifications schedules a local, immediate device notification after a backgrounded scan finishes | Native OS notification surface | Mobile OS | The matching story reference is process-memory only, consumed on one matching tap, and lost on cold kill. A cold/stale tap routes to Home instead of the wrong story. No push token or server process exists. |
| Metrics digest and administrative tools | An operator starts a version-controlled Node one-off command | None | One invocation; operators serialize production work through the documented approval | Results go to stdout. The process exits after its read or reviewed task and keeps no daemon state. |
| Local Supabase scaffold | The pinned Supabase CLI and local Docker context own disposable services after prerequisites are complete | Supabase CLI local ports only | Local container runtime | Replacement is permitted only with `--target local --confirm disposable-local`. The missing pre-001 `public.stories` baseline currently prevents startup and any parity claim. |

Factors VI–VIII are therefore compliant or platform-managed: server work is stateless, exposure and scaling belong to the platform, and no independent workload currently justifies another process type. User-device persistence is deliberately outside the replaceable-server-process rule.

## Worker deadlines

`worker/runtime.js` is the only network/binding deadline authority. `worker/tests/runtime.test.mjs` scans every Worker JavaScript module extension, rejects direct/aliased/bracketed `fetch` and `console` access, and structurally requires every R2 binding call to sit inside a reviewed deadline helper.

| Deadline class | Limit | Covered operations |
|---|---:|---|
| `supabase` | 15 s | Auth, reservation/budget RPCs, REST, webhook ledger/RPC, account deletion, admin reporting |
| `generativeAi` | 35 s | Gemini generation proxy |
| `searchProvider` | 20 s | Tavily search/extract and WikiTree |
| `overpassMirror` | 12 s per mirror | Each of the three ordered Overpass mirrors |
| `adminProvider` | 20 s | RevenueCat, BigQuery, and Google OAuth token exchange |
| `r2Binding` | 15 s | One R2 put or the complete best-effort account-cleanup delete batch; the batch stops scheduling objects after its first deadline |

Fetch deadlines cover header arrival and incremental response-body consumption, then abort the provider request. A 16 MiB maximum is enforced while chunks arrive, before the final response buffer is allocated; an oversized upstream becomes a structured, redacted 502 instead of an unbounded allocation. R2 bindings do not expose an abort signal, so the helper bounds how long the Worker waits; the platform may finish or terminate the underlying binding operation. An unrecovered route deadline produces a structured event and an HTTP 504 at the route boundary. The read-only admin dashboard is the explicit exception: each failed fan-out source emits a structured event and becomes a redacted error section while the useful remainder returns 200. Best-effort R2 cleanup during account deletion also emits a correlated warning and proceeds so an orphaned blob cannot strand account deletion. Ordinary route exceptions produce a redacted HTTP 500.

## Duplicate-delivery contract

The machine-readable source is `WORKER_ROUTE_OPERATIONS` in `worker/runtime.js`. “State change” includes metered provider spend and scan-budget consumption, not only database rows.

| Route | State effect | Duplicate-delivery disposition |
|---|---|---|
| `GET /admin/metrics` | Read-only reporting | Replayable read. |
| `POST /begin-scan` | Creates an expiring reservation | Explicit exception: ordinary accounts are bounded because live holds count against allowance, but approval-gated `is_unlimited` tester accounts deliberately bypass that limit. Callers do not automatically replay. |
| `POST /commit-scan` | Commits a reservation and scan event | Side-effect-idempotent: the pending-to-committed transition and scan-event insert occur once. A replay is a no-op reported as `committed:false` because the reservation is no longer pending. |
| `POST /gemini-jwt/:model` | Billable provider work | Explicit exception: a verified, ban-capable user is required, but calls are not reservation-metered and no per-user rate limit exists. Callers do not automatically replay. |
| `POST /gemini/:model` | Billable provider work plus optional budget decrement | Transition exception: `SCAN_TOKEN_ENFORCE=true` atomically consumes finite reservation budget. The explicit false transition mode permits observed legacy calls with a missing/invalid token or unavailable budget store. Callers do not automatically replay. |
| `POST /tavily` and `/tavily-extract` | Billable provider work plus optional budget decrement | Same transition exception and no-automatic-replay rule; enforcement spends the shared finite Tavily reservation budget, while false transition mode may serve an unmetered legacy call. |
| `POST /wikitree` and `/overpass` | Provider reads | Replayable reads; no GraveStory state is written. |
| `POST /upload-image` | Creates an immutable random-key R2 object | Explicit exception: current installed clients issue one non-retrying upload only after Save. A lost response can leave an orphan; automatic retries remain prohibited until an idempotency key is introduced across the installed-client compatibility window. |
| `POST /revenuecat-webhook` | Grants/claws back credits or records an unmapped event | Idempotent by stable RevenueCat `event.id`, the immutable ledger, and grant/clawback RPCs. Transient failures return 5xx for safe provider retry. |
| `POST /delete-account` | Irreversible scoped deletion | Monotonic exception: data deletes can repeat, but after auth-user deletion the same JWT cannot prove the already-completed result. A lost final response is unknown and must be reconciled by sign-in/account state. |

The `/upload-image` exception is deliberate rather than a hidden retry promise. Making it fully idempotent requires a versioned client-to-Worker key contract and an installed-client overlap plan; a Worker-only change would not protect existing clients.

## Structured server event logs

Cloudflare captures `console.warn` and `console.error` as platform event streams. GraveStory emits one JSON object per reviewed event through `emitWorkerLog`; it never writes log files.

| Event | Level | Allowed fields |
|---|---|---|
| `worker_request_failed` | error | `route`, `failure` |
| `scan_reservation_failed` | warn | `status` |
| `scan_commit_failed` | warn | `status` |
| `scan_metering_inert` | error | `route`, `enforce` |
| `scan_token_transition` | warn | `route`, `reason` |
| `scan_budget_transport_failed` | warn | `route`, `bucket`, `status` |
| `scan_budget_would_block` | warn | `route`, `bucket` |
| `webhook_identifiers_missing` | warn | three presence booleans only |
| `webhook_product_unmapped` | warn | `operation` |
| `webhook_record_failed` | warn | `failure`, `correlation` |
| `webhook_permanent_failure` | warn | `operation`, `status`, `correlation` |
| `webhook_transient_failure` | warn | `operation`, `status` |
| `account_cleanup_failed` | warn | `step`, `status`, `failure`, `correlation` |
| `admin_source_failed` | warn | `source`, `failure` |

Exact event and field sets are enforced at runtime and in tests. Enumerated fields accept only reviewed low-cardinality values; anything else becomes `redacted`. A `correlation` is the first 64 bits of a one-way SHA-256 digest of the relevant opaque identifier. It lets an operator match a client-visible failure or provider event without logging the raw identifier. Events do not accept authorization headers, tokens, secrets, keys, URLs, request/response bodies, provider detail text, user IDs, RevenueCat event IDs, product IDs, email addresses, names, biographies, image data, or raw exception messages.

Mobile console messages remain device diagnostics, not the central server event stream. The metrics digest deliberately writes its reviewed aggregate result to stdout. Cloudflare retention, drains, third-party observability, and production tail/query access are external operations and require explicit approval; this batch changes none of them.

## Mobile interruption and retry boundaries

| Work | Owner and persistence | Retry/resume | Expiry | Idempotency or duplicate boundary |
|---|---|---|---|---|
| Offline scan awaiting research | `pending.js` stores the JPEG under device `documentDirectory/pending`; the user-scoped story carries `_pending` and stays out of cloud sync | User selects “Run Research”; success replaces the placeholder and idempotently deletes the pending file | No automatic expiry; preserving unsent user work wins over silent cleanup. User completion/deletion owns removal | Pending stories are keyed by timestamp; the pipeline removes that placeholder after success |
| Cloud story sync | User-scoped AsyncStorage plus `_needsCloudSync`, `updated_at`, and the sync watermark | Focus/sign-in sync retries failed inserts/updates; `_pushInFlight` serializes local pushes | No automatic expiry; soft deletes remain in Supabase for propagation | Existing row IDs update rather than reinsert; timestamp dedupe precedes new inserts; `deleted_at` is monotonic |
| Scan reservation/token | Supabase reservation plus process-memory client token | Paid calls use the current signed token; commit may safely repeat | 10-minute server reservation/token TTL; abandoned pending holds age out | Enforcement gives ordinary accounts finite route budgets; unlimited testers and false transition mode are explicit exceptions. Commit side effects are idempotent by reservation |
| Research fan-out | Mobile process memory | The 30-second fan-out ceiling degrades to stone/free-source evidence; Tavily extract alone has one explicit retry | Results vanish if the OS kills the process unless the user chose the pending-scan path | No blanket automatic POST replay |
| Local completion notification | OS notification plus one process-memory story reference | No delivery retry; tap consumes only a timestamp-matching story | Reference expires on consumption, overwrite, or process death | Stale/cold taps route Home and never open the wrong story |
| Worker/provider calls | Cloudflare request invocation | Clients handle the returned failure according to each route; no transparent Worker replay | Per-call deadlines above | Route-specific catalog above |

## Development and production parity

The exact repository toolchain is Node 22.13.1, npm 10.9.2, Wrangler 4.110.0, EAS CLI 21.0.0, Expo SDK 54, Supabase CLI 2.101.0, and lockfile-v3 dependency graphs. Hosted provider versions and remote configuration are not inferred or inspected.

### EAS profiles and channels

| Profile | Artifact/channel | Configuration difference | Data and attachment policy | Smallest useful check |
|---|---|---|---|---|
| development | Internal development client; no update channel declared | Metro/development-client behavior; production-only injected values can be absent | Use reviewed substituted public locators and non-production data only; do not assume a white map proves app failure when the Maps key is intentionally absent | `expo config`, local Metro, and a development client when native behavior matters |
| preview | Internal Android APK; channel `preview` | APK distribution; production-only Google Maps/RevenueCat values can be absent | No production data copy. A remote attachment requires its own approval and test-data policy | Deterministic Expo export plus an EAS preview build only when native signing/device behavior is the named risk |
| phase9 | Internal Android APK; channel `phase-9` | Isolated update channel used for targeted device work | Same non-production-data rule; locators must be intentionally selected rather than inherited ambiently | Deterministic Expo export, then the existing phase9 build contract for a named device risk |
| production | Android app bundle; channel `production`; submit track `internal` | Production EAS environment supplies approved Maps/RevenueCat values | Production attachments/data; every build, OTA, submit, or setting change is a separate explicit gate | Repository preflight first; EAS build/update only after approval, then installed-app verification |

`mobile/app.config.js` is the authoritative public substitution boundary. A profile name alone does not prove which Worker or Supabase attachment a build uses; the deploy-config attestation and supplied environment do. Existing installed generations remain covered by `deploy/config/compatibility.json`.

### Surface parity matrix

| Surface or attachment | Production type/version evidence | Configuration and data difference | Smallest local/emulated/preview check | Remaining approval-bound gap |
|---|---|---|---|---|
| Static web / Cloudflare Pages | Direct Upload; exact 22-file manifest and cache generation | Local HTTP has no Pages edge configuration; use fixtures/non-production browser state | Serve the allowlisted bundle and exercise service-worker install/update in a browser | Pages edge headers/routing need an approved Cloudflare preview or production check only for that named risk |
| Cloudflare Worker | Modules runtime; pinned Wrangler 4.110.0 | Local test values replace remote vars/secrets/bindings; no production payload copies | Unit/contract tests, `wrangler deploy --dry-run`, optional `wrangler dev` with non-secret fixtures | Real edge policy, bindings, and provider network behavior remain remote |
| Supabase | Hosted version/configuration unverified; stable REST/Auth/RPC paths | Local target uses the same migration catalog but disposable fixture data only | Pinned CLI 2.101.0 ledger validation and guarded disposable-local reset | Authoritative pre-001 `public.stories` schema and live history are missing; validator fails closed before Docker |
| Cloudflare R2 | Worker `IMAGES` binding plus configured public base URL; service version is platform-managed | In-memory binding fake and synthetic bytes; never production images | Contract tests for put/delete deadlines, MIME allowlist, URL/key derivation, and failure behavior | Binding permission and public delivery/CORS require an approved Cloudflare check |
| Gemini | Google Generative Language `v1beta`; allowed model IDs are code-pinned | Fake responses and test key names; no prompts, biographies, or image payloads from production | Worker request/timeout/budget contract tests and mobile fixtures | Model availability, quotas, latency, and response-shape drift require an approved non-production provider call |
| Tavily search/extract | Stable `/search` and `/extract` endpoints; provider version not exposed/pinned | Synthetic result fixtures and explicit test key; no production queries | Request-shape, transition/enforcement, timeout, and mobile degradation tests | Credit accounting and provider-specific relevance/latency need an approved test call |
| WikiTree | Stable `api.php` attachment; provider version unpinned | Synthetic public genealogy response only | Proxy request/timeout and parser fixtures | Live API behavior/rate limits need an approved network check when changed |
| Overpass | Three ordered public interpreter mirrors; server versions unpinned | Synthetic OSM JSON; no user/location data copied | Query-size, mirror fallback, body deadline, and redacted failure tests | Mirror availability/rate policy remains public-network behavior |
| RevenueCat webhook | Versioned provider event envelope plus immutable event ledger/RPCs | Signed synthetic events and fake Supabase responses; no real customer IDs | Secret validation, stable-event dedupe evidence, durable unmapped-record retry, grant/clawback tests | Dashboard delivery, retry cadence, and real product mapping need approved webhook/provider access |
| RevenueCat management API | `v2/projects` and metrics endpoint; version path is pinned | Synthetic administrative aggregates, test project locator, no customer data | Admin section parsing, timeout, and redacted-degradation tests | Project permissions and metric availability require approved RevenueCat access |
| Google Maps native SDK | Expo SDK 54 native dependency; build key injected, remote SDK resolution belongs to EAS/Gradle | Development/preview may intentionally omit the production key; use non-production map locations | `expo config`, deterministic Android export, and approved development client only when map behavior is the risk | Key restrictions, signing fingerprints, billing, and device tiles need approved EAS/Google operations |
| Google BigQuery billing + OAuth | BigQuery REST `v2`, OAuth token endpoint, billing-export table configured by attachment | Synthetic billing rows and placeholder service-account inputs; no spend data copied | JWT construction/import, request-shape, timeout, and redacted admin degradation tests | IAM, export freshness, table schema, and live spend require approved Google Cloud access |
| Wikidata SPARQL | Public query endpoint; service version unpinned | Recorded public-result fixtures; no production account data | Query construction, parser, timeout/degradation tests | Endpoint throttling and current knowledge-graph behavior remain live public-network checks |
| Chronicling America | Public API path; service version unpinned | Recorded public newspaper fixtures | URL/query and parser tests | Coverage and current response drift require a named public-network check |
| Wikipedia / Wikimedia | Public REST/file endpoints; service versions unpinned | Recorded public metadata/image fixtures | URL normalization, attribution, and parser tests | Live media redirects/licensing metadata require a named public-network check |
| Internet Archive | Public advanced-search/metadata APIs; versions unpinned | Recorded public archive fixtures | Query construction and parser/degradation tests | Current indexes, throttling, and item availability remain live checks |
| Nominatim | Public geocoder API; version unpinned | Synthetic coordinates and public-place fixtures; no production location history | Request identification, parser, throttling/degradation tests | Usage-policy and current result quality require a named network check |
| Photon | Public geocoder API; version unpinned | Synthetic coordinates and public-place fixtures | Parser/fallback/degradation tests | Availability and result quality remain live public-network checks |
| OpenStreetMap tiles | Public tile service; version is content/current-map managed | Local browser may use cached or fixture tiles; no production browsing history | URL construction, cache partition/version, and fallback browser tests | Tile policy, headers, and availability remain live public-network checks |
| Leaflet / Turf / Supabase browser CDN | Exact repository-pinned browser artifact versions | Same immutable URLs in local and production bundles; fixture application data | Integrity/version checks plus local static preview | CDN reachability and edge caching are external delivery checks |
| Mobile / Expo and EAS | Expo SDK 54, EAS CLI 21.0.0; Android versionCode 15 owner-confirmed live while source reserves 16 | Profile-specific injected values; development/preview/phase9 use non-production data and intentional locators | Locked install, `expo config`, deterministic export, then the smallest named profile/device check | Signing, native services, production values, store state, and installed OTA behavior require EAS/Play approval |
| Cross-component configuration/release | Versioned deploy-config, compatibility generations, and append-only provenance | Recorded fixtures and substituted public locators; never infer remote secret/resource presence | Contract tests bind source, configuration, migration ledger, and rollback identity | OAuth callbacks, webhooks, remote bindings, and any full staging graph remain explicit proposals |

A complete remote staging graph is optional, not a Twelve-Factor requirement. It is justified only for a named provider-specific failure that the smaller mechanisms cannot prove. Creating or connecting one would also require project/bucket ownership, secrets, OAuth/webhook configuration, test-data retention, drift, cost, and teardown decisions, so it remains a separate approved proposal.

## Operator gates

This contract authorizes repository tests and dry runs only. Production deployment, Cloudflare log access, EAS build/update/submit, Supabase live reads or writes, secret checks, OAuth/webhook changes, data copies, retention changes, and observability integrations remain explicit external-state gates. See `docs/release-provenance.md`, `docs/deploy-configuration.md`, and `docs/database-change-control.md`.

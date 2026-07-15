---
id: SPEC-supabase-change-control
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for this batch.

# Supabase migration and admin-task change control

## Why

Manually applied SQL and mixed-purpose scripts make migration order, schema parity, and one-off operational safety impossible to verify reliably from a clean checkout.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can validate the repository's intended migration sequence and distinguish migrations from verification or retrieval scripts.
  - **success:** A deterministic validator rejects duplicate or malformed identifiers, unexplained ordering gaps, and unclassified SQL artifacts.
- **CAP-2**
  - **intent:** Operators can understand prerequisites, verification, and recovery posture before applying a database change.
  - **success:** A versioned ledger and runbook describe each current migration, its order, validation path, and rollback or forward-fix rule.
- **CAP-3**
  - **intent:** Maintainers can run one-off database and metrics tasks from reviewed code with explicit safety boundaries.
  - **success:** The task catalog covers every repository SQL artifact and operational entrypoint, records environment inputs, read/write classification, release relationship, and required approval, and validation rejects uncataloged tasks.
- **CAP-4**
  - **intent:** Operators can select a task target without ambient production defaults.
  - **success:** One-off tooling requires explicit target selection and confirmation and does not silently choose the production Supabase project.
- **CAP-5**
  - **intent:** Maintainers can execute schema changes against disposable local Supabase semantics before any remote database.
  - **success:** Version-pinned local Supabase applies the reproducible migration/bootstrap set and exercises Auth, PostgREST, and RLS behavior; missing bootstrap prerequisites remain explicitly unresolved and prevent a parity claim.

## Constraints

- Do not connect to, inspect, or mutate the live Supabase project.
- Depend on deterministic verification and version-pinned local Supabase tooling.
- Plain PostgreSQL may support limited syntax checks but is not accepted as equivalent for Supabase Auth, PostgREST, or RLS behavior.
- Preserve every existing numbered migration byte-for-byte by default; corrections use a new forward migration because live applied state is not inspected.
- Retain soft-delete requirements and service-role isolation.

## Non-goals

- Automatically applying production migrations or asserting live-schema parity without approved remote verification.

## Success signal

A clean local run validates the full SQL inventory and an operator can identify exact order and safety class without opening the production dashboard.

## Review Findings

- [x] [Review][Patch] Classify the legacy `026_VERIFY_live.sql` exercise as write-capable, superseded, and not runnable.
- [x] [Review][Patch] Classify the legacy retrieval helper as a schema-writing historical reference, not a read-only task.
- [x] [Review][Patch] Preserve and validate exact SQL bytes portably across Windows and Ubuntu checkouts.
- [x] [Review][Patch] Enforce repository-wide SQL discovery, write detection, controlled metadata values, environment-input profiles, and source-marked operational-task discovery.
- [x] [Review][Patch] Separate local and production metrics URL/credential names so privileged keys cannot cross targets.
- [x] [Review][Patch] Reject duplicate target and confirmation flags.
- [x] [Review][Patch] Bound the metrics window to a finite whole-hour range.
- [x] [Review][Patch] Reject inconsistent bootstrap-ready metadata.
- [x] [Review][Patch] Validate operational entrypoints as safe repository files.
- [x] [Review][Patch] Strip cloud secrets and remote Docker selection from local child-process environments.
- [x] [Review][Patch] Complete all local prerequisites before generating disposable migrations.
- [x] [Review][Patch] Invoke the pinned CLI without a command shell and apply command timeouts.
- [x] [Review][Patch] Update scheduler documentation to include an explicit safe target and confirmation.
- [x] [Review][Patch] Preserve visible SQL Editor results while enforcing session/current-transaction read-only mode and an approved function allowlist.
- [x] [Review][Patch] Replace prose-only tester elevation with an idempotent, target-allowlisted, approval-referenced Auth Admin command and tests.
- [x] [Review][Patch] Require structured, fingerprinted baseline and smoke-test evidence before bootstrap readiness.
- [x] [Review][Patch] Enforce operational entrypoint enums and target/access/approval/confirmation cross-field rules.
- [x] [Review][Patch] Constrain local Docker named-pipe endpoints to the local host and fingerprint the reviewed smoke test.
- [x] [Review][Patch] Serialize local resets with tokenized locks; diagnose aged dead-process locks but require manual removal to avoid concurrent-reclaimer races.
- [x] [Review][Patch] Reject quoted or unapproved SQL function calls in cataloged read scripts.
- [x] [Review][Patch] Make tester updates concurrency-safe with field-only patches, matching-user checks, independent readback, and request timeouts.
- [x] [Review][Patch] Reject dollar-bearing, quoted, and non-ASCII callable identifiers unless completely approved.
- [x] [Review][Patch] Fail closed on stale local-reset locks instead of racing automatic reclaimers.
- [x] [Review][Patch] Reconcile timed-out tester writes and explicitly report an unknown outcome when verification is unavailable.

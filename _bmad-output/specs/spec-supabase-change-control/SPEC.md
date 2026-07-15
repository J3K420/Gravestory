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

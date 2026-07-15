---
id: SPEC-deterministic-verification
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for this batch.

# Deterministic dependency and verification foundation

## Why

Later hardening cannot be trusted until a clean checkout selects supported tools, installs declared dependencies reproducibly, and runs the same safe checks locally and on pull requests.

## Capabilities

- **CAP-1**
  - **intent:** A maintainer can reproduce each managed dependency set from version-controlled manifests and runtime requirements.
  - **success:** Clean-install verification uses lockfiles and pinned supported tool versions without ambient project dependencies.
- **CAP-2**
  - **intent:** A maintainer can run one documented, non-production repository verification entry point.
  - **success:** The command checks current web, mobile, Worker, SQL, and tooling invariants without production credentials or mutations.
- **CAP-3**
  - **intent:** Pull requests can report changes that fail the safe verification baseline before merge.
  - **success:** GitHub Actions runs the documented entry point on supported clean runners, and the documented agent/operator publishing procedure verifies that result and stops on failure; this is a procedural gate until branch protection is separately approved.

## Constraints

- Keep the static web application free of frameworks, bundlers, TypeScript, npm runtime code, and generated application bundles.
- Depend on the merged BMad upgrade and Twelve-Factor audit contracts.
- Do not upgrade application dependencies solely to establish this foundation.
- Follow mobile repository instructions and exact Expo documentation before changing mobile configuration.
- Record that the installed app declares Expo SDK 54 while scoped instructions require v56 documentation; reconcile the mismatch before a mobile configuration edit and do not infer an SDK upgrade.
- Treat existing npm lockfiles plus `npm ci` as deterministic dependency resolution; do not rewrite compatible ranges without a separate dependency reason.

## Non-goals

- Deploying any component, building an EAS artifact, publishing an OTA, or connecting to a live database.

## Success signal

The same documented clean-checkout verification passes locally and in the pull request with all tool and dependency inputs declared.

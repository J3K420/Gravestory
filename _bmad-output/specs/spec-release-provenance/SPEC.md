---
id: SPEC-release-provenance
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC and its companions are the complete, preservation-validated contract for this batch.

# Immutable release provenance

## Why

GraveStory's platforms generate release identifiers, but operators lack one immutable record that ties component releases, configuration, migrations, verification, and rollback targets to the reviewed source commit.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can identify the reviewed source and platform release for each deployed component.
  - **success:** An immutable candidate records reviewed source, component, build/configuration identity, migration range, current release baseline, and timestamp; a separate immutable final record later references that candidate and approved platform or database execution evidence without storing secrets.
- **CAP-2**
  - **intent:** Operators can prove a source tree is eligible for release without deploying it.
  - **success:** Non-deploying preflight rejects dirty source, absent review evidence bound to the exact candidate SHA, wrong channel, wrong allowlist, inconsistent inputs, or cached-web-asset changes without a service-worker cache increment; immediately before an approved external command, baseline revalidation refuses stale candidates.
- **CAP-3**
  - **intent:** Operators can select a known immutable rollback target.
  - **success:** Runbooks record the preceding valid release and component-specific rollback constraints; database-only releases use migration IDs, checksums, and execution evidence instead of a fake platform ID.
- **CAP-4**
  - **intent:** Operators can serialize component releases and preserve evidence for every execution that starts.
  - **success:** Before an external command, an append-only execution-intent lease on current `origin/main` names one candidate and component; baseline revalidation permits only that lease to execute. An orphan can be abandoned only with evidence that execution never began; otherwise it is finalized from execution evidence or remains blocked pending explicit owner decision, never overlapped.
- **CAP-5**
  - **intent:** Maintainers can detect mutation or deletion of release history.
  - **success:** Stable record and execution IDs, canonical content hashes, Git-blob migration checksums, and history validation reject edits or deletion of previously committed intent/candidate/final records; finalization retries are idempotent by execution ID.

## Constraints

- Preserve the Pages 22-file allowlist, EAS channel/runtime rules, migration ordering, and current legacy-origin retirement gates.
- Depend on the deploy-configuration and Supabase change-control outputs.
- Preflight tooling must not publish or mutate a platform release.
- Review evidence is explicit input: reviewed commit plus PR identity or equivalent versioned attestation and the completed BMad review record.
- Review evidence is structurally or cryptographically bound to the exact candidate source SHA.
- Migration state must identify its basis as repository-intended or remotely verified; unverified live state cannot be claimed compatible.
- The first component record requires an explicit genesis baseline from repository evidence or an approval-bound platform observation; unknown rollback state blocks ordinary eligibility unless the owner accepts a no-known-rollback genesis.
- Finalization appends a new record after an approved external action and is idempotent by execution ID; it never edits the candidate or invokes the action. Concurrent conflict is recorded and not promoted as current.

## Non-goals

- Replacing EAS, Cloudflare, Supabase, RevenueCat, Play Console, or their release histories.

## Success signal

A dry run produces a complete candidate release record from a verified clean commit and refuses unsafe or ambiguous inputs before any production command.

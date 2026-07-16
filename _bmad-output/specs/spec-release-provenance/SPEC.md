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

## Implementation boundary

- Repository-local records and preflight never invoke a platform or database command.
- The known mobile Android OTA baseline includes a preceding rollback group from repository evidence.
- Pages and Worker ordinary eligibility remains blocked until a preceding release is approval-bound or the owner explicitly accepts a no-known-rollback genesis.
- Database eligibility remains blocked on unverified live migration state and the unresolved pre-001 `public.stories` bootstrap.
- Configuration identity remains blocked without the authoritative output of the dependency-ordered deploy-config/resources batch.

## Review Findings

- [x] [Review][Patch] Enforce the exact Pages allowlist, asset-bound cache increment, and mobile production channel/runtime contract during candidate creation.
- [x] [Review][Patch] Treat external/self-declared configuration attestations as unverified; bind authority only to an exact source-commit Git blob under the reserved deploy-config boundary.
- [x] [Review][Patch] Record every migration ID with its catalog SHA-256 and Git blob; support database execution evidence without a fake platform ID.
- [x] [Review][Patch] Make finalization retries idempotent for identical evidence and reject conflicting retry evidence.
- [x] [Review][Patch] Preserve and schema-validate never-started abandonment evidence in the immutable record.
- [x] [Review][Patch] Field-allowlist final evidence, require approval/evidence references, bind it to the execution ID, and reject extra fields.
- [x] [Review][Patch] Hash the complete baseline, derive the next current baseline from successful final evidence, and keep failed/conflicting outcomes from promotion.
- [x] [Review][Patch] Recompute eligibility during repository validation and reject duplicate intent IDs, cross-component references, and impossible chronology.
- [x] [Review][Patch] Refresh `origin/main`, require source ancestry, and compare current component build identity during intent/revalidation.
- [x] [Review][Patch] Bind build identity to every tracked component input and bind every candidate to the current repository migration ledger.
- [x] [Review][Patch] Evaluate the exported Expo runtime policy, preserve both approved Worker origins, and reject unsafe Pages cache integers.
- [x] [Review][Patch] Bind the BMad result to its source-commit Git blob and revalidate the current authoritative deploy-config blob.
- [x] [Review][Patch] Allow evidence-only failures without invented release IDs; keep unknown/conflicting outcomes leased pending reconciliation.
- [x] [Review][Patch] Bind database completion to the exact candidate migration ledger and verify catalog checksums from migration bytes.
- [x] [Review][Patch] Reject unapproved fields throughout immutable records and enforce canonical timestamps plus intent/outcome chronology.
- [x] [Review][Patch] Keep pre-execution revalidation separate from finalization so a started execution's evidence remains recordable if main changes during the provider action.
- [x] [Review][Patch] Permit a merged intent by requiring its captured main SHA to be an ancestor of refreshed current `origin/main`, not equal to the post-merge SHA.
- [x] [Review][Patch] Replay leases chronologically so later terminal records cannot hide historical overlap or promote a stale candidate.
- [x] [Review][Patch] Recompute build and migration identities from an archived reviewed Git tree, independent of checkout line endings.
- [x] [Review][Patch] Parse the source-bound BMad artifact for a completed Review Findings section and make persisted review hashes recomputable.
- [x] [Review][Patch] Content-hash and history-protect the immutable genesis baseline trust root.
- [x] [Review][Patch] Represent owner-approved no-known-rollback genesis as a separate approval/evidence-bound append-only record.
- [x] [Review][Patch] Require authoritative configuration to pass the versioned deploy-config verifier, not merely occupy a reserved pathname.
- [x] [Review][Patch] Require release record filenames to equal their immutable record IDs.
- [x] [Review][Patch] Refresh the remote-tracking main ref with an explicit fetch refspec.
- [x] [Review][Patch] Add owner-decision reconciliation for unknown/conflicting executions while preserving the original outcome.
- [x] [Review][Patch] Reject successful outcomes that reuse the rollback release identity.
- [x] [Review][Patch] Require strictly increasing candidate, intent, outcome, and reconciliation timestamps.
- [x] [Review][Patch] Restrict persisted record/execution IDs to cross-platform filename-safe characters.
- [x] [Review][Patch] Reuse the authoritative database-control validator so release preflight rejects malformed migration ordering and metadata.
- [x] [Review][Patch] Reject successful outcomes that reuse either the current release or its known rollback release.
- [x] [Review][Patch] Inspect immutable history against every merge parent so merge-only record deletion cannot disappear.
- [x] [Review][Patch] Apply CLI-equivalent scalar/reference validation to hand-authored final and reconciliation records.
- [x] [Review][Patch] Apply CLI-equivalent operator, approval, and reason validation to hand-authored abandonment records.
- [x] [Review][Patch] Replay canonical timestamps by parsed instant rather than mixed-precision lexical order.
- [x] [Review][Patch] Bound execution IDs so prefixed record IDs remain valid after the CLI writes them.
- [x] [Review][Patch] Replace descendant-reusable review artifacts with a post-review receipt that binds the exact earlier source SHA, PR, review ID, review commit, and completed artifact blob.
- [x] [Review][Patch] Restrict configuration remote-presence evidence to the explicit `unverified`/`attested` scalar enum.

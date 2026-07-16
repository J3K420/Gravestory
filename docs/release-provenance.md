# Release provenance and preflight

GraveStory records release eligibility and execution evidence in Git without deploying from the provenance tool. `tools/release-control.mjs` reads repository state, validates append-only records, and writes a record only when `--write` is supplied. It never invokes Wrangler, EAS, Supabase, Cloudflare Pages, Play Console, or another external platform.

This is an append-only release control, not a deployment system:

1. A **candidate** binds one reviewed source commit to one component, build inputs, configuration identity, repository migration identity, the current release baseline, and rollback metadata.
2. After that candidate is merged, an **execution intent** on the then-current `origin/main` acquires the component lease. A separate merge makes that lease authoritative.
3. Immediately before an explicitly approved external command, **revalidation** proves the worktree and `origin/main` still match the lease. Revalidation does not run the command.
4. An execution that started receives one immutable **final** record from returned platform/database evidence. An intent may instead receive one **abandon** record only when an operator attests that execution never began.
5. A final `unknown` or `conflict` keeps the lease blocked. A later approval-bound **reconcile** record can close it as `success` or `failed` without rewriting the original uncertainty.

Every JSON record has a length-bounded, cross-platform filename-safe stable ID and a SHA-256 `contentHash` over canonical key-sorted JSON, and its filename must equal its `recordId`. Repository validation chronologically replays the ledger by parsed timestamp and rejects record edits, deletion, rename, duplicate IDs, historical lease overlap, conflicting outcomes, broken references, impossible chronology, nested/non-scalar references, forged eligibility, and stale baselines. A successful final or reconciliation becomes the next current baseline; failed outcomes close without promotion, while conflict/unknown outcomes stay blocked. GitHub Actions checks full history (`fetch-depth: 0`) on Windows and Ubuntu and checks every merge parent so an older record or the genesis baseline cannot be rewritten or merge-dropped unnoticed.

## Components and genesis state

[`release/baselines.json`](../release/baselines.json) is the current repository-evidence catalog. It does not claim a fresh platform inspection.

| Component | Repository-recorded current release | Rollback status | Ordinary eligibility |
|---|---|---|---|
| Pages | `62c7fbe9.gravestory.pages.dev` | Previous deployment not recorded | Blocked until an approval-bound observation records a rollback target or the owner explicitly accepts a no-known-rollback genesis |
| Worker | `4a01f4da-8cd9-48de-9478-f65ad47b3f8f` | Previous version not recorded | Blocked on the same genesis decision |
| Mobile Android OTA | `a405b5dc-2f30-4cc8-983d-855bce3a0673`, production, `exposdk:54.0.0` | Previous group `e713a050-d620-4bd0-aaf7-9c0a486f86c0` | Baseline is usable |
| Database | No verified live migration state | Unknown; forward-fix policy only | Blocked on approved live-state reconciliation and the missing pre-001 `public.stories` baseline |

`release/baselines.json` is a content-hashed immutable genesis trust root. Current baselines are derived by replaying append-only records; do not edit the genesis file. Never infer a release ID or live migration state from client behavior.

Pages or Worker may become eligible without a known initial rollback only after the owner explicitly accepts that recovery limitation. Record the approval without deploying anything:

```powershell
node tools/release-control.mjs accept-genesis `
  --component pages `
  --created-at 2026-07-15T11:00:00Z `
  --owner-approval-ref owner-decision-123 `
  --evidence-ref reviewed-risk-record-123
```

Inspect the dry run, then repeat with `--write` and merge the append-only record. This command represents the SPEC-permitted decision; it never makes that decision on the owner's behalf.

## Candidate evidence

Candidate creation requires two non-secret JSON inputs. They may be stored outside the repository while the candidate is generated; their meaningful fields are copied into the immutable record.

Review evidence:

```json
{
  "sourceCommit": "<40-character-reviewed-commit>",
  "reviewCommit": "<later-commit-containing-the-receipt>",
  "recordPath": "_bmad-output/implementation-artifacts/review-receipts/<review-id>.json"
}
```

The committed receipt at `recordPath` is machine-readable and contains:

```json
{
  "schemaVersion": 1,
  "kind": "bmad-code-review-receipt",
  "sourceCommit": "<exact-reviewed-source-commit>",
  "reviewId": "<completed-bmad-review-id>",
  "pr": "J3K420/Gravestory#<number>",
  "bmad": "passed",
  "completedAt": "2026-07-15T11:30:00Z",
  "findingsResolved": true,
  "artifactPath": "_bmad-output/specs/<reviewed-spec>/SPEC.md",
  "artifactBlob": "<Git-blob-of-the-completed-review-artifact>"
}
```

Configuration attestation (future Batch 04 output):

```json
{
  "component": "mobile",
  "identity": "<deterministic-config-identity>",
  "authority": "deploy-config-contract",
  "validation": "passed",
  "remotePresence": "attested"
}
```

An authoritative committed attestation does not contain its own commit SHA. The release tool derives `sourceCommit` from the Git object that contains it; external unverified evidence must still supply the source field explicitly.

The source commit is the exact reviewed code. After review completes, a later receipt-only commit records that source SHA and the completed BMad artifact's Git blob; this avoids an impossible self-referential commit hash and prevents reusing an old review for changed descendant code. The tool verifies source → review commit → current HEAD ancestry, receipt fields, PR/review identity, and a Review Findings section with checked findings and no open review item. Configuration authority is also deliberately fail-closed. The candidate command does not trust the JSON's self-declared `authority` field or its pathname alone. Only an attestation committed at the candidate source under `deploy/config/` and accepted by that source revision's `tools/deploy-config.mjs verify-attestation` command is recorded as authoritative. An external, other-path, or unverifiable JSON is blocked. `remotePresence` is restricted to `unverified` or `attested`; repository-only checks use `unverified` unless a separate approved/versioned platform attestation exists.

From the exact reviewed commit in a clean isolated worktree:

```powershell
node tools/release-control.mjs validate
node tools/release-control.mjs candidate `
  --component mobile `
  --created-at 2026-07-15T12:00:00Z `
  --review-evidence C:\approved-inputs\review.json `
  --config-attestation C:\approved-inputs\mobile-config.json
```

Without `--write`, the candidate is printed and the repository is untouched. Inspect `eligibility.status` and every `blockingReasons` entry. To create the append-only file after inspection, repeat the exact command with `--write`, then review, commit, push, and merge it. Candidate creation refuses a dirty worktree; the new record intentionally makes the tree dirty only after all inputs pass.

Build identity is component-scoped and computed from an archived Git tree at the reviewed source SHA, so checkout line-ending conversion cannot alter it:

- Pages: every byte of the exact 22-file allowlist, the asset-derived cache revision, and a cache number strictly newer than the current Pages baseline.
- Worker: every tracked file under `worker/`, excluding generated/cache directories, plus an exact check for both approved production origins.
- Mobile: every tracked file under `mobile/`, excluding generated/cache directories; the app config is executed in a stripped environment so the runtime policy is verified from its exported value rather than source text.
- Database: every tracked database catalog, migration, and query file. The authoritative database-control validator rechecks complete inventory, metadata, ordering, gaps, ID/path agreement, and fingerprints before the ledger is hashed; the result is labeled `repository-intended`, never remotely verified by implication.

## Execution lease and baseline revalidation

An eligible candidate must already be committed on current `origin/main`. The intent and revalidation commands explicitly refresh `refs/remotes/origin/main` and fail closed if that refresh fails, then require clean HEAD equality. The intent records the pre-intent main commit; after the intent PR merges, revalidation requires that commit to be an ancestor of current main rather than impossibly requiring equality. Provenance-only commits may follow the candidate, but the component's archived current build inputs, migrations, baseline, and deploy configuration must still match.

```powershell
node tools/release-control.mjs intent `
  --candidate release/records/<candidate-id>.json `
  --execution-id exec-<component>-<unique-id> `
  --created-at 2026-07-15T13:00:00Z
```

Inspect the dry-run JSON, then repeat with `--write`. Commit, push, review, and merge the intent before any external command. Only one unresolved intent may exist per component.

Synchronize clean main again, then run immediately before the separately approved platform command:

```powershell
node tools/release-control.mjs revalidate `
  --intent release/records/<intent-id>.json
```

Revalidation refuses a dirty tree, changed `origin/main`, a stale baseline, changed component inputs, a changed migration ledger, changed authoritative deploy configuration, an ineligible candidate, a non-owning lease, or an already recorded execution outcome. Run it immediately before the separately approved external command. A passing message says only that the lease is current; it is not permission to deploy and is not deployment evidence.

The component runbook still owns the actual command and explicit approval gate:

- Pages: the exact staged 22-file Direct Upload procedure in `docs/cloudflare-pages-cutover.md`.
- Worker: reviewed Wrangler deployment with configuration checks in `docs/worker-configuration.md`.
- Mobile: production channel/runtime checks and EAS command in `docs/cloudflare-pages-cutover.md` or the applicable release runbook.
- Database: `docs/database-change-control.md`; no remote operation is eligible today.

## Finalize or abandon

After an external action starts, preserve its returned non-secret evidence even if it fails or conflicts. Finalization deliberately does not repeat the pre-execution source/config freshness check: main may advance while a provider command is running, but that cannot erase the outcome of an execution that already started. It still requires a clean synchronized current main and the immutable matching intent/candidate ledger. Evidence is field-allowlisted; extra fields are rejected instead of copied into Git. Every result requires `kind`, `executionId`, `result` (`success`, `failed`, `conflict`, or `unknown`), `approvalRef`, and `evidenceRef`, with optional canonical `startedAt`/`completedAt` inside the intent/final chronology. Successful platform evidence also requires `releaseId`. Successful database evidence requires the exact ordered migration ID/checksum ledger from its candidate and never invents a platform ID. Failed evidence may omit release identity when no release was created.

```powershell
node tools/release-control.mjs finalize `
  --intent release/records/<intent-id>.json `
  --created-at 2026-07-15T14:00:00Z `
  --evidence C:\approved-inputs\execution-result.json
```

Inspect, then repeat with `--write` and merge the new final record. A retry with the same result evidence returns the existing outcome without writing; different evidence for the same execution fails as a conflict. `success` must identify a release distinct from both the current release and its known preceding rollback release, then advances the baseline; `failed` closes without promotion. `conflict` and `unknown` preserve the evidence but deliberately keep the component lease blocked. Never edit the prior record.

After an explicit owner decision resolves trustworthy evidence for an `unknown`/`conflict`, create a separate reconciliation:

```powershell
node tools/release-control.mjs reconcile `
  --intent release/records/<intent-id>.json `
  --created-at 2026-07-15T15:00:00Z `
  --owner-decision-ref owner-decision-456 `
  --evidence C:\approved-inputs\reconciled-result.json
```

The reconciled evidence must resolve to `success` or `failed`; inspect the dry run, repeat with `--write`, and merge it. Reconciliation cannot abandon an execution, erase the uncertain outcome, or reuse the prior release as a fake success.

If and only if the command never began, create a non-secret attestation containing `executionId`, `executionStarted: false`, `operator`, `approvalRef`, and `observedAt`, then run:

```powershell
node tools/release-control.mjs abandon `
  --intent release/records/<intent-id>.json `
  --created-at 2026-07-15T14:00:00Z `
  --attestation C:\approved-inputs\never-started.json `
  --reason "Approved window closed before command start"
```

An uncertain or partially started execution is never abandoned. Finalize it from evidence, or leave the component blocked and request an explicit owner decision. A concurrent platform conflict is recorded as the execution result and is not promoted silently as the current baseline.

## Validation and safety boundary

Run focused validation with:

```powershell
node --test tools/tests/release-control.test.mjs
node tools/release-control.mjs validate
```

The full repository command also validates provenance:

```powershell
node tools/verify-repo.mjs
```

No record may contain credentials, secret values, raw provider responses that contain secrets, user identifiers, or production data. Record only stable platform IDs, hashes, timestamps, approval/evidence references, and redacted outcomes.

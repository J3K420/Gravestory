# Database change control

GraveStory's database changes and administrative SQL are controlled by [`database/catalog.json`](../database/catalog.json). The catalog fingerprints every SQL artifact byte-for-byte, classifies read versus write behavior, explains migration ordering, and records approval, verification, release, and recovery posture. `.gitattributes` fixes cataloged SQL to CRLF in every Windows/Ubuntu checkout so exact working-tree hashes remain portable. `node tools/database-control.mjs validate` fails when a SQL file is added, removed, renamed, changed, duplicated, misclassified, or separated by an unexplained migration gap.

This repository contract does not connect to Supabase. It does not establish which migrations are already live, and it does not authorize a production read or write.

## Current sequence and known limits

The primary sequence contains 33 forward migrations: `001` through `026`, then `028` through `034`. Every migration is described and SHA-256 fingerprinted in the catalog. `027` is an explained gap: the proposed client-triggerable refund design was abandoned before a SQL file shipped because it would have reopened unlimited scan allowance resets; `028_split_scan_check_commit.sql` records the safer replacement.

The sequence is not yet a complete bootstrap. Migration `001` alters `public.stories`, but neither the current tree nor repository history contains the original table definition and pre-001 policies. Inferring that privileged baseline from client code would risk silently weakening RLS. Until a reviewed baseline is recovered, the catalog remains `bootstrap.status = "unresolved"` and the local command stops before Docker or SQL execution. Consequently, GraveStory does not yet claim full dev/production database parity.

Resolving that gap requires separate approval to inspect an authoritative schema source. The safe result is a reviewed baseline migration plus Auth, PostgREST, and RLS smoke tests—not a dump of production data and not a blind copy of dashboard state.

## Adding a database change

1. Start from the latest merged migration ID and create the next three-digit, forward-only file in `supabase-migrations/`. Do not reuse a number or edit an existing numbered file.
2. Make the migration safe to apply once to the known predecessor. Prefer additive changes and explicit grants/revokes. Preserve soft-delete behavior and service-role isolation.
3. Add its catalog entry with write classification, `schema-before-dependent-release`, explicit production-write approval, a disposable-local verification path, and `forward-fix-only` recovery.
4. Run `node tools/database-control.mjs validate`, the repository verifier, and BMad review. A fingerprint mismatch is intentional protection; update the catalog only for the new reviewed artifact.
5. Once the baseline is resolved, run the disposable local stack and its Auth/PostgREST/RLS tests before requesting any remote action.
6. Treat remote application as a separate release gate. One operator applies migrations in order, records the exact commit and result, and runs the cataloged post-change verification. Never rewrite an already applied migration to roll back; ship a new forward fix.

No automated production `db push`, `db reset`, migration repair, schema pull, or project link is provided. Adopting remote CLI migration history safely requires an approved comparison with the existing live history first. In particular, never run `supabase db reset --linked` or against a remote database.

## Local Supabase

The local scaffold pins Supabase CLI `2.101.0` in `tools/supabase-cli` and keeps its reviewed settings in `supabase/config.toml`. Supabase's official local-development workflow requires both the CLI and a Docker-compatible container runtime; `db reset` then reapplies local migrations. See the [official local development guide](https://supabase.com/docs/guides/local-development) and [database migration guide](https://supabase.com/docs/guides/deployment/database-migrations).

After the missing baseline and smoke tests are versioned, the intended command is:

```powershell
node tools/database-control.mjs local-test --target local --confirm disposable-local
```

The explicit target and confirmation permit replacement of only the generated, disposable local schema. The command cannot select a remote target, requires Docker's `default` context to resolve to a local socket or loopback endpoint, refuses to replace a hand-maintained or changed `supabase/migrations` directory, serializes resets with an exclusive local lock, and builds child environments from a small non-secret allowlist. Locks are never automatically deleted: an aged lock whose recorded process is dead is reported as stale and requires manual inspection/removal, avoiding concurrent-reclaimer races. At present the command exits with the catalog's missing-prerequisite list before touching Docker.

## Administrative task matrix

| Task | Data access | Required target/confirmation | Approval boundary |
|---|---|---|---|
| Catalog validation | none | repository | none |
| Local schema reset/test | disposable write | `local` / `disposable-local` | none after prerequisites exist |
| Metrics digest, local | read | `local` / `local-read` | none |
| Metrics digest, production | privileged read | `production` / `production-read` plus production-named URL and service-role key | explicit production-read approval |
| `queries/*.sql` | read | operator-selected database | explicit approval for any remote target |
| Numbered migration | schema/data write | operator-selected production project | explicit production-write approval |
| `026_VERIFY_live.sql` | historical data/auth write; superseded by `028` | do not run | not an active operational task |
| Retrieval helper | historical schema write | do not run | retained for provenance only |

The metrics digest no longer contains or falls back to a production project URL:

```powershell
# Disposable local stack
node tools/metrics-digest/digest.mjs --target local --confirm local-read

# Production: run only after approval, with SUPABASE_PRODUCTION_URL and
# SUPABASE_PRODUCTION_SERVICE_ROLE_KEY supplied outside the repository
node tools/metrics-digest/digest.mjs --target production --confirm production-read
```

The validator discovers `.sql` files repository-wide (excluding generated/dependency directories), not only in the two current SQL folders. Cataloged read scripts set both session and current-transaction read-only mode before their `SELECT`/`WITH` statements, so the SQL Editor's last visible result remains the actual report. The validator also rejects non-allowlisted function calls. Because session read-only mode intentionally persists, open a new SQL Editor session before a separately approved write. Operational database scripts and runbooks carry an `@database-operation <id>` source marker, which must correspond to the exact cataloged source file. Those files are not generic copy/paste snippets: their catalog entry is the source of truth for whether they read or write, which target-specific environment inputs they need, when they relate to a release, and what approval they require.

## Tester access

Changing `app_metadata.is_unlimited` is a production write, not an ordinary troubleshooting query. The reviewed command first reads and verifies the named user, avoids a write when the value already matches, patches only the `is_unlimited` field through Supabase Auth Admin, independently re-reads the user, and prints a non-secret audit record. Every request has a 15-second timeout:

```powershell
# Run only after explicit production-write approval. Supply the URL and key outside Git.
node tools/tester-access.mjs --target production --confirm production-write --approval <approval-reference> --user-id <user-uuid> --unlimited true

# Reversal is a separate explicitly approved operation.
node tools/tester-access.mjs --target production --confirm production-write --approval <approval-reference> --user-id <user-uuid> --unlimited false
```

It requires `SUPABASE_PRODUCTION_URL` and `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`, rejects any origin outside the reviewed allowlist, and has no ambient or local fallback. If a write response is lost, it re-reads the user; if reconciliation is also unavailable, it reports the outcome as unknown rather than claiming failure or success. Capture the pre/post values printed by the command with the operator/time/result. Never embed a user email, UUID, project URL, or service-role credential in other repository documents.

## Recovery and evidence

- Existing numbered migrations are immutable by default; their catalog hashes enforce this.
- A failed unapplied migration is corrected on its branch. A migration that may have reached any shared environment is corrected with a new forward migration.
- Destructive reversal, data repair, migration-history repair, or live parity inspection always requires explicit approval and a task-specific backup/recovery plan.
- Verification and retrieval SQL are never inserted into the primary migration sequence. The two historical helpers currently present are write-capable and explicitly classified as superseded/do-not-run.
- Passing catalog validation proves repository completeness and exact byte identity, not live application state.
- Passing the future local suite will prove behavior against the pinned disposable Supabase stack, not that production has identical configuration or data.

# Twelve-Factor deploy/config BMad code review

Date: 2026-07-16

Mode: full specification review

Spec: `_bmad-output/specs/spec-deploy-config-resources/SPEC.md`

Diff: `agent/twelve-factor-deploy-config` staged changes against `e729ef46bcdab389f922377f6036e552dff8037c`

Layers completed:

- Blind Hunter
- Edge Case Hunter
- Acceptance Auditor

Failed or empty layers: none

Final clean-room re-review after all remediations: CLEAN from Blind Hunter, Edge Case Hunter, and Acceptance Auditor.

## Review Findings

- [x] [Review][Patch] Bind the shipped Expo public boundary to the attested values instead of silently evaluating defaults while EAS overrides them. [`mobile/app.config.js`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Validate feature-gated RevenueCat/Google Maps public identifiers when supplied, and enforce exact HTTPS update URL plus UUID project identity. [`mobile/app.config.js`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Enumerate and semantically validate every Worker service handle, variable, public identifier, secret name, R2 binding, and bucket. [`deploy/config/contract.json`; `tools/deploy-config.mjs`; `worker/config.js`]
- [x] [Review][Patch] Make installed-client generation records immutable and append-only, and cover the Pages origin plus mobile update/EAS/SDK identities. [`deploy/config/compatibility.json`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Require sealed repository evidence and sealed owner approval before a separate append-only retirement record can remove a generation from support. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Require source-bound remote evidence to list every required/feature-gated field and reference a sealed owner-approval artifact. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Permit a client locator to move independently through the full repository gate while retaining old-generation locators in related attestations. [`tools/deploy-config.mjs`; `tools/tests/deploy-config.test.mjs`]
- [x] [Review][Patch] Bind the current Pages canonical origin to browser compatibility and require the database policy to retain every current Supabase origin. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Execute the metrics digest's explicit target/input semantics as part of deploy-config repository validation. [`tools/metrics-digest/target.mjs`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Preserve the preceding cached-web generation when new `auth.js` is paired with its older config script, and bind the fallback source into the Pages identity. [`js/auth.js`; `deploy/config/contract.json`]
- [x] [Review][Patch] Reject broad placeholders, arbitrary evidence kinds, noncanonical/future timestamps, and inconsistent Worker classifications. [`mobile/app.config.js`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Reject duplicate CLI options rather than silently accepting the last value. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Give every optional mobile SDK input an explicit enable flag and make remote evidence require feature fields only for declared enabled conditions. [`mobile/app.config.js`; `deploy/config/contract.json`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Reject impossible normalized dates, require retirement evidence before approval before retirement, and test both boundaries. [`tools/deploy-config.mjs`; `tools/tests/deploy-config.test.mjs`]
- [x] [Review][Patch] Reconcile every required and feature-gated Worker declaration with the exact runtime validation exports, including admin subfeatures. [`worker/config.js`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Parse production Wrangler root, `[vars]`, and a single `[[r2_buckets]]` record by scope; require `worker.main` to be a file. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Fail closed when Git compatibility history cannot be read. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Exercise metrics target selection, confirmations, origin separation, and placeholder rejection through runtime behavior rather than exported constants alone. [`tools/deploy-config.mjs`; `tools/metrics-digest/target.mjs`]
- [x] [Review][Patch] Add the Cloudflare Pages project handle to an authoritative consumed boundary and remove duplicated project literals from operator commands. [`deploy/config/pages-target.json`; `tools/deploy-config.mjs`; `project-context.md`; `docs/cloudflare-pages-cutover.md`]
- [x] [Review][Patch] Bind remote evidence and owner approval to the exact configuration identity and Git commit. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Make post-review remote evidence appendable without a commit-hash fixed point by resolving the named source commit's component attestation and requiring the same configuration identity. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Preserve already-provisioned EAS SDK keys as a compatible explicit enable condition while retaining opt-in flags for new environments. [`mobile/app.config.js`]
- [x] [Review][Patch] Retain the verified-live Pages v69 cache generation in addition to v70 and current v72 source boundaries. [`deploy/config/compatibility.json`]
- [x] [Review][Patch] Resolve the authoritative Pages project before entering the allowlisted staging directory that intentionally excludes repository tools. [`docs/cloudflare-pages-cutover.md`]
- [x] [Review][Patch] Make project resolution independent of the current staging directory by invoking the validator through the repository path, and document all three mobile flag states consistently. [`docs/cloudflare-pages-cutover.md`; `docs/deploy-configuration.md`]
- [x] [Review][Patch] Normalize text line endings only for deploy configuration identities so Windows CRLF and Linux LF checkouts reproduce the same attestations; retain exact-byte hashes for sealed evidence. [`tools/deploy-config.mjs`; `tools/tests/deploy-config.test.mjs`]
- [x] [Review][Patch] Reject malformed UTF-8 identity sources instead of allowing replacement-character hash collisions during newline normalization. [`tools/deploy-config.mjs`; `tools/tests/deploy-config.test.mjs`]
- [x] [Review][Patch] Preserve a leading UTF-8 BOM as identity-bearing content and reject NUL-containing identity inputs as non-text before newline normalization. [`tools/deploy-config.mjs`; `tools/tests/deploy-config.test.mjs`]
- [x] [Review][Patch] Require the database allowlist to retain Supabase origins for every supported, non-retired client generation. [`tools/deploy-config.mjs`]
- [x] [Review][Patch] Bind Pages generations to concrete service-worker cache IDs and mobile generations to Android versionCode; retain both the live-overlap v69 and v72 source Pages generations. [`deploy/config/compatibility.json`; `tools/deploy-config.mjs`]
- [x] [Review][Patch] Reject the literal `placeholder` across public mobile, deploy, Pages-project, and metrics credential boundaries. [`mobile/app.config.js`; `tools/deploy-config.mjs`; `tools/metrics-digest/target.mjs`]

## Verification after remediation

- `node --test tools/tests/deploy-config.test.mjs`: 25 passed
- `node tools/deploy-config.mjs validate`: passed
- `node tools/release-control.mjs validate`: passed
- `node tools/verify-repo.mjs`: 74 Node tests and 2 BMad tooling tests passed
- `node tools/verify-repo.mjs --install`: passed after all second-pass remediations, including clean installs, Expo config/bundle checks, and Wrangler dry-run

No remote provider, secret, binding, database, deployment, or production state was read or changed.

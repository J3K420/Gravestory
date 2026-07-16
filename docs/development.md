# GraveStory development and verification

GraveStory uses one repository verification entry point for the static web app, Expo app, Cloudflare Worker, SQL assets, local tooling, and BMad workflow tests. It is intentionally non-production: it does not deploy, contact Supabase, write data, read application secrets, publish an Expo update, or mutate Cloudflare resources.

Release candidates, execution leases, and append-only deployment evidence are governed by [`release-provenance.md`](release-provenance.md). `node tools/release-control.mjs validate` is non-deploying and is included in the repository verifier.

Deploy-varying public handles, secret/binding names, attached-resource ownership, installed-client compatibility, and source-bound release attestations are governed by [`deploy-configuration.md`](deploy-configuration.md). `node tools/deploy-config.mjs validate` is also local-only and included in repository verification; remote presence remains explicitly `unverified` unless a separately approved versioned observation is committed.

## Supported toolchain

- Node.js 22.13.1 (`.nvmrc` and each Node package's `engines` field)
- npm 10.9.2 (each Node package's `packageManager` field)
- Python 3.12.3 (`.python-version`)
- Expo SDK 54 as locked by `mobile/package-lock.json`
- EAS CLI 21.0.0 in the isolated `tools/eas-cli` development package
- Wrangler 4.110.0 as a Worker development dependency
- Supabase CLI 2.101.0 in the isolated `tools/supabase-cli` development package

Node 22.13.1 satisfies Expo SDK 54's supported Node range and the repository's versioned Expo v56 documentation rule. Pinning this toolchain does not upgrade the mobile application to Expo SDK 56.

## Run the complete check

From the repository root, use an already configured Node 22.13.1, npm 10.9.2, and Python 3.12.3:

```powershell
node tools/verify-repo.mjs --install
```

The command performs clean `npm ci` installs from all committed lockfiles, resolves the public Expo config with build-time keys removed, creates and removes a local Android Expo export to compile the mobile source, validates `eas.json` with EAS CLI's bundled parser, performs a Wrangler dry run with telemetry disabled, checks static and inline JavaScript syntax, validates the Cloudflare Pages manifest and fingerprinted database catalog, confirms the pinned Supabase CLI binary, and runs the Node and BMad tests. Sensitive environment variables are removed from child processes. These checks run offline after dependency installation; neither the Expo export nor Wrangler's `--dry-run` deploys anything.

The same command validates all four deploy-config attestations, rejects unsupported installed-client locator retirement, and confirms the release-provenance verifier can reproduce configuration authority from the candidate source revision.

The default verifier does not start Docker or claim database parity. `docs/database-change-control.md` records the missing pre-001 `stories` baseline that currently blocks a disposable local Supabase reset and Auth/PostgREST/RLS behavior tests.

`expo install --check` currently reports two pre-existing patch drifts: `expo` 54.0.34 versus expected 54.0.35 and `expo-font` 14.0.11 versus expected 14.0.12. They are recorded for the dependency-maintenance batch rather than being mixed into this verification-foundation change.

For a fast repeat check that does not reinstall dependencies, omit `--install`. CI always uses the complete clean-install form.

## Dependency and asset changes

Use the pinned npm version when regenerating a lockfile. Keep runtime dependencies intentional and review lockfile diffs. The static web app remains vanilla HTML, CSS, and JavaScript: do not introduce a bundler, framework, generated application bundle, or npm runtime solely for verification.

Browser CDN dependencies in `index.html` must use exact versions. The `sw.js` cache key combines the release number with a verifier-calculated fingerprint of the 22-file deployment graph. Any deployed web asset change therefore requires the reported fingerprint update—and, for a new release, the numeric cache version bump—so installed clients do not retain the prior asset graph.

## Merge and release boundary

The `Verify repository` GitHub Actions workflow reports the same clean verification on pull requests and on `main`. A code batch is not ready to merge while this check or the BMad code-review workflow has an unresolved finding. Repository branch-protection settings are an external resource and are not changed by this batch; until separately approved, this is a documented procedural merge gate.

Passing verification authorizes neither a release nor a deployment. Production deploys, live database changes, secret changes, OAuth/webhook changes, and external Supabase or Cloudflare configuration remain separate explicit-approval gates.

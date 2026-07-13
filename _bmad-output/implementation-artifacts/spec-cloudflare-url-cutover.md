---
title: 'Complete Cloudflare Pages URL Cutover'
type: 'chore'
created: '2026-07-13'
status: 'done'
baseline_commit: 'da36aead1962b2a3fe719d92498246ed7322e347'
isolation_start_commit: '95f16f44a9e599a0f45db49cabf08cfaa50bde8f'
migration_commit: 'c367395f02370d6b673b10467fb484ddb9963dc0'
context:
  - '{project-root}/CLAUDE.md'
  - '{project-root}/mobile/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** GraveStory's pointer website is live at `https://gravestory.pages.dev/`, but the migration commit is not in shared Git history and active mobile, Play Store, proxy-origin, and operating instructions still reference the old GitHub Pages URLs. Retiring the old pages now could break policy links used by installed apps and Google Play.

**Approach:** Continue from the latest migration baseline (`c367395`), replace current-facing URL references, create durable Codex and deployment memory, and validate each cutover surface. Keep the old URLs available until the production OTA and Google Play fields are independently confirmed.

## Boundaries & Constraints

**Always:** Use `https://gravestory.pages.dev/` as the canonical public root, with `/privacy-policy/`, `/terms/`, and `/delete-account/` for policy endpoints. Preserve the exact latest mobile baseline before any production OTA. Run BMAD adversarial review and independent validation before commit/deployment. Preserve unrelated existing work and secrets.

**Ask First:** Disabling GitHub Pages, making the GitHub repository private, removing the old Worker origin, or making any non-URL product change. If authenticated Google Play access is unavailable, report the console work as pending rather than claiming completion.

**Never:** Delete or overwrite the original dirty worktree; publish an OTA from the older `main` snapshot; copy secrets from Claude memories; rewrite historical session artifacts; or retire the old URL before Play Console, public-listing, and installed-app checks pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Current link | User opens a website, policy, terms, or deletion link | Correct `gravestory.pages.dev` endpoint loads publicly | Failed endpoint blocks retirement |
| Installed app | Production app still contains GitHub URLs | Settings links are changed and shipped from the latest app baseline | Keep old site live until OTA is verified |
| Play Console stale | Console or public listing still exposes an old URL | Update privacy, deletion, and listing fields and verify publicly | Record exact pending field when authentication is unavailable |
| Origin overlap | Old site remains available during transition | Worker allowlist accepts new and old origins temporarily | Remove old origin only after final cutover approval |

</frozen-after-approval>

## Code Map

- `index.html`, `sw.js` -- canonical/social/legal migration plus overlap-safe absolute legal links and cache v69.
- `mobile/src/screens/SettingsScreen.js` -- production Privacy Policy and Terms destinations.
- `store-listing/data-safety-answers.md`, `store-listing/description.md` -- source text for Google Play deletion and privacy fields.
- `worker/wrangler.toml`, `worker/worker.js` -- transitional browser-origin allowlist and its documented example.
- `AGENTS.md` -- new Codex-owned durable project and cutover memory.
- `docs/cloudflare-pages-cutover.md` -- deploy bundle, exact console fields, verification, and retirement gates.
- `CLAUDE.md`, `project-context.md`, `_bmad-output/project-context.md` -- active agent instructions that currently describe the former host/deployment.

## Design Notes

`baseline_commit` is the parent used to review migration commit `c367395` together with this patch. `isolation_start_commit` records where the clean worktree was created; it is not a release baseline. Production OTA ancestry is anchored to `migration_commit` or a verified descendant.

## Tasks & Acceptance

**Execution:**
- [x] Git branch -- fast-forward the isolated branch to `c367395` before editing so source and OTA validation use the latest known app baseline.
- [x] `mobile/src/screens/SettingsScreen.js` and store-listing Markdown -- replace active policy, terms, and deletion destinations with Cloudflare Pages URLs.
- [x] `worker/wrangler.toml` and `worker/worker.js` -- add the new origin while retaining the old origin during the overlap window; deploy only after configuration validation.
- [x] `AGENTS.md` and `docs/cloudflare-pages-cutover.md` -- record instruction precedence, BMAD/OTA rules, manual Cloudflare Pages deployment bundle, Google Play fields, and safe retirement order without secrets.
- [x] Active context files -- correct hosting, URL, service-worker, and deployment statements; leave historical implementation records unchanged.
- [x] Google Play and EAS handoff -- document the exact authenticated Play fields and production OTA command/rollback gate; defer remote mutation and publication until local review passes.
- [x] Git -- prepare an isolated cutover-only diff for review, with no commit or push during implementation, and leave the original worktree untouched.

**Acceptance Criteria:**
- Given any active GraveStory source or operational reference, when current-facing URLs are scanned, then no obsolete GitHub policy/site URL remains except explicitly documented transition or historical context.
- Given the public Cloudflare Pages deployment, when the root, policy, terms, deletion, disclaimer, image, and service-worker endpoints are requested, then each returns the expected resource and the service worker reports cache v69 or later.
- Given an installed production app, when Privacy Policy or Terms is opened after the OTA, then the corresponding Cloudflare Pages page loads without rolling back newer app behavior.
- Given Google Play still contains an old URL, when retirement readiness is evaluated, then GitHub Pages remains enabled and the repository remains public until console and public-listing verification passes.
- Given the completed diff, when BMAD and independent validation run, then only intended URL, memory, and deployment artifacts are present and no secret is introduced.

## Verification

**Commands:**
- `git diff --check` -- expected: no whitespace or patch errors.
- `rg -n "j3k420\\.github\\.io/(Gravestory|gravestory-privacy)"` with documented historical exclusions -- expected: only intentional transition/history matches.
- Public HTTP checks for `/`, `/privacy-policy/`, `/terms/`, `/delete-account/`, `/disclaimers/`, `/og-image.png`, and `/sw.js` -- expected: correct final URLs/content and cache v69 or later.
- Clean-tree and channel checks followed by `npx eas update --branch production --environment production --platform android` -- expected: URL-only Android update published from the exact reviewed descendant.
- BMAD Code Review plus a separate cutover validator -- expected: no untriaged blocking finding.

## Suggested Review Order

**Cutover contract and gates**

- Start with the authoritative state model and exact retirement sequence.
  [`cloudflare-pages-cutover.md:1`](../../docs/cloudflare-pages-cutover.md#L1)

- Verify all four authenticated Google Play surfaces remain explicit and independently checked.
  [`cloudflare-pages-cutover.md:86`](../../docs/cloudflare-pages-cutover.md#L86)

- Confirm clean-source, Android-only OTA publication and rollback safeguards.
  [`cloudflare-pages-cutover.md:115`](../../docs/cloudflare-pages-cutover.md#L115)

- Review transitional dual-origin deployment and reproducible CORS checks.
  [`cloudflare-pages-cutover.md:166`](../../docs/cloudflare-pages-cutover.md#L166)

- Inspect endpoint identity, content-type, redirect, and cache-version assertions.
  [`cloudflare-pages-cutover.md:207`](../../docs/cloudflare-pages-cutover.md#L207)

- Confirm retirement remains owner-gated and immediately reversible on smoke-test failure.
  [`cloudflare-pages-cutover.md:259`](../../docs/cloudflare-pages-cutover.md#L259)

**Runtime URL behavior**

- Mobile policy actions now open the canonical Cloudflare Pages endpoints.
  [`SettingsScreen.js:316`](../../mobile/src/screens/SettingsScreen.js#L316)

- Absolute footer links remain valid on both hosts during overlap.
  [`index.html:111`](../../index.html#L111)

- Cache v69 invalidates the reviewed landing-page footer correction.
  [`sw.js:1`](../../sw.js#L1)

- Both production origins remain permitted until final retirement approval.
  [`wrangler.toml:11`](../../worker/wrangler.toml#L11)

**Durable operating memory**

- Codex startup memory centralizes authority, BMAD, URL, and deployment gates.
  [`AGENTS.md:1`](../../AGENTS.md#L1)

- Active BMAD context now enforces the mobile-only pipeline boundary.
  [`project-context.md:52`](../../project-context.md#L52)

- Current project status distinguishes reviewed v69 source from live v68 deployment.
  [`CLAUDE.md:242`](../../CLAUDE.md#L242)

**Play and deployment supporting artifacts**

- Data Safety copy supplies the canonical external deletion endpoint.
  [`data-safety-answers.md:18`](../../store-listing/data-safety-answers.md#L18)

- Store description supplies the canonical privacy-policy endpoint.
  [`description.md:49`](../../store-listing/description.md#L49)

- Machine-readable manifest makes the 22-file Pages bundle deterministic.
  [`cloudflare-pages-manifest.txt:1`](../../docs/cloudflare-pages-manifest.txt#L1)

- Admin dashboard remains explicitly excluded from public site uploads.
  [`README.md:60`](../../metrics-dashboard/README.md#L60)

- Public-facing press copy consistently points at the new host.
  [`press-kit.md:37`](../../marketing/press-kit.md#L37)

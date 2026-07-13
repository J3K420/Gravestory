# GraveStory Codex Memory

This file is the durable Codex handoff for GraveStory. Keep it concise and current.

## Authority and startup

1. Follow the owner's current request and verified code/configuration first.
2. Read `CLAUDE.md` for project-wide conventions before substantive work.
3. For anything under `mobile/`, also read `mobile/AGENTS.md`; its scoped Expo-documentation rule overrides stale version notes elsewhere.
4. Before changing URLs, hosting, Google Play fields, or deployment state, read `docs/cloudflare-pages-cutover.md`.
5. Treat dated planning, implementation, and session artifacts as history. Do not rewrite them to look current; use them only for rationale.

Never copy credentials, API keys, passwords, or other secrets from memories, transcripts, dashboards, or local files into source, documentation, chat, or logs.

## Required development process

- GraveStory uses BMAD at planning, implementation, review, and deployment checkpoints. Every substantive change must pass adversarial `bmad-code-review` (Blind Hunter plus Edge Case Hunter, then triage) before commit or deployment.
- Correctness-critical or locally unrunnable work also needs an independent validation agent.
- Stake a FourThought prediction before substantive implementation and reflect after the outcome is known.
- Preserve dirty worktrees and unrelated owner changes. Use an isolated worktree when a focused cutover or release must not absorb other branch history.
- Do not claim an authenticated console or remote deployment was completed unless it was directly verified.

## Product boundaries

- Mobile is the product. The public web surface is only the app-store landing page, community global map, and read-only public biography view.
- Do not recreate or maintain the retired web scan/research/auth-write pipeline. Mobile pipeline changes are mobile-only unless they affect the surviving global-map/public-bio surface.
- The Cloudflare Worker and Supabase remain load-bearing for mobile even though the web pipeline was retired.

## Canonical public URLs

- Root: `https://gravestory.pages.dev/`
- Privacy policy: `https://gravestory.pages.dev/privacy-policy/`
- Terms: `https://gravestory.pages.dev/terms/`
- Account deletion: `https://gravestory.pages.dev/delete-account/`

Cloudflare Pages project `gravestory` is a manual Direct Upload project, not a Git-connected deployment. Deploy only the 22-file allowlisted bundle documented in `docs/cloudflare-pages-cutover.md`; never deploy the repository root.

The legacy GitHub Pages origin is intentionally transitional. Do not disable GitHub Pages, make the repository private, remove the old Worker origin, or otherwise retire the old URL until the production OTA, Google Play fields, public listing, and installed-app links are verified and the owner explicitly approves retirement.

During overlap, the Worker `ALLOWED_ORIGIN` value must contain both `https://gravestory.pages.dev` and `https://j3k420.github.io`. It must never be `*` in production.

## Deployment gates

- Every deployed web-asset change requires an increment to the `CACHE` value in `sw.js`. Documentation, mobile-only, and Worker-only changes do not require a service-worker bump.
- Mobile JavaScript-only changes ship from `mobile/` only after confirming the latest source baseline, a clean worktree, and the production channel: `npx eas update --branch production --environment production --platform android`.
- Native dependency or app-configuration changes require a new build, not an OTA.
- A URL cutover OTA must be verified on an installed production app after two cold starts. Keep the old site live until both Settings links open the new endpoints.
- Worker, EAS, Google Play, GitHub Pages, repository-visibility, and Cloudflare Pages mutations are remote operations. Run them only after local review and the explicit gates in the cutover runbook.

## Current cutover baseline

Commit `c367395` contains the initial landing-page migration and service-worker cache `gravestory-v68`; the reviewed overlap-safe legal-link patch increments the source cache to `gravestory-v69`. Any cutover OTA must be built from `c367395` or a verified descendant containing all newer mobile work. The remaining authenticated steps and retirement order are tracked in `docs/cloudflare-pages-cutover.md`.

Google Play currently serves Android versionCode 15 (owner-confirmed 2026-07-13). `mobile/app.config.js` reserves versionCode 16 for a future AAB; do not describe vc16 as live until Play Console directly verifies it. This URL cutover is OTA-only and does not change the build number.

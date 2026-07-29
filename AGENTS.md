# GraveStory agent contract

This file is the durable repository-level contract for GraveStory. Keep it limited to authority, invariants, routing, and required gates; volatile release state belongs in dated records and runbooks.

## Authority and startup

1. Follow James's current request.
2. For governing behavior, apply the available `AGENTS.md` files from workspace root to repository root to the closest scoped file. A closer file may refine its parent but may not weaken a parent safety, authorization, required-process, or product-boundary rule unless James explicitly approves that named override. Code and configuration are evidence of observed state, while `project-context.md`, `CLAUDE.md`, and runbooks supply context. Stop and report any unresolved conflict instead of choosing one silently.
3. Identify the intended target branch and base before substantive work. Inspect the branch, merge base, and `git status --short`. For any target with an upstream, record the remote/ref used and verify its freshness when authorized remote access is available; otherwise disclose that target freshness is unverified.
4. Read `project-context.md` for enduring conventions and `CLAUDE.md` for the broader technical map. Treat their dated current-state sections, planning artifacts, handoffs, deployment identifiers, and release summaries as history. Code and configuration can verify source state only; authenticated live claims require an authorized direct observation.
5. For work under `mobile/`, also read `mobile/AGENTS.md`.

Never copy credentials, API keys, passwords, private user data, or other secrets from memories, transcripts, dashboards, local files, or remote systems into source, documentation, chat, receipts, or logs.

Do not commit or push unless James explicitly requests it. This repository-level rule supersedes any automatic commit/push instruction in `CLAUDE.md` or older project documentation.

## Required development process

- Preserve dirty worktrees and unrelated owner changes. Use an isolated worktree from the verified intended base when focused work must not absorb another branch's changes or history.
- Stake a FourThought prediction before substantive implementation and reflect after the outcome is known. Skip this for truly trivial work.
- Every substantive change—including code, SQL, configuration, behavior, agent policy, operational documentation, runbooks, release controls, and verifier tooling—must pass the repository's adversarial `bmad-code-review` workflow before handoff, commit, build promotion, or deployment.
- Obtain James's approval once before launching the workflow's required review agents. Review the complete intended diff, resolve every finding as fixed, evidenced false-positive/not-applicable, or explicitly accepted by James, and rerun affected review layers and executable checks after material fixes so the final reviewed/tested baseline matches the handoff diff. Review-only prompts and receipts do not recursively restart the workflow, and unresolved high-severity findings may not be self-waived.
- Correctness-critical or locally unrunnable work also needs independent validation beyond the review workflow. Ask James before delegating that validator, and report its model, reasoning, sandbox, task, and findings. If a required reviewer, validator, tool, or runtime is unavailable or declined, fail closed: report the missing gate and label the result unvalidated unless James explicitly approves an independent alternative or waiver.
- Follow `docs/development.md` to select the complete clean-install verifier or the fast repeat check, then run the relevant focused checks. Do not replace current-branch executable checks with an older verifier, an older configuration contract, or manual inspection alone; report every unexecuted or pre-existing failing check.
- Do not claim an authenticated console action, build, deployment, migration, or production check was completed unless it was directly verified.

## Product boundaries

- Mobile is the product. The public web surface is limited to the app-store landing page, community global map, and read-only public biography view.
- Do not recreate or maintain the retired web scan, research, or authentication-write pipeline. Mobile pipeline changes remain mobile-only unless they affect the surviving global-map or public-biography surface.
- The Cloudflare Worker and Supabase remain load-bearing for mobile even though the web pipeline was retired.

## Operations and release

- Local code or documentation changes do not authorize remote operations. Any authenticated external service, data, configuration, billing, or production surface—including but not limited to Worker, EAS, app stores, RevenueCat, Supabase, Cloudflare/R2, and GitHub—requires James's explicit approval for the exact read, log access, secret check, observation, or mutation; service or project; environment; and scope. Approval does not carry across unrelated operations.
- Before database work, read `docs/database-change-control.md`. For Worker configuration or bindings, read `docs/worker-configuration.md` and `docs/deploy-configuration.md`; for runtime behavior, logs, or live checks, read `docs/runtime-operations.md`; for upload, promotion, release, or rollback, also read `docs/release-provenance.md`. Before URL, hosting, Pages, store-field, or retirement work, read `docs/cloudflare-pages-cutover.md`. If a required file or tool is missing, stop and report the exact path; do not substitute a historical document by guesswork.
- Use the repository-controlled `deploy/config/contract.json`, `deploy/config/compatibility.json`, `tools/deploy-config.mjs`, `tools/release-control.mjs`, and `tools/verify-repo.mjs`. Do not bypass them with remembered commands from handoffs or stale branches.
- Keep exact URLs, allowlists, bundle manifests, cache versions, build numbers, commit hashes, live rollout state, and copy-paste deployment commands in their canonical configuration, runbook, or dated release record—not in this file.
- For every substantive handoff, report the branch, HEAD and intended base, review baseline, exact changed files, and any post-review modifications. For uncommitted work, also report `git status --short` and staged versus unstaged or untracked state. Distinguish local verification from owner-only or authenticated checks and state everything that remains unverified.

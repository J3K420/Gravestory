---
id: SPEC-twelve-factor-program
companions:
  - batch-roadmap.md
  - evidence.md
  - ../../../docs/twelve-factor-audit.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# GraveStory Twelve-Factor program

## Why

GraveStory needs architectural hardening so its independently deployed web, mobile, Worker, database, and administrative surfaces can be changed and operated predictably without widening production risk.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can assess every factor against GraveStory's actual architecture and platform responsibilities.
  - **success:** The audit records evidence, verdict, applicability, and required outcome for all twelve factors.
- **CAP-2**
  - **intent:** Maintainers can select work in dependency and risk order.
  - **success:** Every gap has a priority and maps to an ordered batch contract.
- **CAP-3**
  - **intent:** Implementers can ship each hardening unit independently without absorbing unrelated work.
  - **success:** Each batch has its own branch name, BMad spec, acceptance criteria, dependencies, and safety boundary.
- **CAP-4**
  - **intent:** Every applicable factor is implemented or explicitly documented as platform-managed or intentionally inapplicable.
  - **success:** The final runtime-operations batch reconciles this baseline so no recommendation or applicable gap remains unexplained or untriaged.
- **CAP-5**
  - **intent:** Code batches receive independent adversarial review before publication.
  - **success:** Each code batch records completed BMad Blind Hunter and Edge Case Hunter passes, plus Acceptance Auditor when a spec/story is supplied, with all findings fixed or triaged.
- **CAP-6**
  - **intent:** Each merged batch becomes the sole baseline for the next batch.
  - **success:** Tests and dry runs pass before commit and PR; the PR is verified and merged; the next branch starts from the resulting `origin/main`.

## Constraints

- Do not deploy production, access or mutate live data, rotate secrets, change remote production settings, retire legacy services, or perform destructive operations without explicit approval.
- Preserve unrelated work through isolated clean branches and scoped commits.
- Keep the static web surface buildless vanilla HTML/CSS/JS and the mobile app in Expo managed workflow.
- Apply process-oriented factors per deployable unit inside the existing monorepo rather than splitting the repository without an operational need.
- Do not treat a complete duplicate remote staging graph as a Twelve-Factor requirement; use the smallest parity mechanism that proves the current risk.

## Non-goals

- Replatforming GraveStory or copying another repository's Twelve-Factor implementation.
- Treating public client identifiers as secrets or client-device persistence as server-process state.

## Success signal

All ordered batch specs are merged from verified clean branches; the audit shows implemented, compliant, platform-managed, justified-inapplicable, approval-blocked, or evidence-backed explicitly deferred outcomes for every factor; production remains untouched unless separately approved.

## Assumptions

- The upstream `next` branch at `3ad5a5f36312cc8ad876abae1bd691acd790d4d1` is the requested updated standard.

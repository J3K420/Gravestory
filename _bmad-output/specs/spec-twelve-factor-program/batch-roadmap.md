# Twelve-Factor batch roadmap

These batches are dependency-ordered. A branch starts only after the preceding PR is merged and `origin/main` is refreshed.

| Order | Branch | Contract | Scope | Production boundary |
|---|---|---|---|---|
| 00 | `agent/twelve-factor-audit` | Program SPEC plus audit | Evidence, priorities, applicability, branch contracts | Documentation only |
| 01 | `agent/twelve-factor-foundation` | [Deterministic verification](../spec-deterministic-verification/SPEC.md) | Tool/runtime pins, deterministic installs, safe checks, PR CI | No deploy or remote credentials |
| 02 | `agent/twelve-factor-worker-config` | [Worker config contract](../spec-worker-config-contract/SPEC.md) | Required bindings, fail-closed validation, Worker unit tests | No Worker publish or secret change |
| 03 | `agent/twelve-factor-supabase-control` | [Supabase change control](../spec-supabase-change-control/SPEC.md) | Migration ledger/validator, disposable local Supabase execution, task catalog, runbooks | No remote/live DB connection or SQL execution |
| 04 | `agent/twelve-factor-deploy-config` | [Deploy config/resources](../spec-deploy-config-resources/SPEC.md) | Public handles, config validation, attached-resource docs | No EAS/Cloudflare state or secret rotation |
| 05 | `agent/twelve-factor-release-provenance` | [Release provenance](../spec-release-provenance/SPEC.md) | Candidate/final records, non-deploying preflight, rollback metadata | No platform release |
| 06 | `agent/twelve-factor-runtime-ops` | [Runtime operations](../spec-runtime-operations/SPEC.md) | Logs, parity, process/disposal tests, final audit reconciliation | No log-drain or observability production change |

## Batch acceptance shared by 01–06

- The implementation satisfies only the current batch's SPEC and notes any dependency-driven deviation.
- Tests cover new behavior and regression-prone failure paths.
- Operational documentation distinguishes dry runs from production commands.
- The actual BMad code-review workflow runs for every code-changing batch: Blind Hunter and Edge Case Hunter always, plus Acceptance Auditor in full-spec mode; findings are fixed or evidence-triaged.
- The final staged diff passes its relevant checks.
- The branch is committed and pushed, its PR is verified and merged, and the next branch starts from the resulting remote main.
- Batch 06 updates the baseline audit so every original gap has a terminal disposition and evidence.

## Approval-bound follow-ups

The repository work may prepare commands and checklists for these actions, but must stop before executing them:

- provision or inspect an optional staging Supabase/Cloudflare/EAS environment; propose its concrete value, cost, and narrower alternatives first;
- apply or verify migrations against a remote database;
- publish Pages, Worker, EAS Build, or EAS Update releases;
- update Play Console or provider dashboards;
- rotate secrets or contract the production origin allowlist;
- change GitHub branch-protection or required-check settings;
- retire GitHub Pages or other cutover compatibility paths.

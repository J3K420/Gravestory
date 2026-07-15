---
id: SPEC-worker-config-contract
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for this batch.

# Worker configuration contract

## Why

The Worker currently treats an absent origin allowlist as `*`, so missing configuration can silently remove access controls and undermine otherwise sound secret handling.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can determine which Worker vars, secrets, and bindings each route or feature requires.
  - **success:** A version-controlled contract classifies every consumed `env` binding as required, optional, local-only, or feature-gated without exposing values.
- **CAP-2**
  - **intent:** The Worker can reject unsafe missing or malformed security configuration.
  - **success:** Production-like requests never become more permissive because `ALLOWED_ORIGIN`, client authentication, metering, or required backing-service configuration is absent.
- **CAP-3**
  - **intent:** Maintainers can prove configuration behavior without publishing the Worker.
  - **success:** Automated tests cover explicit local permissiveness, production-safe values, missing bindings, malformed origins, and feature-gated requirements.

## Constraints

- Preserve current scan-token transition behavior until its separate rollout gates are satisfied.
- Depend on the deterministic verification harness from Batch 01.
- Require `SCAN_TOKEN_ENFORCE` to be explicitly `true` or `false`; an absent value is invalid.
- Allow wildcard origins only through an explicit local/test harness and reject them in production-like configuration.
- Never print, rotate, infer, or publish secret values.
- Do not change upstream product behavior or deploy the Worker.

## Non-goals

- Changing AI providers, genealogy providers, storage products, RevenueCat products, or production environment state.

## Success signal

Configuration validation and tests demonstrate that absence or corruption fails closed while an explicit local-development mode remains available.

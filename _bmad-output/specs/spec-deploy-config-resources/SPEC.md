---
id: SPEC-deploy-config-resources
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for this batch.

# Deploy configuration and attached resources

## Why

Public resource handles and deployment controls are spread across Worker, web, mobile, and the local metrics digest, so an attachment change can require unrelated application edits, target the wrong environment, or escape consistent validation.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can find one authoritative deploy-config boundary and secret-injection contract for each component.
  - **success:** Documentation and validation enumerate every deploy-varying public handle, secret name, binding, owner, and source without printing values.
- **CAP-2**
  - **intent:** A candidate release can detect missing, placeholder, or accidentally permissive configuration.
  - **success:** Safe local validation fails on missing or invalid supplied inputs and explains only the key/rule; remote secret or binding presence is labeled unverified unless supplied by a versioned attestation or an explicitly approved read-only platform check.
- **CAP-3**
  - **intent:** Operators can replace a backing-service locator between deploys without editing unrelated application logic.
  - **success:** Tests demonstrate supported handle substitution at each component's platform-appropriate configuration boundary.
- **CAP-4**
  - **intent:** Operators can replace a client endpoint without stranding installed app versions.
  - **success:** Compatibility checks retain every locator required by all supported installed generations until adoption telemetry, enforced-version behavior, or installed-client verification demonstrates retirement safety and the owner explicitly approves it.

## Constraints

- Public client identifiers must not be misrepresented as confidential credentials; true provider credentials remain server-side.
- Depend on deterministic verification plus the Worker and database configuration inventories.
- Optional and feature-gated handles use explicit conditional-required rules rather than blanket presence checks.
- Do not mutate EAS or Cloudflare remote environment state or rotate a secret.
- Preserve the static-web no-build/no-framework contract and follow exact required Expo documentation before mobile changes.

## Non-goals

- Provider migration, web bundling, secret rotation, or production configuration changes.

## Success signal

Every deployable unit has a validated config/resource contract, and changing a supported public locator touches only that unit's declared release boundary.

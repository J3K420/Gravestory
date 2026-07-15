---
id: SPEC-runtime-operations
companions:
  - ../spec-twelve-factor-program/evidence.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for this batch.

# Runtime operations

## Why

Most process, port, concurrency, and disposal responsibilities are platform-managed, but GraveStory needs an explicit operational contract so intentional client persistence, parity gaps, and log fields are not mistaken for compliance or violations.

## Capabilities

- **CAP-1**
  - **intent:** Maintainers can see which platform owns process startup, port exposure, scaling, and disposal for every component.
  - **success:** Operational documentation maps factors VI–IX to Pages, the web service-worker cache lifecycle, Workers, Expo clients including local completion notifications, and local one-off tools with no unexplained applicability gap.
- **CAP-2**
  - **intent:** Operators can use bounded server event logs without exposing sensitive payloads.
  - **success:** Tests or static checks inventory and enforce allowed structured fields, redaction rules, and stdout/stderr emission for existing and future Worker log events.
- **CAP-3**
  - **intent:** Maintainers can understand what local and preview verification reproduces from production.
  - **success:** The parity matrix covers every configured EAS profile/channel—development, preview, phase9, and production—plus backing-service type/version, configuration differences, data policy, the smallest local/emulated/preview mechanism for each risk, and remaining approval-bound gaps.
- **CAP-4**
  - **intent:** Mobile interruption and retry behavior can preserve user work safely.
  - **success:** Documentation and relevant tests identify ownership, persistence, retry, expiry, and idempotency for offline scans, sync, local completion notifications, and external calls.
- **CAP-5**
  - **intent:** Maintainers can see the terminal disposition of every baseline gap.
  - **success:** This batch updates the baseline audit so each original gap is implemented, compliant, platform-managed, approval-blocked, or explicitly deferred with evidence.
- **CAP-6**
  - **intent:** Worker requests can stop boundedly and tolerate duplicate delivery where retries are possible.
  - **success:** Upstream Worker calls have tested deadlines; every mutating route is inventoried and classified for duplicate delivery, with an idempotency test or explicit evidence-backed exception, including `/upload-image`.

## Constraints

- Do not add a server process, queue, scheduler, or log vendor without a demonstrated GraveStory requirement.
- Depend on all preceding implementation batches.
- Treat user-device storage as product state, not a server statelessness violation.
- Treat a full remote staging graph as optional; recommend it only for named provider-specific risks that lower-cost parity mechanisms cannot cover.
- Do not change production logging retention or integrations without approval.

## Non-goals

- Building custom lifecycle machinery for platform-managed runtimes or provisioning production observability.

## Success signal

Factors VI–XI have verified platform-specific outcomes, existing and future server logs obey a bounded redaction contract, intentional client persistence has explicit resilience boundaries, and the baseline audit has a terminal disposition for every gap.

# Worker configuration contract

The Worker validates security-critical configuration before it handles CORS, authentication, metering, or routes. Invalid production-like configuration returns HTTP 503 with only the invalid key name and rule; values are never returned or logged. This is a repository contract only—it does not inspect, change, or publish Cloudflare configuration.

## Runtime modes

`WORKER_ENV=production` is required by the checked-in Wrangler configuration. Production requires exact HTTPS origins, explicit scan-token mode, client authentication, the scan-token signing secret, and Supabase service configuration.

Wildcard CORS is not accepted by the runtime Worker. Unit tests may opt into `WORKER_ENV=local` or `test` and `ALLOWED_ORIGIN=*` only by calling the validator with the explicit local-harness option. This keeps a permissive test fixture from becoming a deployable default.

`SCAN_TOKEN_ENFORCE` must be the exact string `true` or `false`. The checked-in value remains `false` to preserve the current transition rollout; this batch does not flip enforcement or change its rollout gates.
`SCAN_TOKEN_SECRET` must be a non-empty value of at least 32 bytes in production, matching the existing rollout instructions.
The signing and independent bearer secrets must not have surrounding whitespace. `ADMIN_KEY` and `REVENUECAT_WEBHOOK_SECRET` must also be at least 32 bytes. Their live lengths must be verified—and weak values rotated—only at the separately approved production gate; this repository batch does neither.

## Inventory

| Key | Mechanism | Requirement | Consumer |
|---|---|---|---|
| `WORKER_ENV` | var | required | validation mode |
| `ALLOWED_ORIGIN` | var | required | browser CORS/origin gate |
| `CLIENT_KEY` | secret injection | required | public-client speed bump; not confidential because clients contain it |
| `SCAN_TOKEN_ENFORCE` | var | required | paid-route transition/enforcement mode |
| `SCAN_TOKEN_SECRET` | secret | required | scan-token signing/verification |
| `SUPABASE_URL` | var | required | Auth, REST, RPC, account deletion, webhook writes |
| `SUPABASE_SERVICE_KEY` | secret | required | privileged Supabase calls |
| `GEMINI_KEY` | secret | feature-gated | Gemini routes |
| `TAVILY_KEY` | secret | feature-gated | Tavily search/extract routes |
| `IMAGES` | R2 binding | feature-gated | image upload and optional account cleanup |
| `R2_PUBLIC_URL` | var | feature-gated | public image locator |
| `ADMIN_KEY` | secret | feature-gated | admin metrics route |
| `REVENUECAT_WEBHOOK_SECRET` | secret | feature-gated | RevenueCat webhook authentication |
| `REVENUECAT_SECRET_KEY` | secret | feature-gated | admin RevenueCat metrics |
| `REVENUECAT_PROJECT_ID` | var | optional | avoids RevenueCat project discovery |
| `GCP_SA_EMAIL` | secret | feature-gated group | Google Cloud billing query |
| `GCP_SA_PRIVATE_KEY` | secret | feature-gated group | Google Cloud billing query |
| `GCP_PROJECT_ID` | var | feature-gated group | Google Cloud billing query |
| `GCP_BILLING_TABLE` | var | feature-gated group | Google Cloud billing query |
| `GCLOUD_MONTHLY_BUDGET` | var | optional | admin budget display |
| `GCLOUD_LAST_SPEND` | var | optional | admin fallback spend display |

The four GCP service-account/query fields are all-or-none when the admin metrics route is used. Optional numeric budget fields must be non-negative. Invalid optional admin enrichment makes the admin route unavailable without disabling unrelated routes. `R2_PUBLIC_URL` and `SUPABASE_URL`, when supplied, must be exact HTTPS origins with no trailing slash.

## Feature behavior

The core contract is evaluated before any route, so absent origin, client-auth, metering, or Supabase configuration cannot widen access. Route-owned requirements are then checked before their handler:

- Gemini and Tavily routes require their provider key.
- Image upload requires both the R2 binding and its public URL.
- Admin metrics requires its independent bearer key.
- RevenueCat webhook requires its independent webhook secret.

Other handlers retain their existing error behavior. Admin RevenueCat and Google Cloud billing enrichments are optional/feature-gated and do not weaken the admin bearer gate when absent.

## Safe verification

From the pinned repository toolchain, run:

```powershell
node tools/verify-repo.mjs --install
```

The Worker test suite checks the complete binding inventory, valid production values, missing/malformed security config, explicit local wildcard behavior, feature gates, partial GCP configuration, and secret-safe 503 responses. Wrangler then builds with `--dry-run` and telemetry disabled. No Worker is published, no secret value is read, and remote binding presence remains unverified until an explicitly approved platform check.

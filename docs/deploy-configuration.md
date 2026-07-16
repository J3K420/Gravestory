# Deploy configuration and attached resources

GraveStory has one versioned deploy-config contract at `deploy/config/contract.json`, one installed-client compatibility registry at `deploy/config/compatibility.json`, and an authoritative attestation for each release component under `deploy/config/`. The repository-only validator never contacts a provider, reads a remote secret, or prints a supplied value.

Run the safe check from the repository root:

```powershell
node tools/deploy-config.mjs validate
```

The complete repository verifier runs the same check. A passing result means the committed boundaries, declarations, compatibility registry, and attestation identities agree. It does **not** mean a Cloudflare, EAS, Supabase, RevenueCat, Google, or other remote value exists. Current attestations deliberately say `remotePresence: "unverified"`.

## Authoritative boundaries

| Unit | Public deploy boundary | Secret or binding injection | Release attestation |
|---|---|---|---|
| Static web / Pages | `deploy/config/pages-target.json` for the Pages project, `js/config.js` (`GRAVESTORY_DEPLOY_CONFIG`), canonical site origin in `index.html`, and cache generation in `sw.js` | none; browser identifiers are public by design | `deploy/config/pages.json` |
| Mobile | `mobile/app.config.js`; the versioned public boundary is exposed through `expo.extra.deployConfig` | EAS/local environment for Google Maps and RevenueCat public SDK identifiers, validated when supplied but remotely unverified | `deploy/config/mobile.json` |
| Worker | committed variables and binding names in `worker/wrangler.toml`; validation inventory in `worker/config.js` | Wrangler secret and binding injection; values never belong in Git | `deploy/config/worker.json` |
| Database | `database/catalog.json`, `tools/supabase-target-policy.mjs`, and explicit target-named environment inputs | target-specific Supabase credentials outside Git | `deploy/config/database.json` |
| Metrics digest | `tools/metrics-digest/target.mjs` with an explicit local or production target | target-specific service-role credential outside Git | covered by the shared contract; it is an admin task, not a released service |

The public Supabase anon key, Worker client key, RevenueCat Android SDK key, EAS project ID, and Google Maps Android SDK key are identifiers shipped to clients. They are not confidential credentials. Provider-side restrictions and server-side authorization remain required. Supabase service-role keys, provider API keys, webhook secrets, scan-token secrets, admin bearer keys, GCP private keys, and similar privileged values remain confidential and server-side.

## Deploy-varying input inventory

| Unit | Required | Conditional or optional | Owner/source |
|---|---|---|---|
| Pages | Pages project, site origin, service-worker cache generation, Worker origin, Supabase origin, anon identifier, client identifier | none | Pages, Worker, and database owners through the versioned web boundary |
| Mobile | Worker origin, Supabase origin, anon identifier, client identifier, EAS project/update locator, Android versionCode | RevenueCat/Google Maps SDK keys enable their feature when their flag is `true` or, for existing EAS compatibility, when the flag is absent and the key is supplied; explicit `false` requires the key to be absent | mobile/EAS owner; public values are resolved by `app.config.js` |
| Worker | production mode, exact CORS origins, Supabase origin, scan-token mode; required production secret names from `WORKER_CONFIG_CONTRACT` | Gemini, Tavily, R2 image storage, admin metrics, RevenueCat, and GCP fields by feature | Worker/Cloudflare owner through Wrangler vars, secrets, and bindings |
| Database | explicit selected project origin and target-specific credential for live work | loopback local origin; local credential | database owner through the target policy and task catalog |
| Metrics digest | explicit target, matching confirmation, and matching target credential | loopback local URL defaults only for `--target local`; production has no URL default | task operator through `target.mjs` |

Missing, blank, placeholder, insecure, cross-target, wildcard production, incomplete feature groups, malformed optional SDK identifiers, or malformed supplied inputs fail with only the input name and violated rule. The verifier hashes public client identifiers in compatibility records and never copies true credential values into attestations.

## Attached-resource inventory

Stable provider API paths are application code, not deploy configuration. Replaceable origins, project identifiers, credentials, buckets, and bindings are configuration.

| Consumer | Attachment | Locator class | Credential/binding class |
|---|---|---|---|
| Pages | Cloudflare Pages host; Worker; Supabase; OpenStreetMap tiles; pinned Supabase/Leaflet browser libraries | Pages/Worker/Supabase are deploy-varying; tile and pinned CDN paths are stable code dependencies | public browser identifiers only |
| Mobile | Worker; Supabase; RevenueCat; Google Maps; Wikidata SPARQL; Chronicling America; Wikipedia/Wikimedia; Internet Archive; Nominatim; Photon; OpenStreetMap tiles | Worker/Supabase/EAS project and public SDK identifiers are deploy-varying; public research endpoints are stable provider contracts | public app identifiers; no privileged provider credential in the client |
| Worker | Supabase; R2; Gemini; Tavily; WikiTree; Overpass; RevenueCat webhooks/management; Google BigQuery/OAuth | Supabase/R2 origins, project/bucket identifiers, and feature toggles are deploy-varying; stable API paths remain code | Wrangler secrets, vars, and `IMAGES` binding |
| Metrics digest | selected Supabase project | target origin is explicit per invocation | target-specific service-role key; read-only task behavior does not make the key read-only |

## Installed-client compatibility

`deploy/config/compatibility.json` currently retains:

- the verified-live Pages v69 generation, the v70 intermediate source generation, and the current v72 source generation, each bound to its exact cache ID and including both the Cloudflare Pages and legacy GitHub browser origins;
- the installed Android versionCode 15 production OTA generation;
- the Android versionCode 16 source boundary, which is not claimed to be live.

`currentGenerations` names the source boundary for each client component. Generation objects are immutable and append-only after their first Git commit; changing a locator creates a new generation instead of rewriting history. Older generations remain supported until a separate immutable retirement record exists, and their locators remain in every affected Worker/database attestation. Remote retention is still `unverified` until an explicitly approved, versioned read-only observation exists.

A generation becomes retired only when `retirements` contains all of these:

1. a sealed repository artifact proving adoption telemetry, enforced-version behavior, or installed-client verification;
2. a sealed owner-approval artifact with the matching generation scope;
3. canonical observation, approval, and retirement timestamps in chronological order;
4. exact artifact hashes, with the retiring generation no longer selected by `currentGenerations`.

Removing an old origin or locator before that transition fails repository validation. This protects installed apps and cached web clients from being stranded by an otherwise valid new release.

## Changing a supported locator

1. Append a new immutable generation and point that client in `currentGenerations` to it; leave installed generations unretired.
2. Change only that unit's declared boundary. Pages changes also require a new `sw.js` cache version and fingerprint.
3. Run `node tools/deploy-config.mjs attest --component <pages|mobile|worker|database>` and replace the matching committed attestation with that canonical output.
4. Run `node tools/deploy-config.mjs validate` and the complete repository verifier.
5. Review and merge the source separately from any platform action.
6. Request explicit approval before changing EAS, Cloudflare, Supabase, secrets, bindings, OAuth, webhooks, or production state.

For mobile, endpoint substitution is a versioned change to the public object at the `app.config.js` boundary; the shipped default is therefore the exact value the repository attests. Values in `expo.extra` are available to JavaScript through `expo-constants`, as verified by the repository tests. Google Maps and RevenueCat public SDK identifiers remain environment-injected. An explicit `GRAVESTORY_ENABLE_*=true` requires its matching key; existing EAS builds remain compatible because a pre-provisioned key with no new flag also enables and validates that feature. Explicit `false` rejects a still-supplied key, and missing enabled keys or placeholders fail. Their remote identities remain explicit `remote-unverified` compatibility fields until separately observed. A Google Maps native-key change requires the appropriate reviewed build rather than assuming an OTA can replace it.

## Release-provenance integration

`tools/release-control.mjs` accepts configuration authority only when the attestation is committed under `deploy/config/` at the exact reviewed source commit and that commit's `tools/deploy-config.mjs verify-attestation` reproduces its identity. An arbitrary JSON file, a stale identity, a rewritten generation, an incomplete compatibility set, or a self-declared `validation: "passed"` cannot satisfy the gate. Remote presence can become `attested` only with evidence bound to the exact configuration identity and Git commit, a sealed identity-scoped owner approval, an explicit list of enabled feature conditions, and fields that exactly cover required inputs plus those enabled features. Disabled feature fields are not claimed present.

This control remains non-deploying. Production release execution and remote configuration are separate approval gates.

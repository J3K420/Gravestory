# Cloudflare Pages URL Cutover Runbook

Last updated: 2026-07-13

This runbook moves every current GraveStory pointer and policy surface to Cloudflare Pages without breaking installed apps or Google Play policy links. It contains no credentials. The canonical public host is `https://gravestory.pages.dev/`.

## Current handoff status

| Surface | Local state | Remote state |
|---|---|---|
| Landing metadata and legal links | Reviewed source uses cache `gravestory-v69` and overlap-safe legal links | Live Pages is v68; reviewed 22-file redeploy pending |
| Mobile Privacy and Terms links | Prepared for BMAD review | Production OTA not yet published |
| Worker origin allowlist | Prepared with both new and legacy origins | Worker deployment not yet performed |
| Google Play source copy | Updated locally | Authenticated console fields and public listing not yet verified |
| Legacy GitHub Pages/repository visibility | Intentionally unchanged | Must remain available/public until every retirement gate passes |

Do not interpret a locally checked task as proof that a remote console or deployment is complete.

## Canonical endpoints

- Site: `https://gravestory.pages.dev/`
- Privacy policy: `https://gravestory.pages.dev/privacy-policy/`
- Terms: `https://gravestory.pages.dev/terms/`
- Account deletion: `https://gravestory.pages.dev/delete-account/`
- Social image: `https://gravestory.pages.dev/og-image.png`
- Service worker: `https://gravestory.pages.dev/sw.js`

## Cloudflare Pages deployment

The Cloudflare Pages project is named `gravestory`. It uses manual Direct Upload and is not Git-connected. A Git push does not deploy the site.

Stage only this 22-file allowlist in an otherwise empty directory, preserving paths. `docs/cloudflare-pages-manifest.txt` is the machine-readable source of truth:

```text
index.html
sw.js
og-image.png
css/base.css
css/home.css
css/maps.css
css/result.css
js/config.js
js/util-json.js
js/util-html.js
js/util-dom.js
js/auth.js
js/symbols.js
js/grave-markers.js
js/render-result.js
js/map-global.js
js/analytics.js
js/api-reports.js
privacy-policy/index.html
terms/index.html
delete-account/index.html
disclaimers/index.html
```

Never deploy the repository root: it contains private operational material and files that are not part of the public site. From the verified staging directory, compare every relative path to the committed manifest before upload:

```powershell
$manifestPath = '<repository>\docs\cloudflare-pages-manifest.txt'
$expected = Get-Content -LiteralPath $manifestPath | Where-Object { $_ } | Sort-Object
$root = (Get-Location).Path
$actual = Get-ChildItem -File -Recurse | ForEach-Object {
  $_.FullName.Substring($root.Length + 1).Replace('\', '/')
} | Sort-Object
$difference = Compare-Object -ReferenceObject $expected -DifferenceObject $actual
if ($difference -or $actual.Count -ne 22) {
  $difference | Format-Table
  throw 'Cloudflare staging directory does not match the reviewed 22-file manifest.'
}
```

Only after that command passes, run the production upload from the non-Git staging directory:

```powershell
Set-Location <verified-staging-directory>
npx wrangler pages deploy . --project-name gravestory
```

Cloudflare documents this Direct Upload workflow at <https://developers.cloudflare.com/pages/get-started/direct-upload/>. After upload, confirm Wrangler reports the production deployment and re-run every public endpoint check below.

Every change to a deployed web asset requires incrementing `const CACHE = 'gravestory-vN'` in `sw.js`. A documentation-only, mobile-only, or Worker-only change does not require a cache bump.

## Google Play Console handoff

These are authenticated external changes. Select GraveStory (`com.gravestory.app`) and update all four surfaces; saving one does not update the others.

1. **Privacy policy** — Policy and programs → App content → Privacy policy:
   - Set the designated URL to `https://gravestory.pages.dev/privacy-policy/`.
   - Save/submit and confirm the section is complete.
2. **Account deletion** — Policy and programs → App content → Data safety → Manage:
   - In the Data deletion questions, keep account deletion marked available in-app.
   - Set the required external web resource to `https://gravestory.pages.dev/delete-account/`.
   - Review the preview, save, and submit the Data safety update.
3. **Full description** — Grow users → Store presence → Main store listing:
   - Paste the current full description from `store-listing/description.md` so its privacy link is `https://gravestory.pages.dev/privacy-policy/`.
   - Save the listing change.
4. **Store-listing website** — Grow users → Store presence → Store settings → Store listing contact details:
   - Set Website to `https://gravestory.pages.dev/`.
   - Save the change.

Google requires a public, active privacy-policy URL and requires apps with account creation to provide both in-app deletion and a functional external deletion resource. References: <https://support.google.com/googleplay/android-developer/answer/10144311> and <https://support.google.com/googleplay/android-developer/answer/13327111>.

After Google processes the changes, open the public listing at `https://play.google.com/store/apps/details?id=com.gravestory.app` in a signed-out/private browser and verify:

- the full description contains no GitHub Pages policy URL;
- App support → Privacy Policy opens the Cloudflare Pages policy;
- the Data safety/Data deletion link opens the Cloudflare Pages deletion page;
- the developer website opens the Cloudflare Pages root.

Record the verification date and screenshots before retiring the old site. Managed publishing is off, so review and propagation status must be checked rather than assumed.

## Production mobile OTA handoff

The Settings link change is JavaScript-only, so it does not require a Play build or versionCode increment. Google Play currently serves versionCode 15 (owner-confirmed 2026-07-13); `mobile/app.config.js` reserves versionCode 16 for a future AAB and vc16 is not live. The OTA must still be published from the latest mobile baseline. Commit `c367395` is the minimum cutover ancestor because it already contains all mobile work known at handoff.

From the repository root after BMAD review and after the cutover commit exists:

```powershell
$reviewedCommit = git rev-parse HEAD
if (git status --porcelain) { throw 'Working tree is not clean; EAS would bundle unreviewed files.' }
git merge-base --is-ancestor c367395 HEAD
$mobileDiff = @(git diff --name-only c367395..HEAD -- mobile)
if ($mobileDiff.Count -ne 1 -or $mobileDiff[0] -ne 'mobile/src/screens/SettingsScreen.js') {
  $mobileDiff
  throw 'Cutover OTA contains unexpected mobile files.'
}
```

Record `$reviewedCommit`. The ancestry command must exit successfully, the entire repository must be clean, and the mobile diff must contain exactly `mobile/src/screens/SettingsScreen.js`. Any other mobile input requires a separate release decision and review.

From `mobile/`, inspect the production mapping. Record the current Android runtime and previous production Android update-group ID for rollback:

```powershell
npx eas channel:list
npx eas channel:view production
npx eas branch:view production
```

Do not continue if the production channel is missing, points somewhere unexpected, required production environment values are unavailable, the Android runtime is unexpected, or `git rev-parse HEAD` no longer equals `$reviewedCommit`. Publish only after those gates pass:

```powershell
npx eas update --branch production --environment production --platform android --message "Point policy links to gravestory.pages.dev"
```

Expo's channel/branch model and environment behavior are documented at <https://docs.expo.dev/eas-update/eas-cli/> and <https://docs.expo.dev/eas/environment-variables/>.

Verify on an installed production build:

1. Record the published Android update-group ID and confirm it is the latest group on the production branch with the expected runtime.
2. Force-close and reopen the app twice so the update downloads and applies.
3. Open Settings → Privacy Policy and confirm the Cloudflare Pages policy loads.
4. Open Settings → Terms of Service and confirm the Cloudflare Pages terms loads.
5. Exercise a basic existing screen to ensure the newer app baseline was not rolled back.

If the update regresses production, republish the previously recorded group:

```powershell
npx eas update:republish --group <previous-android-update-group-id> --platform android
```

Keep GitHub Pages live through publication, installed-app verification, and the rollback window. The owner must explicitly choose and record the rollback-window end after reviewing production update adoption; if no end is recorded, legacy retirement remains blocked.

## Worker overlap and deployment handoff

During the transition, `worker/wrangler.toml` must contain both origins:

```text
https://gravestory.pages.dev,https://j3k420.github.io
```

The Worker already parses `ALLOWED_ORIGIN` as a comma-separated allowlist. Never use `*` in production. After local BMAD review, deploy the reviewed Worker configuration separately:

```powershell
Set-Location worker
npx wrangler deploy
```

Verify both allowed origins and one disallowed origin without using any secret:

```powershell
$worker = 'https://gravestory-proxy.james-gravestory.workers.dev/'
$preflightHeaders = @{
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'content-type,x-client-key'
}
foreach ($origin in @('https://gravestory.pages.dev', 'https://j3k420.github.io')) {
  $headers = $preflightHeaders.Clone()
  $headers['Origin'] = $origin
  $response = Invoke-WebRequest -Uri $worker -Method Options -Headers $headers
  if ($response.StatusCode -ne 204 -or $response.Headers['Access-Control-Allow-Origin'] -ne $origin) {
    throw "Worker CORS verification failed for $origin"
  }
}
$headers = $preflightHeaders.Clone()
$headers['Origin'] = 'https://example.invalid'
$response = Invoke-WebRequest -Uri $worker -Method Options -Headers $headers
if ($response.Headers['Access-Control-Allow-Origin'] -in @('*', 'https://example.invalid')) {
  throw 'Worker accepted a disallowed origin or wildcarded production CORS.'
}
```

Do not remove the legacy origin until the owner approves final retirement; removal requires another reviewed Worker deployment.

## Public endpoint verification

Run after every Pages deployment and again immediately before legacy retirement:

```powershell
$checks = [ordered]@{
  '/'                = @{ Type = 'text/html';              Marker = 'https://gravestory.pages.dev/' }
  '/privacy-policy/' = @{ Type = 'text/html';              Marker = 'Privacy Policy' }
  '/terms/'          = @{ Type = 'text/html';              Marker = 'Terms of Service' }
  '/delete-account/' = @{ Type = 'text/html';              Marker = 'Delete Your Account' }
  '/disclaimers/'    = @{ Type = 'text/html';              Marker = 'Disclaimers' }
  '/og-image.png'    = @{ Type = 'image/png';              Marker = $null }
  '/sw.js'           = @{ Type = '(javascript|text/plain)'; Marker = "const CACHE = 'gravestory-v" }
}
foreach ($entry in $checks.GetEnumerator()) {
  $uri = 'https://gravestory.pages.dev' + $entry.Key
  $response = Invoke-WebRequest -Uri $uri -Method Get -MaximumRedirection 0 -ErrorAction Stop
  $contentType = [string]$response.Headers['Content-Type']
  if ($response.StatusCode -ne 200) { throw "Unexpected status for $uri" }
  if ($contentType -notmatch $entry.Value.Type) { throw "Unexpected content type for $uri: $contentType" }
  if ($entry.Value.Marker -and -not $response.Content.Contains($entry.Value.Marker)) {
    throw "Expected content marker missing from $uri"
  }
}
$sw = (Invoke-WebRequest -Uri 'https://gravestory.pages.dev/sw.js' -MaximumRedirection 0).Content
if ($sw -notmatch "const CACHE = 'gravestory-v(\d+)'" -or [int]$Matches[1] -lt 69) {
  throw 'Service-worker cache is older than gravestory-v69.'
}
```

Every request must return the expected resource without a redirect, and the service worker must report `gravestory-v69` or later. Also inspect the root document's canonical, Open Graph, Twitter image, and absolute footer policy destinations.

Immediately before retirement, verify the legacy pages still serve their overlap resources:

```powershell
$legacyOrigin = 'https://j3k420.github.io'
$legacyPaths = @('/Gravestory/', '/Gravestory/privacy-policy/', '/Gravestory/terms/', '/Gravestory/delete-account/')
foreach ($path in $legacyPaths) {
  $uri = $legacyOrigin + $path
  $response = Invoke-WebRequest -Uri $uri -Method Get -MaximumRedirection 0 -ErrorAction Stop
  if ($response.StatusCode -ne 200) { throw "Legacy overlap resource failed: $uri" }
}
```

For the source scan, exclude frozen history under `_bmad-output/planning-artifacts/` and the numbered `_bmad-output/implementation-artifacts/` records. They preserve the requirements and evidence that applied when GitHub Pages was the host and must not be rewritten. This exact command must return no match:

```powershell
rg -n 'https://j3k420\.github\.io/(Gravestory|gravestory-privacy)' . --glob '!_bmad-output/planning-artifacts/**' --glob '!_bmad-output/implementation-artifacts/[0-9]*' --glob '!.claude/**' --glob '!tools/fourthought/**'
```

The bare `https://j3k420.github.io` origin remains intentionally in transition instructions and the Worker allowlist.

## Retirement order

Complete these in order:

1. BMAD adversarial review and independent cutover validation pass with no untriaged blocker.
2. Cutover-only source commit is pushed to shared history.
3. Worker dual-origin configuration is deployed and verified.
4. Production OTA is published from the verified latest baseline and both installed-app links pass.
5. All four Google Play surfaces are updated; the signed-out public listing is verified after propagation.
6. Public Cloudflare and legacy-overlap endpoint checks pass again, and the owner records the production OTA rollback-window end.
7. The owner explicitly approves retiring the legacy host and changing repository visibility after that window.
8. Disable GitHub Pages and/or make the repository private as approved, then smoke-test the Cloudflare site and Play links again.
9. In a separate reviewed change, remove `https://j3k420.github.io` from the Worker allowlist, deploy, and verify.

If any gate before retirement fails, leave GitHub Pages enabled, leave the repository public, and leave the legacy Worker origin in place. If the post-retirement smoke test fails, immediately reverse the approved GitHub Pages/repository action, restore the legacy endpoint, and do not remove the legacy Worker origin.

## Final sign-off record

- [ ] Cutover commit pushed: `<commit>`
- [ ] Cloudflare Pages deployment verified: `<deployment URL/ID/date>`
- [ ] Worker dual-origin deployment verified: `<version ID/date>`
- [ ] Production Android OTA group/runtime verified on installed app: `<group/runtime/date>`
- [ ] OTA rollback window ends: `<date/owner decision>`
- [ ] Google Play privacy policy verified publicly: `<date>`
- [ ] Google Play account-deletion link verified publicly: `<date>`
- [ ] Google Play full description verified publicly: `<date>`
- [ ] Google Play website verified publicly: `<date>`
- [ ] Play verification screenshots/evidence: `<path>`
- [ ] Owner approved legacy retirement: `<date/approval>`
- [ ] GitHub Pages/repository action completed: `<date/action>`
- [ ] Legacy Worker origin removed and verified: `<date>`

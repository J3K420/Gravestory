# GraveStory — Data Safety form answers (Play Console)

> Derived from an actual code audit of `mobile/` (2026-06-25), not a template. Google
> cross-checks these against real app behavior/permissions, so every line maps to a real
> data flow. File evidence is in the project; this is the paste-ready summary.

Path in Console: **App content → Data safety** (or Policy → App content → Data safety).
The form has 3 stages: **Overview questions → Data types → Security practices**.

---

## Stage 1 — Overview questions

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | It collects location, photos, account info, purchases, analytics. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Every endpoint is HTTPS (Supabase, Worker, Gemini, R2, RevenueCat, Nominatim, Photon, Wikidata, Wikipedia, LoC, IA). |
| Do you provide a way for users to request that their data be deleted? | **Yes** | In-app account deletion (Settings → type-DELETE) **and** a public web URL: `https://gravestory.pages.dev/delete-account/`. Provide that URL when asked. |

> "Collected" = leaves the device. "Shared" = sent to a third party separate from you. Google
> treats your own backend (Supabase/Worker/R2) as "you," but a third-party **processor**
> (Gemini, RevenueCat, the geocoders) is exempt from "shared" if it's an on-your-behalf
> **service-provider** relationship (processes data only on your instruction, doesn't build its
> own profiles). **VERDICT (2026-06-25, confirmed against Google's Data safety doc + RevenueCat's
> own guidance): all of GraveStory's third parties qualify as service providers, so the correct
> answer is "Collected, NOT shared" for everything.**
> - **Gemini** returns OCR on your instruction → exempt.
> - **RevenueCat** explicitly tells devs to mark purchase history "Collected" (service provider);
>   only flip to "Shared" if you wire RevenueCat→3rd-party integrations (we do NOT — code only
>   calls configure/logIn/logOut/getOfferings/purchasePackage/restorePurchases).
> - **Nominatim/Photon/Tavily/WikiTree/Wikidata/Wikipedia/LoC/IA** return geocoding/search
>   results on request; research queries carry DECEASED people's names from public memorials.
> So the Play preview showing **"No data shared with third parties" is CORRECT** for this app.

---

## ⚠️ Two minor items to double-check in the live form (neither blocks)
1. **"Name" (Personal info)** — the editable display name is shown PUBLICLY on the community
   map ("Shared by {name}"). If users have a display name, declare **Name = Collected**
   (purpose: App functionality + Account management) in addition to Email. Confirm it's ticked.
2. **Account-creation method** — the app is **OAuth-only** (no in-app password). Ticking
   "Username and password" too is low-risk but strictly the accurate answer is **OAuth only**.

## Stage 2 — Data types to DECLARE (collected; NOT shared — see verdict above)

For each: mark **Collected = Yes**. **Processed ephemerally?** = No for anything stored (most
of these persist in Supabase); the AI image call could be argued ephemeral but it's safer to
say collected. **Required vs optional** as noted. **Purpose** as noted.

### Location → **Precise location**
- Collected: **Yes** · Shared: **Yes** (sent to Nominatim/OpenStreetMap + Photon/komoot for
  geocoding; also stored in your Supabase and shown as a map pin).
- Purpose: **App functionality** (place the grave on the map; resolve place/cemetery names).
- Optional: it's core to mapping but the user chooses camera/GPS — mark **Required** to be safe
  (the feature depends on it). User can use the app without granting GPS (EXIF/manual), so
  "Optional" is also defensible; pick Required for honesty about the core experience.

### Photos and videos → **Photos**
- Collected: **Yes** · Shared: **Yes** (the gravestone photo is sent to **Google Gemini** for
  OCR/verification, and stored in **your Cloudflare R2**; public stories show the photo on the
  community map gallery).
- Purpose: **App functionality**.
- Required: **Yes** (the photo IS the input to the app).

### Personal info → **Email address**
- Collected: **Yes** (from Google sign-in) · Shared: **No** (stays in your Supabase/Google IdP).
- Purpose: **Account management**, **App functionality** (sync).

### Personal info → **Name**
- Collected: **Yes** (Google display name; editable) · Shared: **Yes** (published as the
  "Shared by {name}" contributor label on the public community map, by design).
- Purpose: **App functionality**, **Account management**.

### Personal info → **User IDs**
- Collected: **Yes** (Supabase user UUID) · Shared: **Yes** (sent to **RevenueCat** as the
  app-user id to attach purchases).
- Purpose: **App functionality**, **Account management**.

### Financial info → **Purchase history**
- Collected: **Yes** · Shared: **Yes** (**RevenueCat** processes purchase/transaction data;
  Google Play handles the actual payment).
- Purpose: **App functionality** (grant scan credits).
- Note: no payment-card data touches your app — do NOT declare "Payment info"/card numbers.

### App activity → **App interactions** (and other user-generated content)
- Collected: **Yes** · Shared: **No** (first-party analytics in your own Supabase
  `analytics_events`; no Google Analytics/Firebase/third-party analytics SDK).
- Purpose: **Analytics**.

### App activity / Messages-style → **Other user-generated content**
- This covers the **inscription text, OCR'd names/dates of the DECEASED, and the generated
  biography**. These are sent to research APIs (Tavily, WikiTree, Wikidata, Wikipedia,
  Chronicling America, Internet Archive) and to Gemini.
- Collected: **Yes** · Shared: **Yes** (the research APIs above).
- Purpose: **App functionality**.
- Context note (not a form field): these are names of *deceased* people from public memorials,
  and living-relative names are redacted before any PUBLIC display.

---

## Stage 2 — Data types to NOT declare (verified absent)

- **Advertising ID / AD_ID** — no ad SDK in the project. ⚠️ ONE CHECK: confirm RevenueCat and
  Google Maps don't pull `com.google.android.gms.permission.AD_ID` into the merged manifest
  (see action item below). If it's absent, declare nothing here.
- **Device ID / fingerprint** — `device-id.js` exists but is **dead code (no call site)**, so
  nothing is collected. Declare nothing unless a future build wires it up.
- **Payment card / bank info** — Google Play Billing handles payment; your app never sees it.
- **Contacts, calendar, SMS, call logs, microphone, health, browsing history** — none used.

---

## Stage 3 — Security practices
- **Encrypted in transit: Yes.**
- **Users can request deletion: Yes** — provide `https://gravestory.pages.dev/delete-account/`.
- **Committed to Play Families Policy?** — N/A (not a children's app; target audience 18+).
- **Independent security review** — optional; you can leave it unmarked (no formal audit done).

---

## ⚠️ One action item before submitting this form
**Verify the AD_ID permission.** RevenueCat or the Google Maps SDK *can* transitively add
`com.google.android.gms.permission.AD_ID` to the merged AndroidManifest. If it's present you
MUST either declare the Advertising ID as collected, OR add a manifest removal:
```xml
<uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />
```
Check the merged manifest from your production AAB (or RevenueCat's data-safety doc). This is
the only item the code audit couldn't fully resolve from JS source.

> A "Data safety" declaration that mismatches the app's real permissions/SDK behavior is a top
> rejection cause and can block future updates — which is exactly why this is audited from code.

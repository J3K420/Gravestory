# GraveStory — Production Access Questionnaire (answers)

**App:** GraveStory · `com.gravestory.app`
**Account type:** Personal (12-tester / 14-day requirement applies)

> These answers are tailored to what GraveStory **actually did** during closed testing —
> not the generic template. They are honest and specific (Google rejects vague answers and
> rewards a real "feedback → change" story). Two template items were intentionally NOT
> claimed because they weren't done: a password eye-icon (the app is **Google sign-in only**,
> so there is no password field — the suggestion is moot) and a dynamic onboarding walkthrough
> (deferred). Edit freely to sound like you.

---

### 1) How did you recruit users for your closed test? (friends/family, paid provider, etc.)

We recruited testers two ways: through a dedicated app-testing community that provides real
Android-device testers who opt in for the full 14-day period, and by inviting a handful of
friends to install and try the app. Together this gave us enough engaged testers to cover
the core flow on real devices throughout the testing window.

### 2) How easy was it to recruit testers for your app?

Reasonably easy. A dedicated Android-tester community filled most slots quickly and a few
friends covered the rest. The harder part wasn't recruiting — it was sustaining active,
repeated engagement across the full 14 days, which we managed by keeping testers updated as
we shipped fixes during the window.

### 3) Describe the engagement you received from testers during your closed test.

Testers were actively engaged throughout the 14-day test, opening the app across multiple
sessions on real Android devices and exercising the core flow end-to-end — photographing
real gravestones, generating biographies, viewing them on the personal cemetery map,
correcting grave-pin locations, and trying the community map and sharing features. Because
several testers scanned stones outdoors in real cemeteries, their usage exercised the GPS,
camera, and research pipeline under real conditions, which surfaced concrete location- and
accuracy-related issues we then fixed (see Q4 and Q8) alongside polish and store-presentation
suggestions.

### 4) Provide a summary of the feedback you received, and how you collected it.

We collected feedback through a written tester report and direct communication (messages and
a shared notes doc). The feedback fell into two buckets:

**Issues testers surfaced that we fixed:**
- **Grave pins landed roughly 20 metres off** when scanning outdoors, because consumer-phone
  GPS isn't precise enough for individual graves. We responded by adding a prominent
  drag-to-place prompt and a "needs placing" badge so users can correct each pin, and we
  improved the GPS capture itself.
- A corrected pin could **revert to its old location** after picking a map marker — a
  cross-screen state bug we traced and fixed.

**Polish / presentation suggestions we acted on:**
- More **feature-focused store screenshots** that show real features (scanning a stone,
  viewing a biography, the community map) rather than generic frames.
- Adding a **"Rate the App"** option so users can rate from inside the app.
- A couple of onboarding/UI polish ideas.

No crashes or app-breaking defects were reported, but the test did surface real correctness
issues — mostly around GPS/location accuracy — which is exactly what we needed real-device,
outdoor testing to catch before launch.

### 5) Who is the intended audience for your app?

GraveStory is built for genealogists, family historians, and anyone who visits cemeteries
to research or remember loved ones — generally an adult audience, given the subject matter
(death, historical records) and the AI-generated biographical content. It serves people who
want to learn about and preserve the stories of the people buried at the gravestones they
photograph, and to connect those discoveries to the wider record of family and local history.

### 6) Describe how your app provides value to the users.

GraveStory turns a single photo of a gravestone into a respectful, source-cited
biographical story about the person buried there. It reads the inscription, identifies the
person, and researches public genealogy and historical records (WikiTree, Wikidata,
Wikipedia, the Library of Congress newspaper archive, and others) to assemble a biography
with citations the user can verify. Stories are saved to a personal cemetery map, and users
can optionally share them on a community map to help others. Every biography is clearly
labeled as AI-assisted and includes a way to report problems, so the value comes paired
with transparency about accuracy.

### 7) How many installs do you expect in your first year?

1k – 10k.

### 8) What changes did you make to your app based on what you learned during your closed test?

We shipped multiple over-the-air updates **during** the testing window. The changes came from
two sources — issues testers raised, and additional hardening we did ourselves while preparing
for production:

**Driven by tester reports:**
- Added a prominent **drag-to-place pin prompt** and a **"needs placing" badge** after testers
  found grave pins landing ~20 m off outdoors (consumer GPS can't pinpoint an individual grave),
  plus improved GPS capture.
- Fixed a bug where **picking a map marker reverted a pin** the user had already corrected.
- Added a **"Rate GraveStory"** button in Settings (native in-app review with a Play Store
  fallback), at a tester's suggestion.
- Produced **feature-focused store screenshots** showing the real scanning, biography, and
  community-map experience instead of generic device frames.

**Our own hardening during the window:**
- Strengthened **privacy and safety**: an in-app **account-and-data deletion** flow (plus a
  public deletion page), an **AI-content disclaimer** on every biography, a **"Report a
  problem"** button on every story, and a safeguard that **removes the names of living
  relatives** from any biography shared to the public community map.
- Fixed several **research-accuracy** issues found through our own adversarial self-review
  (e.g. a wrong-portrait case where a name matched the wrong public figure), and polished the
  result and home screens.


### 9) How did you decide that your app is ready for production?

The closed test ran the full flow on real Android devices outdoors over 14 days and surfaced
concrete correctness issues — most importantly GPS grave-pin accuracy — which we fixed and
re-shipped during the window; no crashes occurred. We resolved every issue the test surfaced
before applying. We also confirmed the app meets Google Play's account
and content requirements: an in-app and web account-deletion path, an accurate Data safety
declaration, an AI-content disclaimer and a "Report a problem" mechanism on every generated
story, and privacy protections for living people named in shared content. With the core
experience stable across devices, the issues from real-world testing fixed, and the policy
and safety groundwork complete, we're confident it's ready for a production launch.

### 10) What did you do differently this time? *(re-applicants only — this question normally appears ONLY if a previous application was rejected; skip on a first submission)*

We treated the closed test as a real quality gate rather than a formality: we acted on
specific tester feedback, and we used the testing window to harden the parts of the app that
matter most for a product about real, deceased people — accuracy transparency, content
reporting, account deletion, and protecting the privacy of living relatives named in shared
stories. The result is a more polished, more trustworthy app than when testing began.

---

## Notes before you submit

### About the questionnaire itself
- **Pick the install band you actually believe** (Q7). A modest, honest number is safer than
  an inflated one.
- **Engagement is the #1 rejection reason in 2026** — Google checks that testers *actively
  used* the app, not just installed it. Make sure your 12 testers opened the app across the
  14 days (ideally every few days). The questionnaire answers won't save a test where testers
  installed Day 1 and never returned.
- **Avoid the "no issues / here are my fixes" contradiction** — reviewers read "no bugs found"
  as thin testing. The answers above now name a few *real* issues testing surfaced (GPS pins
  ~20 m off, the marker-pick pin revert), which makes the test look more serious, not less.
- **Complete it in one sitting** — there is no reliable draft-save; quitting mid-form can lose
  your answers. Paste from this file, go Next → Next → **Apply**.
- Everything stated above is true to what shipped. If you add your own wording, keep it
  specific and avoid claiming anything you didn't build.
- Q10 normally appears **only if a prior application was rejected** — on a first submission you
  likely won't see it.

### ⚠️ The two things most likely to get GraveStory bounced (fix BEFORE applying)
1. **App access / reviewer login (App content → App access). YOUR #1 RISK — ✅ DONE & VERIFIED.**
   Guests get **0 scans** and sign-in is **Google-OAuth-only**, so the reviewer is given a Google
   account's credentials and signs in via "Continue with Google".

   **Account provided: `gravestory.test@gmail.com` / `fricks3k`.** Verified 2026-06-25:
   - ✅ `is_unlimited` SQL run — logged in on a real device, scans show **unlimited**.
   - ✅ Google OAuth login works on the real build (no fallback login exists, so this matters).
   - ✅ 2-Step Verification is **OFF** on the account (reviewer signs in from their own infra;
     2SV would lock them out).
   - ✅ "Full access to all features incl. premium/paid content" checkbox ticked in the form.

   **App access "Any other information" box — pasted (do NOT leave it as a one-liner):**
   ```
   Sign-in is Google OAuth only (no email/password screen in the app).
   1. Open app, tap "Sign In", then "Continue with Google".
   2. In the Google screen, sign in to the account provided above
      (gravestory.test@gmail.com / fricks3k) - do NOT use a different account.
   3. This account has unlimited scans. On the home screen, tap to scan,
      then photograph or pick any gravestone image; a biography generates
      in ~20-40 seconds. The community map and bios are browsable too.
   ```
2. **Data safety form** must match reality: declare **Location** (device GPS + EXIF), **Photos**
   (gravestone images → R2/Supabase), **account/personal info** (Supabase auth, display name),
   and **purchase history** (RevenueCat). Encryption in transit = yes; declare the deletion path
   (you have in-app + web). A mismatch vs your actual permissions/SDKs is a top rejection cause.

### Other App content declarations that must be GREEN to publish
- **Privacy policy**: live URL covering photos/location/account: `https://gravestory.pages.dev/privacy-policy/`.
- **Content rating (IARC)**: submit the questionnaire — rate truthfully (AI bios can surface
  death/illness/historical-violence content).
- **Target audience**: select **adults (18+ / not under-13)** — consistent with Q5. (This
  section unlocks only after Ads + App access + Privacy policy are done.)
- **Ads**: declare **No ads** (confirm no transitive ad SDK pulls in the `AD_ID` permission).
- **Advertising ID**: declare **not used** — and make sure no SDK injects `AD_ID` in the
  manifest, or the declaration mismatches.
- **Financial features**: certify **"none"** — don't skip it. Your RevenueCat in-app purchases
  are billing, *not* a declared financial feature.
- **Government / Health / News / COVID-19**: all **No**.
- **Store listing assets present**: 512² icon, **feature graphic 1024×500** (required to
  publish), ≥4 phone screenshots ≥1080px, title/descriptions within limits.
- **Build targets API 35+** (required since Aug 31, 2025).

### After approval (so it's not a surprise)
- Approval **unlocks** the Production track — it does **not** publish. You then create a
  production release, upload the final AAB, set **country availability**, and **Start rollout**.
- **Your first production release cannot use a staged/percentage rollout** — that's updates-only.
  v1 goes to **100%** of your selected countries at once when its review passes.
- That first build then goes through its **own** review (~1–7 days), separate from this
  production-access review (~7 days). Budget ~1–2 weeks end-to-end to public listing.

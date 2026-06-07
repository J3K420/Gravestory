# GraveStory — Monetization & Anti-Abuse Recommendations

**Scope:** Product monetization angles and free-tier enforcement strategies.  
**Date:** June 2026

---

## Context

GraveStory's core loop — photograph a stone, get a biography — has genuine emotional value for families visiting cemeteries. That value is the monetization lever. The goal is a free tier that is useful enough to hook users and limited enough that people who get real value will pay, without requiring aggressive paywalls that kill word-of-mouth growth in cemeteries (exactly the wrong place to annoy someone).

---

## Monetization Angle 1: Freemium scan limits

**Model:** Free users get a fixed number of scans per month (suggested: 5–10). Paid subscribers get unlimited scans.

This is the most conventional SaaS freemium model and the easiest to implement, but it is also the weakest on its own because monthly limits reset and are trivially gamed with multiple accounts (see Anti-Abuse section below). It works best as a layer on top of a lifetime save limit rather than as the primary gate.

**Implementation notes:**
- Track scan count in `user_metadata` (Supabase Auth) so it survives device switches.
- Increment on successful biography generation, not on image upload — punishing failed scans is a bad UX.
- Reset on the 1st of each month via a Supabase scheduled function or client-side check against a `scan_reset_date` field.
- Guest users (not signed in) get a smaller allowance (suggested: 2 scans per device per month), enforced via device fingerprint (see Anti-Abuse section).

**Limitations:**
- Monthly resets mean a determined non-payer waits out the clock. Alone, this is not a strong conversion mechanism.
- Works best combined with the lifetime save limit (Angle 2) which has no reset.

---

## Monetization Angle 2: Lifetime save limit on free tier (primary conversion lever)

**Model:** Free accounts can save a maximum of 10–15 stories total — not per month, ever. Paid subscribers have unlimited saves.

This is the recommended primary monetization mechanism because it attacks the core value proposition of the app rather than just the scan rate. The app's long-term value is a growing personal archive of family history. A 10-story cap means:

- Casual visitors (1–3 scans of a grandparent's stone) are unaffected and remain enthusiastic recommenders.
- Genealogy-motivated users — exactly the people most likely to pay — hit the wall naturally as their collection grows.
- Multi-accounting breaks the value proposition: a user with their family split across three accounts cannot browse, share, or export their complete family history. The fragmentation is the punishment.

**Suggested tier structure:**

| Tier | Saved stories | Scans/month | Export | Price |
|---|---|---|---|---|
| Free | 10 lifetime | 5 | None | $0 |
| Standard | Unlimited | Unlimited | PDF, shareable link | $3–5/month or $25/year |
| Family | Unlimited | Unlimited | PDF, GEDCOM, family tree sharing | $7–10/month or $60/year |

**Implementation notes:**
- Store `stories_saved_count` as a running total in `user_metadata` or derive it with a Supabase count query on the `stories` table (soft-deleted rows should not count toward the limit — only live rows).
- Gate the save action in `persistence.js` (`storyToRow` / `cloudSaveStory`) before writing to Supabase: check count, return a structured error if at limit rather than silently failing.
- Show a progress indicator in Settings ("7 of 10 stories saved") so users feel the limit approaching rather than hitting a wall without context.
- Deleting a saved story should decrement the count — users who delete old scans to make room are fine; the app should reward curation, not punish it.

---

## Monetization Angle 3: One-time memorial purchases

**Model:** Any user (free or paid) can pay a one-time fee of $3–10 to publish a permanent, shareable memorial page for a specific biography.

This targets the emotional peak of the experience — the moment a family member reads a biography about their great-grandmother and wants to share it at the funeral, send it to cousins, or print it for the family reunion. A subscription ask at that moment feels wrong; a one-time "publish this memorial" purchase feels proportionate.

**What the purchase unlocks for a single story:**
- A permanent public URL (`gravestory.app/memorial/{slug}`) that does not require the viewer to have an account.
- A print-ready PDF with the biography, gravestone photo, portrait (if found), and sources list.
- An optional QR code for physical printing (stick it inside a memory box, a scrapbook, or the family Bible).
- The story remains in the purchaser's account even if they later cancel a subscription.

**Implementation notes:**
- Use RevenueCat (already planned for Phase 9) with a consumable product rather than a subscription — one purchase per story.
- Store `is_published` and `published_slug` on the `stories` row. Published stories are served from a lightweight public-facing route, distinct from the authenticated app.
- The shareable URL should work without the GraveStory app installed — this is the marketing surface. Every shared memorial is a referral.
- Price point: $4.99 is a reasonable anchor in app stores. $9.99 for a "family bundle" that publishes up to 5 stories at once.

---

## Monetization Angle 4: Family tree export / GEDCOM as a paid feature

**Model:** Export the user's full collection as a GEDCOM file (the universal genealogy format, importable into Ancestry, FamilySearch, MyHeritage, and desktop genealogy software) gated behind the Family tier or a one-time purchase.

GEDCOM export is low-cost to implement (it is a text serialisation of structured data the app already holds) and high-perceived-value to anyone doing serious genealogy work. It signals that GraveStory is a serious research tool, not just a novelty camera app.

**What to export:**
- Each saved story becomes a GEDCOM `INDI` (individual) record.
- Birth/death dates and locations from `graveData` map to `BIRT`/`DEAT` facts.
- Cemetery location maps to a `BURI` fact.
- The biography text and source URLs map to `NOTE` and `SOUR` records.
- Spouse/family relationships (if the app later infers them from multi-subject stones or WikiTree data) map to `FAM` records.

**Implementation notes:**
- GEDCOM generation can run entirely client-side — no server cost. A small JS library (`gedcom-parser` on npm, or a hand-rolled serialiser given the simple schema) is sufficient.
- Gate the export button in Settings behind a subscription check.
- Offer a preview of the first 3 records to free-tier users so they understand what they would get.

---

## Monetization Angle 5: FamilySearch / Ancestry sync as a premium integration

**Model:** Paid users can push their GraveStory biographies back to FamilySearch (free to implement, using the authenticated FamilySearch API) or Ancestry (if/when an API becomes available) as a premium integration.

For a genealogist, having their grave-scan data automatically appear in their existing family tree is significant time savings. This feature is only meaningful for users who are already invested in genealogy software — exactly the users most willing to pay.

**FamilySearch push (realistic near-term):**
- When a user scans a grave and GraveStory finds or creates a WikiTree/FamilySearch match, offer to push the new biography, dates, burial location, and source URLs back to the matched FamilySearch person record.
- Requires the user to authenticate with their own FamilySearch account (standard OAuth). This is a premium-tier action only — the `unauthenticated_session` grant used for searching (see search-improvement-recommendations.md, Rec. 2) cannot write.
- Write the story text as a `Memory` (FamilySearch Memories API) attached to the matched person. Write corrected dates as proposed edits (FamilySearch flags these for community review rather than auto-applying them).

**Limitations:**
- Ancestry has no public write API. This is FamilySearch-only for the foreseeable future.
- Users must have a FamilySearch account and must grant GraveStory OAuth access. The OAuth flow adds friction — position this as a power-user feature, not a core one.

---

## Monetization Angle 6: Cemetery and genealogical society partnerships / white-label

**Model:** License GraveStory as a white-label tool to cemetery trusts, historical societies, and genealogical organisations that want to offer a scanning tool to their members or visitors.

This is a B2B revenue layer on top of the consumer app. A cemetery trust that wants to digitise 10,000 stones pays a flat annual fee; their staff use a branded version of the app with results stored in the trust's own Supabase project. The underlying tech is identical.

**Potential partners:**
- National cemetery associations (e.g., American Cemetery Association, Commonwealth War Graves Commission equivalent organisations).
- County genealogical societies — many run volunteer scanning programmes and would benefit from AI-assisted biography generation.
- Library and archive systems running headstone photography projects.

**What a white-label license includes:**
- Custom app branding (logo, colours — the existing theme system in `theme.js` makes this straightforward).
- Results exported to the organisation's own storage rather than the shared public map.
- Bulk scan mode: no verification step, streamlined UI for rapid sequential scanning.
- Annual flat-rate pricing based on expected scan volume.

**Limitations:**
- This is a sales-led motion, not a product-led one. It requires outreach, contracts, and support — not worth pursuing until the consumer product has proven itself. Flag for Phase 10+.

---

## Anti-Abuse: Preventing Multi-Account Free Tier Gaming

The core risk with any save or scan limit is that motivated users create multiple email accounts. The recommendations below are layered defences — apply them in order of implementation difficulty.

### Layer 1: Lifetime save limit (structural, already covered above)

The save limit is the first line of defence because it is structural, not technical. A user with 10 accounts has 10 fragmented collections that cannot be merged. The app becomes less useful the more accounts they create. No fingerprinting required to make this work at a basic level.

### Layer 2: Device fingerprinting for guest and new-account limits

**Recommended implementation:** On first app launch, generate a stable device identifier using `expo-device` hardware properties and hash it. Store the hash in AsyncStorage as `gs_device_id`. Attach it to all Supabase auth sign-ups and scan events as a `device_id` metadata field.

```js
// In a new device-id.js module (mobile/src/lib/)
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'gs_device_id';

async function generateDeviceId() {
  // Combine stable hardware properties into a single hash input.
  // modelId and osBuildFingerprint are stable across app reinstalls.
  const raw = [
    Device.modelId || '',
    Device.osBuildFingerprint || '',
    Device.osInternalBuildId || '',
    Device.brand || '',
  ].join('|');

  // Simple djb2 hash — no crypto dependency needed for a device hint.
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return 'dev_' + Math.abs(hash).toString(36);
}

export async function getOrCreateDeviceId() {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = await generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
```

**How to use it:**
- Pass `device_id` as `user_metadata` on sign-up: `supabase.auth.signUp({ ..., options: { data: { device_id } } })`.
- A Supabase Edge Function or database trigger can count distinct `user_id`s per `device_id`. When a device has registered more than 2–3 accounts, new accounts from that device start at a lower scan allowance (e.g., 2 scans rather than 5) without showing any error message. Silent soft-limiting avoids revealing the detection mechanism.
- This is a hint, not a hard block. A user who buys a new phone or reinstalls the app should not be penalised. Do not hard-block based on device ID alone.

**Limitations:**
- `expo-device` properties are available on physical devices but may be empty in simulators. Add a random UUID fallback for simulator runs.
- Device ID is not stable across factory resets. That's acceptable — someone doing a factory reset to abuse a free tier is a high-effort attacker.
- This does not work on web (the PWA version). Web abuse is better addressed by IP-rate-limiting at the Cloudflare Worker level.

### Layer 3: Phone number verification for save limit upgrade

**Recommended approach:** Do not require phone verification at sign-up — that friction kills conversion. Instead, gate the "upgrade from 10 to unlimited saves" path on a verified phone number, even for paid subscribers.

When a free user hits their 10-story limit, the paywall screen offers two paths:
1. Subscribe (paid).
2. Verify your phone number to get 5 bonus stories (free, one-time).

The phone verification path is not about the 5 bonus stories — it is about binding one phone number to one account. A user farming free tiers needs a unique SIM per account, which is a much higher barrier than a unique email address.

**Implementation:**
- Use Supabase Auth's built-in phone OTP (Twilio integration). Supabase free tier includes a small number of SMS per month; Twilio pricing is ~$0.0075/SMS.
- Store `phone_verified: true` in `user_metadata` after successful verification.
- A Supabase database trigger can check whether the same phone number is already `phone_verified` on another account and flag it (do not block — just flag for manual review if abuse patterns emerge).
- Do not show this path to users who have already subscribed — they should not be asked to verify a phone number after paying.

### Layer 4: Paid tier value design (the most important layer)

The strongest anti-abuse mechanism is making the paid tier genuinely worth paying for. A user who is annoyed at juggling accounts is a user who is getting real value from the app. The free tier should be designed so that the limitation is felt in the right place — when the user wants to keep using the app — not in a way that makes the app feel broken or hostile.

**Principles:**
- Free tier should work completely for a single gravestone visit. A family visiting one grave, generating one biography, viewing it, and sharing it should hit zero limits.
- The limit should be felt when the user starts to build a collection — at story 8 or 9, not at story 1.
- The paywall screen should show the user what they have built ("You have 9 stories from 4 cemeteries") before asking them to pay. The collection itself is the sales pitch.
- Never disable the camera or block viewing of already-saved stories on a free account. Blocking access to existing content feels punitive and drives churn, not upgrades.

---

## Summary: Recommended Anti-Abuse Stack

| Layer | Mechanism | Effort | Effectiveness |
|---|---|---|---|
| 1 | Lifetime save limit (not monthly) | Low — already in persistence layer | High — structural, not technical |
| 2 | Device fingerprint soft-limit on new accounts | Medium — new module + Supabase metadata | Medium — catches casual multi-accounters |
| 3 | Phone verification for save upgrade | Medium — Supabase phone OTP | High for motivated abusers; adds friction to the upgrade path |
| 4 | Paid tier value design | Design work, not engineering | Highest — users who get value pay rather than game |

Apply all four. Layers 1 and 4 are the most important and cost nothing to implement beyond product design decisions.

---

## Implementation Order

1. **Lifetime save limit (Angle 2 + Layer 1)** — implement the save count check in `persistence.js` and the Settings progress indicator. No new infrastructure.

2. **One-time memorial purchase (Angle 3)** — high emotional resonance, RevenueCat consumable product, public memorial URL. Best first paid feature because it is not a subscription ask.

3. **Device fingerprinting (Layer 2)** — add `device-id.js`, pass `device_id` at sign-up. Passive — no visible UX change for legitimate users.

4. **Phone verification gate (Layer 3)** — wire Supabase phone OTP to the paywall screen's "get 5 bonus stories" path.

5. **GEDCOM export (Angle 4)** — client-side serialisation, gate behind Family tier. Low engineering cost, high perceived value for genealogy users.

6. **Subscription tiers (Angles 1 + 2 combined)** — Standard and Family tiers via RevenueCat. Do this after one-time purchases are proven, so the pricing is informed by what users actually pay for.

7. **FamilySearch sync (Angle 5)** — power-user feature, requires FamilySearch OAuth. Phase 9+ scope.

8. **White-label / partnerships (Angle 6)** — sales-led motion, Phase 10+ scope.

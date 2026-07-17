# Late-Summer 2026 Market Activation Plan

> **Status:** active execution plan, adopted 2026-07-16.
> **Window:** preparation now through August 21; earned-media outreach August 24–September 18;
> measurement through the October 9 operating decision; slower editorial response windows remain open
> until their documented close dates.
> **Authority:** this file replaces the old "launch immediately" timing in `gtm-strategy.md` §4.
> The positioning, NEVER-SAY list, channel verdicts, pitch copy, and one-follow-up rule remain in force.
> This plan supersedes stale timing, move numbers, batch-sitting instructions, and launch wording in
> `demo-clip-script.md`, `local-press-pitch.md`, and `outreach-emails-wave2.md`. Those files remain source
> assets, not schedule authority, until the protected owner-edited copies are reconciled.
> **External-state boundary:** this document schedules owner actions; it does not authorize Play Console,
> EAS, Supabase, reviewer-access, production-data, or other external mutations. Each such action keeps its
> existing approval and verification gate.

## 1. The decision

Do **not** spend GraveStory's first coordinated market push in mid-July heat. The app is already live,
so there is no store deadline forcing a launch-day spike. Use the next five weeks to finish the assets,
verify the installed experience, and make every borrowed visitor land on a credible listing.

The first coordinated activation is a **two-week earned-media window, September 8–18, 2026**. It begins
the day after Labor Day and includes National Grandparents Day on Sunday, September 13. Advance pitches
start August 24 so gatekeepers have time to look at the app. The second week also opens the editorial
runway for October Family History Month.

This is deliberately a window, not a single launch day:

- a solo founder cannot make eight editors answer on one date;
- an app that is already on Google Play should not pretend to be newly released;
- a staggered window lets one response or feature become social proof for the next pitch;
- missing one day because of weather, work, or a support issue does not waste the whole campaign.

Call it GraveStory's **first coordinated market push** or **late-summer market activation** internally.
Externally, simply pitch the product and the timely story angle. Do not claim a new product launch.

## 2. Campaign thesis

### The one sentence

> Photograph a gravestone and GraveStory turns the inscription plus verified public records into a
> source-cited life story.

### The seasonal bridge

> As families turn toward grandparents, family stories, and fall genealogy projects, GraveStory offers
> a simple way to discover the documented life behind a name on a stone.

Use that bridge only where it fits. Grandparents Day is a respectful editorial reason to look at family
stories, not a discount holiday and not permission to imply that every grandparent is deceased.

### The proof sequence

Every pitch should make the same three points, in this order:

1. **Show the transformation:** one gravestone photo becomes a readable life story.
2. **Show the trust mechanism:** named public sources and citations; thin records produce a short,
   honest result instead of invented depth.
3. **Remove the buying objection:** Android, three free scans, then one-time credit packs; no subscription.

Do not add new uniqueness claims. The NEVER-SAY list in `gtm-strategy.md` §2 remains the hard boundary.

## 3. Dated execution calendar

### July 16–31 — readiness, not reach

- Reconcile the protected owner-edited pitch assets before any send. Do not retype owner identity or
  contact details from another worktree. Treat old move numbers and “same batch sitting” notes as legacy.
- Scrub every final pitch of “just launched,” “launches,” and “too new for meaningful numbers.” GraveStory
  went live on Google Play on June 29; use that exact date when useful and use current, owner-visible facts
  for traction questions. Never send the current local-press master copy verbatim.
- Record the 30–45 second demo using `demo-clip-script.md`. Record outdoors only in the early morning;
  use a pre-scanned, known-good stone and finish the field portion before the day's heat builds.
- Verify two demonstrations from existing saved examples or separately approved test scans: one strong
  sourced story and one honest thin-record result. Do not create production records solely for marketing prep.
- Confirm the live Play listing copy, screenshots, privacy link, terms link, and support contact.
- On the installed Play build, cold-start twice and smoke-test sign-in, an existing story, My Map, and
  Community Map. Verify scan/paywall evidence only through an already approved tester path; this is not
  authorization to consume credits or write production data, and it is not a reason for a new build or OTA.
- Prepare one baseline row for the metrics in §8. Do not inspect or mutate production systems without the
  applicable approval; use owner-visible console totals or existing approved reports.

**Output by July 31:** a truthful demo candidate, two reliable demo stories, and a written list of any
launch blockers. No broad outreach yet.

### August 1–9 — finish the package

- Upload the demo clip and replace `[LINK WHEN RECORDED]` only after the owner approves the final video.
- **[OWNER-ONLY / EXTERNAL]** Add the approved clip to the Play listing video field after its normal
  Play Console approval gate.
- Export the press kit to a sendable PDF and finish the one-sentence founder note.
- **[OWNER-ONLY / EXTERNAL]** Create or verify the three channel-specific Custom Store Listings in
  `play-listing-variants.md` after the normal Play Console approval gate.
  Use their unique `listing=` URLs in the matching pitches so Play Console can separate the traffic.
- Make the reviewer "yes" package executable: one-hour response template, one-pager, access runbook,
  and a calendar block for same-day replies.

**Output by August 9:** every recipient can understand the product without installing, and every "yes"
can receive a complete package within one hour.

### August 10–21 — quiet proof and personalization

- Re-verify every contact path within 48 hours of its scheduled send. Never guess an address.
- Add one real sentence to each pitch explaining why that outlet's audience fits; do not rewrite the
  approved core claims.
- Confirm that each link opens the intended Play listing and that the video plays without ads or an
  embedding block.
- Capture the final pre-push metrics baseline on Friday, August 21.
- Verify the public `robots.txt` and `sitemap.xml` locally. **[OWNER-ONLY / EXTERNAL]** If an already
  approved Search Console property exists, record its baseline; otherwise mark it unavailable. Do not
  create or connect a property solely for this campaign.
- Run the launch gate in §4. If any hard gate fails, send nothing and use the fallback table; do not
  compress the work.

### August 24–28 — advance gatekeeper wave

Send one primary pitch per day so replies are manageable:

| Date | Target | Purpose | Asset |
|---|---|---|---|
| Mon Aug 24 | EOGN / Dick Eastman | Fast genealogy-audience signal | `outreach-emails.md` #1 + demo |
| Tue Aug 25 | Family Tree Magazine | October Family History Month/listicle consideration; expect a long lead | `outreach-emails.md` #2 + press kit |
| Wed Aug 26 | The Family History AI Show | Most timely niche-audience fit | `outreach-emails-wave2.md` #1 + demo |
| Thu Aug 27 | Amy Johnson Crow | First mid-tier creator before the 100K-tier ask | `outreach-emails-wave2.md` #3 + demo |
| Fri Aug 28 | Response buffer | Answer replies; no fifth cold pitch | reviewer package |

Do not ask for a synchronized publication date. Say that James is available the week of September 8
and can provide an early-morning demonstration, screenshots, or reviewer access.

### August 31–September 7 — Labor Day buffer

- Send no new broad cold wave during the holiday week.
- Respond to interested editors and grant approved reviewer access promptly.
- Fix only true blockers. Do not squeeze in speculative product work because marketing is approaching.
- If a local demonstration is requested, schedule it early morning and apply the heat rule in §5.

### September 8–13 — primary activation

- Tuesday, September 8: send The Genealogy Guys pitch.
- Wednesday, September 9: send the Lisa Lisson pitch.
- Thursday, September 10: after the required human contact-page check, send the Family History Fanatics
  pitch. If the route cannot be verified, skip it rather than substituting a guessed address.
- Keep Friday open for responses, reviewer onboarding, and local-press logistics.
- Use the Grandparents Day angle only in direct pitches where family memory is already relevant. Do not
  manufacture a coupon, memorial stunt, or grief-based urgency.
- If coverage lands, add the accurate "featured by" proof to later pitches only after the coverage is live.

### September 14–18 — proof-dependent reach, local press, and October runway

- Genealogy TV is the 100K-tier target. Send that pitch only after a smaller target has engaged or live
  coverage provides accurate social proof; otherwise hold it open instead of counting it as a failure.
- Thursday, September 17: send the current pitch to exactly one verified local newsroom, after the seven
  smaller genealogy/media targets above. For this push, the “Gordon can go same day” instruction in
  `local-press-pitch.md` is superseded: do not send a second newsroom on the same day.
- Use the draft bodies in `outreach-emails-wave2.md`, but follow this plan's dated sequence rather than
  that file's legacy “same batch sitting” note.
- Frame appropriate editor pitches as an idea for October Family History Month coverage.
- Use one polite follow-up only where the target's documented window permits it. Family Tree Magazine
  remains inside its 6–8 week no-nudge window.
- Do not create a new content channel. The demo clip, listing, press kit, and earned coverage are the assets.

### September 21–October 9 — measure and make the operating decision

- Capture 72-hour, 7-day, and 21-day results by channel where Play reporting permits it.
- Reply quickly to live opportunities; otherwise stop sending and return to product work.
- Use October Family History Month as a second editorial hook only for unused targets or allowed
  follow-ups. Never send a third message to the same person.
- Make the ordered operating decision in §9 on October 9. Do not classify a still-open editorial response
  window as a rejection; in particular, Family Tree Magazine keeps its full 8–10 week decision window.

## 4. Launch gate — all hard gates must pass by August 21

### Hard gates

- [ ] Demo clip is approved, hosted, and playable without ads or access friction.
- [ ] Play listing title, description, screenshots, privacy policy, terms, and support contact are current.
- [ ] Installed production app passes the two-cold-start smoke test; no new build or OTA is required solely
      for this campaign.
- [ ] One strong sourced demonstration and one thin-record demonstration have been rehearsed.
- [ ] Press kit, reviewer one-pager, and "yes" response are complete and use canonical public links.
- [ ] Final scheduled copy contains no stale “just launched,” “launches,” or “too new for meaningful
      numbers” claim, and every old move/batch instruction has been reconciled against this plan.
- [ ] Reviewer access can be granted through the approval-gated runbook without copying privileged SQL.
- [ ] Each scheduled target has a named owner, send date, and contact-reverification date no more than
      48 hours before the send.
- [ ] Baseline metrics are recorded before any campaign links are used.
- [ ] No unresolved launch-blocking product, billing, privacy, or account-deletion issue is known.

### Nice-to-have, never a reason to miss the window

- [ ] Three Custom Store Listings are published and their unique URLs tested.
- [ ] The Life Story screenshot is in Play listing slot one or two.
- [ ] One additional local historical stone has been pre-scanned as a backup demonstration.

No outbound pitch is allowed while a hard gate is failing. Use the first applicable row:

| Gate result | Outreach window | Measurement and decision |
|---|---|---|
| Pass on Aug 21 | Aug 24–Sep 18, as scheduled above | 21-day measurement ends Oct 9 |
| Fail Aug 21; pass at Aug 28 recheck | Sep 8–25; preserve the same target order and one-send-per-day rule | Move every checkpoint with the sends; decide 21 days after the final send |
| Fail Aug 28; pass at Sep 18 recheck | Sep 28–Oct 9, using Family History Month only where relevant | Decide 21 days after the final send |
| Still failing Sep 18 | No campaign date | Return to product/trust repair and choose a new window only after every hard gate passes |

Never outreach around a known product or trust failure just to preserve a date. A shifted campaign also
shifts its baseline, 72-hour, 7-day, and 21-day checkpoints; October 9 is not a fixed decision date for a
fallback campaign.

## 5. Heat and field-work rule

The heat changes **field execution**, not the entire digital campaign.

- No cemetery recording, demonstration, or press walk during the heat of the day.
- Prefer early morning; carry water, use shade, and keep the field segment short.
- If the local National Weather Service office issues a Heat Advisory or Extreme Heat Warning for the
  demonstration period, postpone it or use the recorded demo. Do not ask a reporter or reviewer to meet
  outside during an alert.
- The national email schedule can continue because the product can be understood from the demo and used
  later when conditions improve.

This rule follows National Weather Service guidance to postpone or reschedule outdoor activity during
dangerous heat and to favor cooler periods when outside activity is necessary.

## 6. Channel allocation

| Channel | Role in this push | Maximum effort | Stop rule |
|---|---|---:|---|
| Genealogy newsletters/editors | Borrow trust and reach the highest-intent audience | 2 primary pitches + allowed follow-ups | Judge only after each target's documented response window closes |
| Genealogy creators/podcasts | Demonstrate the visual transformation | 5 scheduled smaller-target pitches; Genealogy TV only after proof | Stop after the eight-target roster and one allowed follow-up each |
| Local press | Earn one credible founder/local-history story | One newsroom in the first wave | One follow-up; then use another newsroom only for a genuinely new seasonal angle |
| Google Play Custom Store Listings | Match the landing page to each pitch and separate traffic | Three listings | If setup threatens the hard gates, use the default listing and record send times |
| AlternativeTo/passive directories | Low-maintenance discovery | One 15-minute submission block | No directory crawl and no paid upgrade |
| Paid acquisition/self-posting | None | $0 / 0 hours | Remains prohibited by `gtm-strategy.md` |

## 7. Send-day operating rhythm

For every scheduled pitch:

1. Re-open the live contact page and verify the route.
2. Open every link in the final email.
3. Scrub the copy against the NEVER-SAY list.
4. Send once and record the timestamp, target, listing URL, and permitted follow-up date.
5. Reserve twenty minutes that evening for replies.
6. If the target says yes, send the reviewer package within one hour when reasonably awake and available.

No bulk-mail tool, mailing list, tracking pixel, or automated follow-up is needed.

If Custom Store Listings are unavailable, keep primary sends to one target per calendar day. Attribute
results only at the wave level when simultaneous independent coverage makes target-level attribution
impossible; never present timestamp correlation as certain channel attribution.

## 8. Measurement sheet

Record one row at baseline, then at 72 hours, 7 days, and 21 days after each wave. Use channel-level rows
only where a unique listing or other reliable mechanism supports them; otherwise use a labeled wave total.

| Metric | Why it matters | Interpretation |
|---|---|---|
| Pitch delivered / reply / reviewer yes / coverage | Tests the hook and target fit | Silence across the whole batch is a message/target problem, not proof the product has no value |
| Store visitors by listing | Tests whether coverage sent qualified traffic | Use Custom Store Listing reports when available; otherwise compare timestamped windows cautiously |
| First-time installers | Tests reach | A feature that moves installs works as acquisition even before revenue appears |
| Store visitor → install conversion | Tests listing-message match | Low conversion after qualified coverage points to listing or Android-only friction |
| Sign-up → first scan | Tests the activation wall | Drop-off here is a product/funnel issue, not a media-channel issue |
| First scan → paywall view | Shows whether users consume the free allowance | Do not optimize price before enough users reach this point |
| First purchase / second purchase | Tests revenue and repeat value | The second purchase remains the strongest product-market signal |
| Rating, review count, uninstall trend | Detects low-fit traffic or product disappointment | A rating decline after a wave is a quality/review-prompt warning |

Keep the existing statistical guardrail: fewer than roughly 300 cumulative installs with no sale is not
enough evidence to abandon the model. Do not convert that planning estimate into a promise or forecast.

## 9. October 9 operating decision

Evaluate these in order and choose the **first** matching outcome. For a fallback campaign, evaluate the
same sequence 21 days after its final send instead of October 9.

1. **Pause for trust:** a product, billing, privacy, account-deletion, or support blocker appeared. Stop
   acquisition until it is resolved, regardless of other signals.
2. **Scale carefully:** a second purchase appeared. Revisit iOS and the gated SEO investment; do not jump
   to paid acquisition from one repeat buyer.
3. **Fix the funnel:** qualified traffic arrived but sign-up or first-scan completion was weak. Stop
   acquisition until the activation problem is understood.
4. **Continue the channel:** at least one credible target engaged or a feature produced measurable installs.
   Keep the relationship warm; do not increase send frequency.
5. **Rewrite the hook:** every actually sent target's documented response window has closed and none
   engaged. Review the first two sentences and the demo, then test a materially different story angle with
   new targets. A held Genealogy TV pitch and an open Family Tree Magazine window do not count as failures.
6. **Hold and build:** none of the conditions above is established or editorial windows remain open.
   Preserve the assets, keep the allowed response dates on the calendar, and return to building.

## 10. Owner-time budget

| Work | Budget |
|---|---:|
| Demo recording/edit/upload | 2–3 hours |
| Listing/press/reviewer readiness | 2 hours |
| Contact verification and personalization | 2 hours |
| Up to nine primary sends (eight genealogy/media + one newsroom) | 2–3 hours total active time |
| Reply windows and reviewer onboarding | 20 minutes on send days; more only when a real opportunity exists |
| Measurement and October decision | 1 hour |

Total planned active marketing time: roughly **one preparation day plus short send/reply blocks**. This
remains compatible with a founder who prefers building and avoids a recurring content treadmill.

## 11. Date and mechanism sources

- The U.S. Office of Personnel Management lists Labor Day 2026 as Monday, September 7:
  <https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/>
- 36 U.S.C. §125 designates the first Sunday after Labor Day as National Grandparents Day, making the
  2026 observance Sunday, September 13:
  <https://www.law.cornell.edu/uscode/text/36/125>
- The National Genealogical Society actively treats October as Family History Month and provides current
  story-preservation resources:
  <https://www.ngsgenealogy.org/family-history-month/>
- Google Play supports Custom Store Listings reached through unique `listing=` URL parameters:
  <https://support.google.com/googleplay/android-developer/answer/9867158>
- National Weather Service heat-alert guidance recommends postponing or rescheduling outdoor activity
  during dangerous heat:
  <https://www.weather.gov/safety/heat-ww>

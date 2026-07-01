# GraveStory Go-To-Market Strategy

> Built 2026-06-30 by a multi-agent workflow (32 agents: positioning kernel + fresh 2026 web research
> + 16 channels scored and adversarially verified + synthesis). Grounded in the verified competitive
> and distribution research in memory ([[reference-competitive-landscape]], [[reference-first-revenue-distribution-plan]]).
>
> **This is the PLAN layer.** The executable assets live alongside it:
> - Contacts + send order: [`outreach-contacts.md`](outreach-contacts.md)
> - Pitch email drafts: [`outreach-emails.md`](outreach-emails.md)
> - Store listing copy: [`../store-listing/description.md`](../store-listing/description.md)
>
> **Framing (locked):** lead with VERIFIED SOURCES, not "AI." Target the casual cemetery visitor,
> not the serious genealogist. Solo indie · Android-only · goal = first revenue, then repeat purchase ·
> owner prefers building to marketing.

---

## 1. Executive Summary — the 5 moves that matter, in order

The whole strategy fits one insight: **Google Play will not surface a zero-install niche app organically**
(2026 ranking weights retention/reviews/uninstall over install volume). Every install must be *pushed in
from outside*, and the app must *retain + earn reviews* or it decays. So: seed installs from trusted
genealogy gatekeepers (zero ban risk, proven-WTP audience), and make sure the listing + app convert and
retain the borrowed traffic.

| # | Move | Why THIS first |
|---|------|----------------|
| **1** | **Send the EOGN / Dick Eastman pitch** (`richard@eastman.net`, draft ready) | Fastest signal (1-2 wks), ~15 min, highest-WTP audience reachable by a solo dev, zero ban risk. The one move you learn from *this month*. |
| **2** | **Ship the ASO rewrite + auto-fired In-App Review prompt — SAME sitting as move 1** | Free, fully in your control, and it's the *binding constraint*: without it, borrowed installs land on a stale listing and waste their review potential. Do it BEFORE traffic arrives. |
| **3** | **Batch the other media pitches in one sitting** — Family Tree Magazine listicle, Genealogy TV, The Genealogy Guys podcast | Same email session, same reviewer-access offer. The listicle is the durable compounding SEO asset; the rest are shots on goal at ~1-in-3 reply odds. |
| **4** | **Record ONE 30-45s scan-to-story demo clip** | Already owed to the Genealogy TV pitch, doubles as the Play listing video, makes every "yes" convert faster. Produce once, reuse everywhere. |
| **5** | **Fire one local-press email** (Aiken Standard / North Augusta Star) — *after* the 4 media pitches | Cheap "as featured in…" credibility asset that strengthens future pitches. A reputation primer, not a sales channel. |

**Total owner time to execute all 5: ~one focused day of writing + ~3 hrs of code/recording.** Then back to building.

**The single most important number:** don't judge this by first-sale timing. Plan on **~300-500 installs
before the first paying customer**, and judge the *model* by the **second purchase**, not the first.

---

## 2. Positioning & Messaging

### Locked one-liner
> **Photograph any gravestone and GraveStory reads the inscription, then pulls verified public records —
> WikiTree, Wikidata, historic newspapers, county histories, Wikipedia — into a source-cited written life
> story of the person resting there.**

### Ranked value props
1. **It writes a STORY, not a transcription.** Three rivals scan stones; none writes a narrative biography from the scan. The single most defensible claim. *(Find A Grave added text recognition Jan 2026 — so lean HARDER here, NOT on "we can read the stone.")*
2. **Every fact traces to a named, checkable public source.** Open + cited, not a walled paywalled database. The trust spine that defuses AI distrust.
3. **A free, public community map** of scanned graves with read-only bios — no login to look, no subscription to read. The one rival with a map keeps it private by default.
4. **No subscription, ever.** Credit packs from **$1.99** that never expire + 3 free scans. Rivals are subscription-gated.
5. **Built for the casual visitor standing at a stone right now** — no genealogy account, no research skills.

### Per-audience message tracks (primary → tertiary)

| Audience (WTP) | Lead angle | Trust device |
|---|---|---|
| **Casual cemetery visitor** (high) | "Who was this person? Point your phone at the stone and get their story." Hero = the photo-to-story moment. | Curiosity satisfaction; instant. |
| **Genealogy-curious relative** (high) | "Reads the stone and pulls VERIFIED records into a cited story of your relative." Lead with the named sources. | The citations ARE the trust device. |
| **Local-history buff** (medium) | "Every claim traces to open, cited sources — historic newspapers, county histories, WikiTree — not a walled database." | Verifiability over black-box answer. |
| **Web SEO browser** (low, slow) | "Explore a free public map of remembered lives, then scan a stone of your own." Browse-first, no sign-up to read. | Free discovery; don't hard-sell. |

### ⚠️ NEVER SAY (overclaim traps — these burn credibility with fact-checking editors, the ONE way to lose the media strategy)

- ❌ **"The only AI gravestone scanner"** — FALSE. BillionGraves, MyHeritage Scribe, Stories in Stone all scan with AI. ✅ Only safe claim: *"the only one that writes the life STORY from the scan."*
- ❌ **"Competitors can't write a biography"** — FALSE (MyHeritage has a separate AI Biographer). ✅ *"…not from a gravestone scan of an ordinary person."*
- ❌ **"Competitors have no map"** — FALSE (Stories in Stone has one, private). ✅ *"we have a PUBLIC community map."*
- ❌ **"NONE writes a life story" (flat)** — CWGC's *For Evermore* app surfaces curated war-dead stories. ✅ *"none writes a source-cited life story FROM A GRAVESTONE SCAN of any ordinary person."*  ← **NEW finding, not in prior notes.**
- ❌ **Stating competitor prices as fact** ("$79/mo", "$399/yr") — all soft/single-sourced. ✅ Use *"reportedly"*; only quote OUR price ($1.99, 3 free) as hard fact.
- ❌ **Implying an iPhone app exists** — Android-only. iOS not built.
- ❌ **"Works on any stone" / guaranteed rich bio** — weathered/unmarked/recent stones return thin bios. Never promise depth.
- ❌ **Leading with "AI writes the bio"** to genealogy audiences — not false, but a positioning trap that triggers the distrust reflex. Lead with named sources.
- ❌ **"Shows faces of the ordinary dead"** — only Wikipedia/Wikidata portraits of *famous* figures. Never imply everyday-deceased photos.

---

## 3. Channel Strategy (prioritized)

| Channel | Verdict | Effort | Cost | Intent | Ban/brand risk | First action | Kill criteria |
|---|---|---|---|---|---|---|---|
| **EOGN / Dick Eastman newsletter** | **DO-NOW** | very-low | $0 | high | ~none | Send drafted email to `richard@eastman.net` — lead with records, NOT "AI tools" | No pickup ~3-4 wks + 1 follow-up → stop (don't 3rd-pitch) |
| **ASO rewrite + In-App Review** | **DO-NOW** | low | $0 | high (moment-of-need) | none | Retitle → "GraveStory: Gravestone Scanner"; rewrite `description.md` (kill "AI-written" lead, fix "10 free"→"3 free"); OTA the auto-review prompt | Rank #1 for "gravestone scanner" yet installs ~0 → confirms you need external traffic; stop tinkering, don't kill |
| **Family Tree Magazine "Best Cemetery Apps" listicle** | **DO-NOW** (compounding, slow) | very-low | $0 | high | ~none | Writer-query to `FamilyTree@yankeepub.com` (CC named editors) — NOT a byline; expect 6-8 wks, NO nudge inside window | No reply ~8-10 wks (one query, zero nudges) → deprioritize |
| **Genealogy TV / Connie Knox (100K YT)** | **DO-NOW** (batch it; not #1) | low | $0 | medium | ~none | Contact form + attach demo clip; frame as "filmable demo idea" | No reply after form + 1 LinkedIn DM (~4-6 wks) → reallocate to mid-tier |
| **One evergreen demo clip** | **DO-NOW** (enabling asset) | low | $0 | n/a | low | Record 30-45s scan-to-story on a strong-record stone; on-screen text leads with SOURCES; YouTube → paste URL into Play listing | You catch yourself making clip #3/#4 for a self-run channel |
| **The Genealogy Guys podcast** | **TEST-SMALL** (batch add-on) | low | $0 | medium | low (brief on traps) | Email via genealogyguys.com; attach clip. Drop dead *Generations Cafe*; add *The Family History AI Show* | No reply ~4 wks; or aired + negligible bump; or pay-for-mention |
| **Mid-tier YouTubers** (Amy Johnson Crow, Lisa Lisson, Family History Fanatics) | **TEST-SMALL** (rider on emails) | low | $0 | medium | low | Fold into same batch; pitch mid-tier FIRST, save 100K-tier for after social proof. *(Crow is AI-literate but skeptical — precise sourcing cuts both ways)* | ~8-10 pitches over 6-8 wks, zero video commitments → video ask too heavy; pivot to newsletters/listicle |
| **Local press (Aiken Standard / Augusta Chronicle)** | **TEST-SMALL** (after media batch) | low | $0 | medium | low | ~150-word pitch to a *named* reporter (check bylines); pre-scan 2-3 known-good local stones | No reply + 1 follow-up ~3 wks; treat as credibility asset, not sales |
| **Web / global-map SEO** | **DO-LATER** (build project) | high | $0 | low | low (privacy = HARD gate) | 10-min diagnostic ONLY: robots.txt + sitemap.xml + Search Console. Do NOT build per-grave pages yet | Build only once Search Console shows real long-tail impressions AND corpus >100-200 bios |

### SKIP list (don't waste an hour)

- **Self-posting in r/Genealogy / Find-A-Grave FB groups** — blacklist risk; being *featured* is fine, YOU posting is the ban move.
- **Taphophile / r/CemeteryPorn** — high emotional pull, near-zero WTP.
- **TikTok #gravecleaning as a channel** — daily-posting treadmill, lowest-WTP gawkers. (One evergreen clip is fine; a self-run channel is not.)
- **Paid installs / paid reviews / influencer fees** — CPI ~$4-8 to earn a ~$1.70 first sale = economically irrational; ban risk on paid reviews.
- **Paid PR wires** ($21-$479) — near-zero real pickup; a free editorial email beats it.
- **Conferences / RootsTech** — low-4-to-5-figure booth + travel, wrong (serious-genealogist) audience. Revisit only post-PMF with cash.
- **Product Hunt "launch day"** — 6-8h for tech tourists who won't scan a grave; a low-intent install spike can *hurt* 2026 ranking via uninstalls. (15-min passive AlternativeTo/BetaList listings are the only defensible slice.)
- **Owner newsletter** — no traffic to build a list from, fights the "install NOW" funnel, recurring treadmill you won't sustain. Only defensible slice: a static "notify me when iOS launches" field — and only *after* iOS is being built.
- **Cemetery / funeral-home partnerships** — slow B2B, wrong (institutional) audience; funeral homes are an active *reputational hazard* (thin bios about the freshly bereaved). Only opportunistic ask: if you already know someone at a local historic cemetery/society, offer the free map link. Skip funeral homes outright.

---

## 4. 90-Day Sequenced Roadmap

Front-loaded so the highest-leverage, lowest-effort moves happen first — then you're mostly back to building.

### Weeks 1-2 — the whole "launch" happens here (~1 day + ~3 hrs code)

| Action | Owner time | Expected signal |
|---|---|---|
| **ASO pass:** retitle → "GraveStory: Gravestone Scanner"; rewrite `description.md` (records-first lead, one natural mention each of "read old headstones" / "who is buried here" — NO keyword stacking; fix "10 free"→"3 free") | ~2 hrs | Listing trap-free + Ask-Play-ready when traffic lands |
| **In-App Review prompt** OTA'd: fire in `ResultScreen.js` `handleSave()` — gated to signed-in + ≥2nd save + `sources.length > 0` (excludes stone-only fallback) + one-time AsyncStorage flag. Run bmad-code-review first. | ~1-2 hrs | Ratings tick up with future install spikes |
| **Record the demo clip** (strong-record stone, sources on screen) → YouTube → paste URL into Play listing | ~1-2 hrs | Reusable across all pitches |
| **Send EOGN pitch** (`richard@eastman.net`) — hook leads with records, not "AI tools" | ~15 min | **Reply/pickup within 1-2 wks — your fastest read** |
| **Batch other pitches, same sitting:** FTM writer-query; Genealogy TV form; The Genealogy Guys + The Family History AI Show; mid-tier YouTubers (Crow/Lisson first) | ~2-3 hrs | ~1-in-3 reply odds; diversified |
| Grant `is_unlimited` to any reviewer who bites | seconds | — |

### Weeks 3-6 — respond, don't chase (~2-3 hrs total)

- **Answer editor/creator follow-ups fast**; honor free-access grants. This is where a "yes" converts.
- **One local-press email** to Aiken Standard / North Augusta Star (named reporter). *Signal:* a citable feature to reuse.
- **One polite follow-up each** to non-responders at ~2-3 wks (EOGN, Genealogy TV via LinkedIn). **No follow-up to FTM inside its 6-8 wk window.**
- **10-min SEO diagnostic:** robots.txt + sitemap.xml + Search Console. *Signal:* starts the indexing clock.
- *Overall:* first install trickle from any live feature; watch rating + review count.

### Weeks 7-12 — measure, and mostly build (~1-2 hrs/wk)

- **Watch the funnel** (below) as features ship. Attribute via per-channel **Custom Store Listing deep-links** (free, +15-57% documented conversion lift).
- **If a mid-tier creator said yes but the 100K-tier didn't:** ship the mid-tier video, then re-pitch Genealogy TV *with the video as social proof*.
- **If installs are flowing:** tighten the review-prompt gate if rating dips; consider the per-grave SEO build ONLY if Search Console shows real long-tail impressions.
- **Otherwise: go build.** The pitches are sent; they compound or they don't. Don't manufacture a marketing treadmill.

**Realistic total owner marketing time across 90 days: ~2-3 days.** That is the point.

---

## 5. Budget & Effort Tradeoffs (honest)

**Costs $0 (do all of it):** every media pitch, the ASO pass, the In-App Review prompt, the demo clip
(own-device recorder + free editor), local-press email, Custom Store Listing deep-links, the SEO
diagnostic, passive AlternativeTo/BetaList listings. Free reviewer access costs pennies of API (~$0.08/scan).

**Worth a *small* future spend (NOT now):** the $99/yr Apple Developer account — *only* once Android has
proven repeat-purchase (the second-purchase gate). iOS removes the single biggest bounce for borrowed
genealogy-media traffic (that audience skews iPhone), so it's the highest-value paid unlock — but a
*scaling* spend, not a *validation* spend.

**Never pay for:** paid installs/UA (~$4-8 CPI to earn ~$1.70), paid reviews (ban risk), influencer fees
($150-$800/post), PR wires (near-zero pickup), conference booths, "co-branded" partner engineering. The
barter version (free access for an honest review) is the only paid-adjacent thing that fits — and it isn't cash.

**The real budget is time, and time's scarcest use is building.** Every channel above spends an hour of
writing, not a week of grinding.

---

## 6. Success Metrics & Decision Gates

**Track the full funnel** (attribute via per-channel CSL links):

```
install → sign-up → first scan → paywall view → FIRST purchase → SECOND purchase
```

**Noise vs. signal:**

- **< ~300 cumulative installs with 0 sales = STATISTICAL NOISE.** Don't pivot, don't conclude "marketing doesn't work," don't blame a channel. Expected at 0.3-1% cold conversion behind a 3-free-scan wall.
- **A media feature that moves *installs at all*** (even without a sale) = the channel *works*; judge the channel on installs, judge *revenue* separately.
- **install → first-scan drop-off** = product/funnel problem (the auth wall), NOT a channel problem. Fix the funnel before re-blaming acquisition.
- **Rating drifts DOWN after an install wave** = review prompt mis-timed → tighten the gate to only strong bios.

**The one metric that means "working": the SECOND purchase.** First sale ≈ $1.70 after Google's cut — a
validation milestone, not a business. A repeat buyer proves the credit model and the value loop.

**Decision gates:**

- **Media strategy verdict:** judge on the *aggregate* of all ~5-6 pitches over 8-12 weeks, never on one non-reply. If 0 of 6 engage AND aggregate installs stay <300 → the *reach* problem isn't solved; the video ask is too heavy / hook is wrong — revisit messaging, not the whole plan.
- **SEO build gate:** invest the 1-3 build-days ONLY when Search Console shows rising long-tail name/cemetery impressions AND the public-bio corpus exceeds ~100-200 bios. Not before.
- **iOS / scaling gate:** buy the Apple account and build iOS ONLY after Android shows **≥1 second purchase** — not after the first sale, not on installs alone.

---

## 7. Risks & What Would Change the Plan

**The competitive moat's durability — the top risk.** The moat is the *combination* (source-cited story +
open sources + public map + no subscription), durable *"for some amount of time,"* not permanently.
**Find A Grave added OCR text recognition in Jan 2026** (transcription is no longer unique), and
**MyHeritage is one integration away** from bolting its existing AI Biographer onto a grave scan.
*Implication (already baked in):* lean HARDER on narrative-STORY + verified-sources, never on "we can read
the stone." **If a major player ships scan-to-biography, the differentiator collapses to "public map + no
subscription"** — compete on price/openness + the free map, and accelerate iOS to widen reach before the
window closes.

**Other risks:**

- **The auth wall is the binding constraint, not the pitch.** 0 guest scans + 3 free = the funnel leaks before any channel gets credit. If install→first-scan is poor, fix *this* first — it gates every acquisition dollar. *(See [[reference-first-revenue-distribution-plan]] — revisit whether 1 free guest scan helps.)*
- **2026 Play algorithm punishes low-intent install spikes** (uninstall-weighted). Why Product Hunt is a *skip* and why the In-App Review prompt matters.
- **Overclaiming to a fact-checking editor** torches a gatekeeper relationship permanently. The NEVER-SAY list isn't polish; it's the failure mode that kills the #1 strategy. Scrub every pitch against it.
- **Android-only bounces the iPhone-heavy genealogy audience.** A 100K-view video routes iOS viewers to a dead store wall. Mitigate with an honest "Android today, iOS coming" line.
- **Living-relative privacy on indexed pages is a HARD legal gate.** A Google-cached bio naming a living person is far worse than an ephemeral in-app view. Do NOT make per-grave pages crawlable until redaction is bulletproof. *(See [[reference-originated-relatives-design]].)*
- **Owner temperament risk:** the plausible failure isn't a wrong channel — it's *not sending the emails* (build-preference) or *over-investing a Product Hunt day*. The roadmap is deliberately ~2-3 total days so it survives contact with a founder who'd rather be coding.

**What would change the plan:** a repeat-purchase signal → buy the Apple account, build iOS, make the SEO
surface real. A competitor shipping scan-to-bio → pivot messaging to map + openness + price and race iOS.
Aggregate media silence past 12 weeks with <300 installs → the problem is reach/hook; revisit the demo clip
and lead angle before abandoning the gatekeeper strategy.

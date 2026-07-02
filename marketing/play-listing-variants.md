# Play Listing Variants — per-channel CSLs, captions, screenshot experiment

> Per-channel Play listing assets: Custom Store Listing (CSL) variants, screenshot caption
> strings, and the screenshot-order experiment. Drafted 2026-07-01. This is the ASSET layer —
> the plan lives in [`gtm-strategy.md`](gtm-strategy.md) (§2 message tracks + NEVER-SAY list;
> §4 calls for per-channel CSL attribution links, documented +15–57% conversion lift).
> Canonical listing copy: [`../store-listing/description.md`](../store-listing/description.md).
> Each variant below changes ONLY the short description and the FIRST paragraph of the full
> description — everything else stays canonical. All copy scrubbed against the NEVER-SAY list;
> don't ad-lib claims beyond it.

---

## 1. Custom Store Listing (CSL) variants

Play Console supports custom store listings reachable via unique URLs — that URL is the
attribution device: installs arriving through it are reported against the CSL in Play Console,
so each media channel gets its own measurable front door.

### Variant A — genealogy-media track (EOGN, Family Tree Magazine, podcasts)

**Internal listing name:** `csl-genealogy-media`

**Short description (≤80 chars):**

```
Turns a gravestone photo into a life story, built from cited public records.
```
Character count: 76 ✓

**Replacement FIRST paragraph** (rest of the full description stays canonical):

```
GraveStory turns a photograph of a gravestone into a written life story of the person buried there — and the stories name their sources. Each scan searches verified public records in parallel — WikiTree, Wikidata, historic newspapers (Chronicling America, pre-1928), county histories (Internet Archive), and Wikipedia — and the citations appear under the story so you can check them yourself. When the records come up thin, the story stays short and honest: built from the inscription alone, with no invented detail.
```

*Why this lead:* this audience arrives from a fact-checking editor's link. Named, checkable
sources are the trust device (GTM §2, genealogy-curious track); the honest thin-records line
pre-empts the exact probe an EOGN reader will run.

### Variant B — creator-video track (Genealogy TV, mid-tier YouTubers)

**Internal listing name:** `csl-creator-video`

**Short description (≤80 chars):**

```
Point your phone at a gravestone. In about 30 seconds, read their life story.
```
Character count: 77 ✓

**Replacement FIRST paragraph** (rest of the full description stays canonical):

```
You just watched it happen — here's the app. Point your camera at a gravestone and in about 30 seconds GraveStory hands you a written life story of the person buried there, with the sources cited underneath. It reads the name, dates, and inscription, searches verified public records — WikiTree, Wikidata, historic newspapers, county histories, Wikipedia — and writes only what it actually finds: well-documented stones get rich stories, weathered ones get a short, honest story from the inscription alone.
```

*Why this lead:* everyone landing here just saw the demo clip. Open on the payoff they
watched, then immediately anchor it to the cited sources so the story doesn't read as a
magic trick. This CSL's URL goes in the video description (alongside [LINK WHEN RECORDED]
once the demo clip exists).

### Variant C — local-press track (Aiken Standard, North Augusta Star, Augusta Chronicle)

**Internal listing name:** `csl-local-press`

**Short description (≤80 chars):**

```
Who's buried here? Scan the stone and read their story, from real records.
```
Character count: 74 ✓

**Replacement FIRST paragraph** (rest of the full description stays canonical):

```
Every cemetery is full of neighbors whose stories nobody remembers. GraveStory — built by a solo independent developer in North Augusta, South Carolina — turns a photograph of a gravestone into a written life story of the person buried there, every fact drawn from real, cited public records: historic newspapers, county histories, WikiTree, Wikidata, and Wikipedia. Some stones yield remarkable stories; weathered ones get a short, honest telling built from the inscription alone.
```

*Why this lead:* local press buys the hometown human-interest angle — a neighbor built this,
and it works on the cemetery down the road. The maker line stays anonymous (name lives in
the pitch email, not the listing).

### Play Console setup (5 steps)

1. **Play Console → Grow → Store presence → Custom store listings → Create listing.**
2. **Name it** with the internal listing name above (internal only — users never see it).
3. **Paste the copy:** the variant's short description, and a full description made of the
   variant's first paragraph + everything after the first paragraph of the canonical copy in
   `store-listing/description.md`, unchanged. Reuse the live icon, screenshots, and feature
   graphic — no new assets needed.
4. **Set how users reach it:** choose the custom-URL option (not country targeting) — Play
   Console generates a unique shareable listing URL for the CSL.
5. **Save and submit** (CSLs go through the same Play review as the main listing), then copy
   each CSL's unique URL into the matching pitch: `csl-genealogy-media` → the EOGN / Family
   Tree Magazine / podcast emails in `outreach-emails.md`; `csl-creator-video` → the demo-clip
   video description and creator pitches; `csl-local-press` → the local-press email. **The
   unique URL is the whole point** — it is the per-channel attribution link the GTM funnel
   (install → sign-up → first scan → paywall → purchase) is judged by.

---

## 2. Screenshot caption strings

**Honest note first:** Play Console has **no per-screenshot caption field for phone
screenshots** — you upload bare images. These strings are for (a) re-rendered captioned
screenshots, if the owner ever bakes caption bands back in, (b) the press kit, and (c) social
posts that use individual screenshots. (The "optional caption field" mentioned in
`store-listing/description.md`'s screenshot section doesn't exist for phone screenshots —
treat this file as correct.)

Captions match the LIVE screenshot order documented in `store-listing/description.md`
(≤8 words each, verified-sources framing):

| # | File | Caption |
|---|------|---------|
| 1 | `01-home.png` | Scan a gravestone. Read their life story. |
| 2 | `02-remembered-stories.png` | Your remembered stories, grouped by cemetery. |
| 3 | `03-community-map.png` | A public community map, free to browse. |
| 4 | `04-cemetery-map.png` | Every grave you scan, pinned by GPS. |
| 5 | `05-loading.png` | Searching WikiTree, Wikidata, newspapers, county histories. |
| 6 | `06-result-elvis.png` | A life story with every source cited. |
| 7 | `07-marker-picker.png` | Pick a hand-drawn marker for their grave. |

---

## 3. Screenshot-order experiment — move the Life Story result up

**Rationale:** the photo→story payoff is the single highest-leverage frame the product owns
(GTM §2 — the hero moment for the casual visitor), and most Play browsers only ever see the
first one or two screenshots. Slot 1 currently spends that attention on the logo; slot 6 —
the actual life story with cited sources — is where the "oh, it *writes the story*" click
happens.

**Action (5 minutes):** Play Console → Main store listing → Graphics → phone screenshots →
drag `06-result-elvis.png` to position 1 (or position 2, right after the home hero) → Save →
submit for review. No rebuild, no OTA. If installs are flowing later, promote the guess to a
real A/B test via Grow → Store presence → Store listing experiments instead of a blind swap —
but with near-zero traffic today, just make the move and note the date.

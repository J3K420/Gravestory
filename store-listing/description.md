# GraveStory — Play Store Listing Copy

---

## Short Description (≤80 chars)

```
Scan a gravestone. Read the person's life story, built from real records.
```
Character count: 73 ✓

> ASO note (S82): "scan" + "gravestone" put the near-uncontested keyword "gravestone
> scanner" into the highest-weighted-after-title field; "real records" carries the
> verified-sources framing instead of "AI." Old copy ("Discover the life story…")
> archived above in git history.

### Play Console TITLE (set in Console, not this file)
Recommended: **`GraveStory: Gravestone Scanner`** — the title is the single
highest-weighted ASO field and "gravestone scanner" is near-uncontested. Set it in
Play Console → Main store listing → App name (≤30 chars; this is 30 exactly).

---

## Full Description (≤4000 chars)

```
GraveStory turns a photograph of a gravestone into a written life story of the person buried there — every fact drawn from real, cited sources.

HOW IT WORKS

Point your camera at any gravestone. GraveStory reads the name, dates, and inscription, then searches verified public records — WikiTree, Wikidata, historic newspapers, county histories, and Wikipedia — to build a biography grounded in real sources, not invented details.

A name and two dates become a story.

WHAT YOU GET

• A written life story built from verified records — WikiTree, Wikidata, historic newspapers (Chronicling America), county histories (Internet Archive), and Wikipedia
• Cited sources on every story, so you can check where each fact came from
• GPS-linked cemetery map showing all your discovered stories
• A public community map to explore stories shared by other visitors — free to browse, no account needed
• Candle and flower tributes to honour the people you find

FOR GENEALOGISTS AND FAMILY HISTORIANS

GraveStory searches genealogy records in parallel with every scan. Notable figures get extended biographies. Weathered stones with uncertain names still get a story built from whatever the inscription reveals.

YOUR PRIVACY

Photos are only shared if you choose to make a story public. GPS coordinates are used to place your stories on your personal map and are never sold or shared with advertisers. See our full privacy policy at https://j3k420.github.io/Gravestory/privacy-policy/

FREE TO START

Get 3 free scans to try it. Purchase additional scan credits in the app if you want more — no subscription, and credits never expire.

ABOUT THE STORIES

Biographies in GraveStory are compiled from public records and historical sources, with AI assistance. They may contain errors and are not official or authoritative records. You can report any story directly in the app.

---

GraveStory is designed for one-handed use in a cemetery. The dark, unobtrusive interface keeps your focus on the stones, not the screen.
```

Character count: ~1,850 ✓ (well within 4,000 limit)

---

## Screenshots (feature-focused, with overlay captions baked in — Session 60)

Source: `tools/marker-preview/store-screens.html` → rendered to 1080×1920 PNGs
in `store-listing/screenshots/`. Each has a branded gold/parchment caption band
baked in (the "overlay text" testers asked for). Old raw WhatsApp photos
archived in `store-listing/screenshots/_old-raw-photos/`.

Upload order + the caption baked into each:
1. `01-scan.png` — "Photograph any gravestone — point your camera, that's the whole job"
2. `02-biography.png` — "A name and two dates become a life story — AI-written, in seconds"
3. `03-sources.png` — "Every fact backed by a real source — cited, never invented"
4. `04-cemetery-map.png` — "Every grave you find, on your map — GPS-pinned to the cemetery"
5. `05-community-map.png` — "Explore stories shared by visitors everywhere"

(Captions are baked INTO the images, so the optional per-screenshot caption
field in Play Console can be left blank.)

> ⚠️ ASO follow-up (S82): screenshot #2's baked caption still reads "AI-written, in
> seconds" — that's the exact verified-sources positioning trap the strategy flags
> (`marketing/gtm-strategy.md` §2). It's baked into the PNG, so fixing it needs a
> re-render of `02-biography.png` from `tools/marker-preview/store-screens.html`, not
> just a text edit. Recommended replacement caption: **"A name and two dates become a
> life story — built from cited records."** Deferred (image re-render, not code).

---

## Content Rating Notes

- No violence, no mature content
- No user-generated chat
- Contains GPS location collection (disclosed in privacy policy)
- Target age: Everyone (cemetery visitors, genealogists, families)

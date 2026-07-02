# marketing/ — Start Here

> The single entry point to the GraveStory marketing folder. The plan is
> [`gtm-strategy.md`](gtm-strategy.md); everything else in this folder is a ready-to-use asset
> that executes it. Every asset is scrubbed against the NEVER-SAY list in `gtm-strategy.md` §2 —
> **don't ad-lib new claims into any of them.**

---

## Start here — the one-day launch sitting

The gtm-strategy Weeks 1–2 roadmap, merged with the now-complete asset files, in execution
order. Items marked **[OWNER-ONLY]** are manual actions no agent can do for you (Play Console
changes, recording, sending emails, granting access). Total: roughly one focused day plus
1–2 hours of recording.

**Prep (do first — everything downstream depends on it)**

- [x] ~~Rewrite `store-listing/description.md` to records-first copy~~ — done in repo (S82)
- [x] ~~Ship the in-app Play review prompt~~ — done, OTA'd (S82)
- [ ] **[OWNER-ONLY]** Paste the new title ("GraveStory: Gravestone Scanner") and full description into Play Console → Main store listing — copy from `store-listing/description.md` — **~20 min**
- [ ] Fill `[YOUR NAME]` / `[YOUR EMAIL]` (and `[YOUR PHONE]` in the local-press file) placeholders across ALL outreach files — `outreach-emails.md`, `outreach-emails-wave2.md`, `followup-templates.md`, `reviewer-onepager.md`, `press-kit.md`, `review-response-templates.md`, `local-press-pitch.md` — **~10 min**
- [ ] **[OWNER-ONLY]** Record the demo clip — follow `demo-clip-script.md` shot-by-shot (pre-scan the stone first; use the unlimited dev account) — **1–2 hrs**
- [ ] Upload the clip to YouTube (metadata in `demo-clip-script.md` §4), then replace every `[LINK WHEN RECORDED]` across the folder with the live URL — **~20 min**
- [ ] **[OWNER-ONLY]** Paste the YouTube URL into the Play listing video field — **~5 min**
- [ ] **[OWNER-ONLY]** Create the 3 Custom Store Listings in Play Console — copy + 5-step setup in `play-listing-variants.md` §1 — then paste each CSL URL into its matching pitch — **~45 min**
- [ ] **[OWNER-ONLY]** Optional: drag the Life Story screenshot to slot 1 or 2 — `play-listing-variants.md` §3 — **~5 min**

**Send wave 1 (morning) — `outreach-emails.md`**

- [ ] **[OWNER-ONLY]** Send EOGN pitch (`outreach-emails.md` #1, richard@eastman.net) — first overall, fastest signal — **~15 min**
- [ ] **[OWNER-ONLY]** Verify the Family Tree Magazine address on their live contact page (~1 min), then send #2 — and create the "FTM nudge window opens [SEND DATE + 8 weeks]" calendar note (`followup-templates.md` §3) — **~15 min**
- [ ] **[OWNER-ONLY]** Submit the Genealogy TV pitch via their contact form (#3) — **~15 min**

**Send wave 2 (same afternoon or next morning) — `outreach-emails-wave2.md`**

- [ ] **[OWNER-ONLY]** Human-verify the Family History Fanatics contact page in a browser (site blocks bots) — **~2 min**
- [ ] **[OWNER-ONLY]** Send the 5 wave-2 pitches in the file's send order, spaced ~30–60 min apart — Family History AI Show first — **~1 hr elapsed**

**Passive + response readiness (same day)**

- [ ] **[OWNER-ONLY]** Submit the AlternativeTo listing + 3 "suggest an alternative" anchors — checklist in `directory-listings.md` §4 — **~15 min**
- [ ] Have the "yes" flow staged: `followup-templates.md` template 4 within the hour of any yes, then the `reviewer-onepager.md` package, then **[OWNER-ONLY]** grant `is_unlimited` (SQL in CLAUDE.md, Freemium section) as soon as their sign-in email arrives — **seconds when it fires**

**Weeks 3–6 (respond, don't chase)**

- [ ] **[OWNER-ONLY]** Send ONE local-press email AFTER the media batch — `local-press-pitch.md` (Bianca Moorman first; pre-scan 2–3 known-good local stones before offering the cemetery walk) — **~30 min**
- [ ] **[OWNER-ONLY]** One polite follow-up per non-responder at ~2–3 weeks — templates in `followup-templates.md` — never a third email, never a nudge to FTM inside its 6–8-week window
- [ ] 10-min SEO diagnostic: robots.txt + sitemap.xml + Search Console (gtm §4) — **~10 min**

Then: go build. The pitches compound or they don't (gtm §4, Weeks 7–12).

---

## Asset index

| File | What it is | When to open it |
|---|---|---|
| [`gtm-strategy.md`](gtm-strategy.md) | THE PLAN — positioning, NEVER-SAY list (§2), channel verdicts + SKIP list (§3), 90-day roadmap (§4), decision gates (§6) | Before writing ANY new claim; when deciding whether a channel is worth an hour |
| [`outreach-emails.md`](outreach-emails.md) | Wave-1 pitch drafts: EOGN, Family Tree Magazine, Genealogy TV. The tone exemplar for everything else | The send sitting, wave 1 |
| [`outreach-emails-wave2.md`](outreach-emails-wave2.md) | Wave-2 pitch drafts: Family History AI Show, Genealogy Guys, Amy Johnson Crow, Lisa Lisson, Family History Fanatics + combined 8-target send order | The send sitting, wave 2 |
| [`outreach-contacts.md`](outreach-contacts.md) | Verified wave-1 addresses, confidence tags, per-target rules | Before sending wave 1; when a contact needs re-verifying |
| [`followup-templates.md`](followup-templates.md) | Every follow-up + hot-reply template: EOGN/Genealogy TV/FTM follow-ups, the "yes" bridge, the decline, the thank-you, the skeptical-genealogist answer | The moment any reply (or 2–3 weeks of silence) arrives |
| [`reviewer-onepager.md`](reviewer-onepager.md) | The within-the-hour package for any reviewer "yes": access flow, honest tour, quick facts | Within the hour of any yes |
| [`press-kit.md`](press-kit.md) | Boilerplate (25/50/100 words), fact sheet, honest limits, hard-question FAQ, visual-asset paths | When press asks for anything; attach on any yes |
| [`demo-clip-script.md`](demo-clip-script.md) | Shot-by-shot 30–45s demo clip script + recording checklist + YouTube metadata | Recording day; before any video ask |
| [`play-listing-variants.md`](play-listing-variants.md) | 3 per-channel Custom Store Listing variants + screenshot captions + screenshot-order experiment | Play Console CSL setup; any listing copy change |
| [`review-response-templates.md`](review-response-templates.md) | 9 copy-paste Play review replies (≤350 chars) + the no-incentives rules | Within 48 hrs of any Play review |
| [`directory-listings.md`](directory-listings.md) | AlternativeTo entry + generic 50/100-word blurbs + directory SKIP list | The 15-min passive-listings slot; any directory form |
| [`local-press-pitch.md`](local-press-pitch.md) | Local human-interest pitch + 8 researched Aiken/Augusta contacts + one-newsroom rule | Weeks 3–6, after the media batch; any seasonal local re-pitch |
| [`marketing-calendar.md`](marketing-calendar.md) | 12-month opportunistic-moment calendar (Memorial Day, Family History Month, Halloween are the Top 3) | Start of each month, ≤1 hr, guilt-free to skip |
| [`../store-listing/description.md`](../store-listing/description.md) | Canonical Play listing copy (short + full description, title recommendation, live screenshot set) | Any listing change; keep in sync with the live Console listing |

---

## Deliberately NOT here

No self-posting kits, paid-channel plans, Product Hunt launch checklists, or content treadmills —
they're skipped on purpose; see the SKIP list in [`gtm-strategy.md`](gtm-strategy.md) §3 for why
each one is a trap.

---

## The metrics reminder (read before judging anything)

**~300–500 installs before the first sale is NORMAL** (0.3–1% cold conversion behind the
3-free-scan wall). Under ~300 cumulative installs, zero sales is statistical noise — don't pivot,
don't blame a channel, don't conclude marketing doesn't work. A media feature that moves installs
at all means the channel works; judge revenue separately. **The one metric that means "working"
is the SECOND purchase** — the first is a validation milestone, not a business. Full funnel +
decision gates: `gtm-strategy.md` §6.

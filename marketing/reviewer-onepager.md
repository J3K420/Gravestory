# Reviewer One-Pager — GraveStory

> Built 2026-07-01. The package to send within an hour of any reviewer or creator saying "yes"
> (see `outreach-contacts.md` for who, `outreach-emails.md` for the pitches that got them here).
> Everything below the owner-notes section is written to be pasted or attached as-is.
> Fill placeholders before sending: `[YOUR NAME]`, `[YOUR EMAIL]`, `[LINK WHEN RECORDED]`.
> Scrubbed against the NEVER-SAY list in `gtm-strategy.md` §2 — don't ad-lib claims beyond it.

---

## Owner notes (do NOT send this section)

- **Speed is the asset.** A "yes" cools fast. Send the email below within the hour; grant access within a few hours of getting their sign-in email.
- **Granting unlimited access:** the `is_unlimited` flag goes on their account after their first Google sign-in. Use the explicitly approved, UUID-targeted `tools/tester-access.mjs` workflow in `docs/database-change-control.md#tester-access`; do not copy privileged SQL into outreach notes.
- **Press kit: `marketing/press-kit.md` (written 2026-07-01).** It's markdown — export/print it to PDF before attaching, or paste it inline (the Links line below says "attached (PDF)"). Attach or link the demo clip once it exists.
- Everything from the next divider down is reviewer-facing.

---

## Copy-paste email body

> Hi [NAME],
>
> Thank you — genuinely — for being willing to take a look. I'll switch your account to unlimited free scans as soon as you've signed in (details below), and I've put everything you'd need in one place: the Play listing, a short fact sheet, the free community map, and a suggested tour that shows both where the app shines and where it's honest about coming up thin. If any question comes up, big or small, just reply.
>
> Best,
> [YOUR NAME]
> Developer, GraveStory
> [YOUR EMAIL]

---

## How your free access works

1. Install GraveStory from Google Play (Android): https://play.google.com/store/apps/details?id=com.gravestory.app
2. In the app, sign in with Google.
3. Reply with the email address you signed in with, and I'll switch your account to unlimited scans within a few hours — no codes, no expiry, nothing to redeem.

Until the switch lands you'll have the standard 3 free scans, so you can start immediately.

## The honest tour — what to try, in order

I'd rather show you the seams myself than have you find them, so here is both where the app is at its best and where it deliberately stays modest.

1. **Scan a well-documented stone first** — a famous grave, or a locally notable one (a town founder, a name from your county history). This is the full effect: the app reads the name, dates, and inscription, searches verified public records in parallel — WikiTree, Wikidata, historic newspapers via Chronicling America (pre-1928), county histories via the Internet Archive, Wikipedia — and writes a life story in about 30 seconds, with every source cited at the bottom so you can check each one. Famous figures also get a portrait, pulled from Wikipedia/Wikidata.
2. **Then scan a weathered, ordinary stone.** This is where we'd rather be honest than impressive: if the records searches come up empty, you get a short story built only from what the inscription itself says — no padding, no invented detail, no fake depth. Not every stone yields a rich biography, and the app never pretends otherwise.
3. **Browse the community map without an account:** https://gravestory.pages.dev/ — public stories shared by other visitors, free to read, no sign-in. (Living relatives' names are redacted before any story becomes public.)
4. **Tap a symbol chip** on a story whose stone carries carved symbols (clasped hands, a broken column, a lamb) — each chip opens a plain-language explanation of the symbol's conventional meaning. If your own scans happen to be plain stones, the community map is an easy place to find one.
5. **Try "Listen to this story"** — the app reads the biography aloud, for standing at the stone rather than staring at a screen.
6. If genealogy is your beat: stories export to **GEDCOM**, and every story has an **in-app report button**.

One caveat worth knowing before you write: the stories are compiled from public records with AI assistance. They can contain errors and are not authoritative records — that's why every fact is cited, why thin records produce short stories, and why the report button exists.

## Quick facts

| | |
|---|---|
| Platform | Android, live on Google Play since June 29, 2026 (iOS planned, not yet built) |
| Price | Free to sign in, 3 free scans. One-time credit packs — 5/$1.99, 20/$5.99, 60/$12.99, 150/$24.99 — that never expire. No subscription. |
| Community map | Free to browse on the web, no account required |
| Sources searched | WikiTree, Wikidata, Chronicling America (historic newspapers, pre-1928), Internet Archive county histories, Wikipedia |
| Portraits | Famous figures only (Wikipedia/Wikidata) — no photos of ordinary deceased people |
| Privacy | Living relatives' names are redacted before any story becomes public; full policy linked below |
| Maker | Solo independent developer, North Augusta, South Carolina |

## Links

- **Play listing:** https://play.google.com/store/apps/details?id=com.gravestory.app
- **Press kit:** attached (PDF) — or ask and I'll paste it inline
- **Demo video:** [LINK WHEN RECORDED]
- **Community map (no account needed):** https://gravestory.pages.dev/
- **Privacy policy:** https://gravestory.pages.dev/privacy-policy/

## What we'd love

An honest review — good or bad. If something is wrong, confusing, or overclaimed, I want to know; corrections are welcome and I'll fix what I can fix. We never pay for coverage, and the free access carries no strings: write what you actually find.

## Contact

[YOUR NAME] — [YOUR EMAIL]
I reply within 24 hours, usually much faster.

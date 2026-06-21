---
title: "Product Brief: Option B — Background Scanning"
status: shelved
created: 2026-06-21
updated: 2026-06-21
---

# Product Brief: Option B — Background Scanning

> **SHELVED 2026-06-21 (not built for launch).** The durable server-side job this brief
> describes needs the clean Cloudflare Queues / Durable Objects pattern, which requires the
> **Workers Paid plan ($5/mo)**; the project is on the Cloudflare free tier. Holding a 40s
> pipeline open in a single free-tier Worker request is too fragile to launch on.
> **Replaced for launch** by a small loading-screen reassurance message (stay on the page;
> if you switch away the scan resumes where it left off on return) — pure OTA, no build, no
> Cloudflare cost. Revisit this brief if/when on Workers Paid. The design below is preserved
> as-is for that future.

## Executive Summary

GraveStory turns a photo of a gravestone into a researched biography. That research is genuinely heavy — Gemini vision, OCR, parallel lookups across six genealogy and archive sources, a Gemini-written narrative, geocoding, and symbol interpretation — and it takes roughly forty seconds. Today all of that runs on the phone's JavaScript thread. The moment a user leaves the app mid-scan — to answer a text, check a map, anything — the operating system suspends that thread and the pipeline simply **freezes**. When the user returns, they find a loading screen exactly where they left it, stalled. It reads as broken.

Option B moves the research-and-biography pipeline off the phone and onto GraveStory's existing Cloudflare Worker. The phone uploads the photo and location, the Worker runs the entire pipeline server-side, writes the finished biography to Supabase, and sends a push notification — one that arrives **even if the app is fully closed**. Every scan becomes a server job; the phone is simply a live watcher of that job. A fast scan still feels instant. A slow scan now survives the user walking away: they can start a scan, leave the app entirely, text a friend, and come back — or get pinged — to a finished story.

This is a launch blocker. With roughly a week until the Play Store production rollout, the long loading screen is the single largest experiential risk, and the "leave-and-return-to-a-frozen-screen" moment is the version of it that most reads as a broken product. Background scanning is how that wait stops being a liability.

## The Problem

**The pipeline freezes when the app is backgrounded.** A managed Expo app cannot run a forty-second network chain in the background — Android suspends the JS thread within seconds. The scan pipeline is a chain of `await`s on that thread, so backgrounding pauses it mid-flight; it resumes only when the user foregrounds the app again.

**The lived experience is the damage.** A real scenario: a visitor photographs a headstone, knows it takes a moment, switches to Messages to tell a friend where they are, comes back — and the app is sitting on the same loading screen it had thirty seconds ago, apparently stuck. The work didn't continue. To the user, the app looks frozen or broken. This is the "wtf is this" moment, and it is the worst-feeling version of the latency problem.

**It cannot be fixed on the phone.** This is an OS constraint, not a code bug. No amount of client optimization makes a 40s `fetch` chain run while the app is backgrounded. The only real fix is to move the long-running work somewhere that does not get suspended: a server.

**The latency itself is largely irreducible.** The two anchor steps — Gemini OCR and the Gemini biography call — are serial and genuinely take their time; their duration scales with real work, not configuration. Shaving the wait helps at the margins (and recent concurrency work did), but the wait will remain long enough that "leave and come back" is a normal user behavior we must support rather than fight.

## The Solution

Move the research-and-biography pipeline server-side onto the existing Cloudflare Worker, and make every scan a background job the phone observes.

**The flow becomes:**

1. The phone captures the photo, reads EXIF/device GPS, and uploads the image plus location to the Worker (the image goes to R2, as photos already do).
2. The Worker **creates a job**, runs server-side verification and OCR, and — on OCR success — **counts the scan** (the cost gate, moved from client to server). Then it runs the full pipeline: parallel research across Tavily, WikiTree, Wikidata, Chronicling America, Internet Archive, and Wikipedia; the Gemini biography; portrait resolution to R2; geocoding; and symbol-meaning resolution.
3. The Worker writes the finished biography to Supabase and marks the job complete.
4. The phone learns the result one of two ways: if the app is open, a **live watcher** on the loading screen sees the job finish and renders the story immediately (a fast scan feels instant); if the app is backgrounded or fully closed, a **push notification** — "Your story is ready" — brings the user back, and reopening shows the finished story.

**Because routing is automatic, there is one pipeline, not two.** Every scan is a server job; the foreground loading screen is just a live view of it. The current synchronous foreground pipeline is not kept as a separate path — it becomes the degenerate fast case of the background pipeline (the watcher happens to see the job finish before the user ever backgrounds). This is simpler to maintain than two coexisting pipelines, with one important consequence: the server pipeline must be complete and correct before launch, because it is the only pipeline.

## What Makes This Different

This is not a differentiator against competitors — it is table stakes for a professional app, and the brief treats it that way. The honest framing: **GraveStory currently does something users will reasonably expect to "just work" (leave an app while it loads), and it doesn't.** Option B closes that gap.

The one genuine advantage worth naming is leverage: GraveStory **already has the server.** The Cloudflare Worker already proxies Gemini and Tavily and hosts the RevenueCat webhook; R2 already stores images; Supabase already stores stories. Option B is mostly *relocating* existing pipeline logic onto infrastructure that already exists, not standing up new systems. A secondary benefit falls out for free: moving the scan-cost gate server-side closes a class of client-side abuse, because the client can no longer be the source of truth for how many scans it has used.

## Who This Serves

**The cemetery visitor, in the field.** The primary user is standing in a cemetery, often on cellular, photographing a stone and wanting its story. They are not going to stare at a loading screen for forty seconds — they will switch apps, walk to the next stone, or pocket the phone. Success for them is simple: they get their story without having to babysit the app, and they are told when it is ready.

**The returning user.** Someone who scanned earlier, left, and is reminded by a notification that their story finished. The push notification turns a forgotten loading screen into a re-engagement moment.

**[ASSUMPTION] Secondary: the web user.** Background scanning is mobile-first. The web app has the same freeze-class problem to a lesser degree (browser tabs are less aggressively suspended), and web parity is explicitly a *later* consideration, not part of this launch-blocking effort.

## Success Criteria

**The launch-blocking bar (must hold before production rollout):**

- A user can start a scan, fully close the app, and reopen later to a finished biography — with no data loss and no frozen state.
- A "Your story is ready" push notification arrives when the app is backgrounded or closed, and tapping it opens the finished story.
- A fast scan with the app open still feels essentially as fast as today — the watcher renders the result the moment the job completes, with no added perceived latency.
- The server pipeline produces biographies of the **same accuracy and breadth** as today's client pipeline (same sources, same corroboration, same bio depth) — this is a relocation, not a downgrade.
- Scan-cost accounting is correct: a scan is charged exactly once, at OCR success, server-side; a duplicate or retried job never double-charges.

**[ASSUMPTION] Health signals (post-launch, measurable):**

- Share of scans where the user backgrounds the app before completion — the population this feature exists for.
- Job success rate and median server-side completion time.
- Push-notification delivery and tap-through rate.
- Zero increase in "stuck loading" support reports relative to the synchronous baseline.

## Scope

**In scope (launch-blocking):**

- Server-side pipeline on the Cloudflare Worker: verification, OCR, parallel research (all six sources), Gemini biography, portrait resolution to R2, geocoding, symbol-meaning resolution — at parity with the current client pipeline, including the recently added famous-grave (cemetery + surname) recovery.
- A job model in Supabase: create, run, complete/fail states, and the result linkage to the story.
- Server-side scan-cost gating at OCR success (moved from client), charged exactly once.
- The phone as a watcher: upload, live job-status observation on the loading screen, and rendering the result on completion.
- Full push notifications via `expo-notifications` (+ push tokens), working when the app is fully closed — which **requires a new native build**.
- Android (the launch platform). [ASSUMPTION] iOS push is included where it comes for free with the same Expo mechanism, but iOS is not the launch target and is not a blocker.

**Out of scope (this effort):**

- Web parity for background scanning — a separate, later effort.
- Any change to the *accuracy or breadth* of research (this is a move, not a re-tuning).
- The synchronous client pipeline as a long-lived independent fallback — it is subsumed by the watcher model, not maintained separately. [ASSUMPTION] A minimal client-side path may remain only as a defined degraded fallback if the job system is unreachable; whether that fallback exists at all is an architecture-phase decision.
- New biography features, new sources, or UI redesign beyond what background scanning requires.

## Key Risks

- **One-pipeline correctness.** Because automatic routing makes the server pipeline the *only* pipeline, it must be at full parity before launch — there is no synchronous fallback to hide behind. Porting six research sources, the bio prompt, corroboration, and the famous-grave recovery to the Worker correctly, inside a week, is the central execution risk.
- **The Worker runtime is not Node.** Pipeline code currently lives in `mobile/src/lib/` as ES modules assuming a React Native runtime; the Worker is a different environment (no `expo-*`, different fetch/timeout/concurrency characteristics, CPU-time limits per request). Long-running multi-source jobs may bump Worker execution limits and need a durable-execution or queue pattern, not a single long request. **[ASSUMPTION] this likely requires Cloudflare Queues or Durable Objects, to be settled in architecture.**
- **New native build on a one-week clock.** `expo-notifications` is native, so push requires a fresh EAS build and Play submission — which has its own review latency. The build/submit timeline, not just the code, is part of the launch-blocker risk.
- **Cost-gate migration is money-sensitive.** Moving scan counting and credit consumption server-side touches the same surface as the just-hardened RevenueCat/credits path; it must remain idempotent and not regress the monetization fixes already shipped (migrations 016/017).
- **Notification reliability and dedup.** A job that completes must notify exactly once; retries, redeliveries, or a user with multiple devices must not produce duplicate or missing pings.
- **Migration of in-flight behavior.** Existing users on the current synchronous build must not break when the server pipeline goes live; the phased rollout (and whether old clients keep working) needs an explicit plan.

## Vision

If this lands, scanning a gravestone becomes a fire-and-forget action: point, shoot, walk away, get told when the story is ready. That unlocks the natural field behavior — moving stone to stone through a cemetery, queuing several scans, reading them later — instead of standing still babysitting a loading bar. Server-side scanning also becomes the foundation for things that are awkward client-side today: heavier research, batch/queued scans, and eventually the planned AR ghost-narrator, all of which are easier when the pipeline already lives on the server. The immediate goal is narrow and concrete — make the long wait survivable so it stops feeling broken at launch — but the architecture it establishes is where the product goes next.

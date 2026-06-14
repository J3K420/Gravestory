# GraveStory AR Holographic Narrator — Feasibility Report & Phased Build Plan

*Prepared for the founder · 2026-06-13 · Lead architect synthesis of 5 verified research lanes (31 agents, ~1.56M tokens, every load-bearing claim adversarially fact-checked against current 2026 vendor pricing & library status).*

---

## 1. Executive summary

**Can we build it? Yes — and most of the hard part is already built.** The world-anchored AR narrator is feasible from the existing Expo SDK 54 dev-client codebase without ejecting to bare React Native and without standing up a second engine. The biography, its citations, and the structured data the narrator needs already exist on every saved story; the AR/voice layer is additive.

**Recommended v1 stack (one paragraph):** Render a single reusable, translucent "cemetery guide" as a rigged **3D GLB** (skeletal idle/float animation + a viseme blendshape for cheap jaw-flap lip-sync) anchored to a real-world plane via **ViroReact (`@reactvision/react-viro`)** installed as an Expo config plugin into the existing dev-client. Narrate the already-generated biography with **Gemini 2.5 Flash TTS**, pre-synthesized once and cached as audio in R2 (reusing the same Worker, same `GEMINI_KEY`, same Google billing — only the model id is added to the allowlist). Make "talking to it" a **tap-a-suggested-question + typed free-text** experience answered by one grounded Gemini call on the existing Worker proxy and spoken back with on-device `expo-speech` — *no microphone, no STT, ships via OTA*. Defer voice input, premium voices, and streaming to later phases.

**Rough all-in cost to a first working demo:** **$0–$300 in assets** (free avatar base + free animations, or a small Fiverr art pass for the "spirit" material) plus **engineering time only**. There is **zero recurring per-session license cost** in this stack. Per-narration runtime COGS is **~$0.065 the first time a bio is voiced and ~$0 on every replay** once cached — well inside the existing per-scan margin.

**The single key risk:** ViroReact is a **native module**, so the entire AR/voice-asset layer leaves the OTA-to-production fast loop the team relies on — every AR change is a new EAS build, new versionCode, and Play review. The first build must also pass a hard **device-validation gate**: confirm animated-GLB + plane anchoring actually render on a real mid-range Android phone in a dev-client build before committing further, and confirm the project's **New Architecture** status (Viro now requires New Arch — a more material gate than the RN minor version, which is fine: Viro's `peerDependencies` already cover RN 0.81.5 / Expo 54).

---

## 2. The moat thesis

**The AR is the wedge. The grounded, cited biography pipeline + the accumulating corpus is the moat.**

**Why it's defensible:**
- **AR is now commoditized.** Niantic retired 8th Wall's paid platform (Feb 28 2026) and open-sourced the engine; ARCore plane/geospatial anchoring, Google TTS/STT, and Gemini are all pay-as-you-go. Anyone can render a hologram. Rendering is not the asset.
- **No competitor pairs world-anchored AR narration with auto-generated, multi-source, *cited* biographies.** The "talking dead" players (StoryFile — which filed Chapter 11 in 2024 — and HereAfter AI) require the deceased to have *recorded themselves before death*, which is useless for the 99%+ of historical graves GraveStory targets. QR-headstone companies ($49–79 one-time) are static family-uploaded plaques with no research and no scaling corpus. Gravesider uses costumed-actor re-enactments, not researched bios.
- **The cited framing is also the *ethical* moat.** Narrating verifiable public-record history (with sources) sidesteps the intensifying "deadbot"/griefbot regulatory backlash around post-mortem consent and hallucinated personalities — GraveStory narrates a *historical guide*, never a simulated personality of a recently-deceased loved one.
- **Defensibility compounds.** The saved/deduped grave corpus and first-correction-wins GPS pins are proprietary data a copycat must rebuild from zero.

**Honest counterarguments (do not skip these):**
- The pipeline is built *on* commodity APIs (Gemini OCR+bio, Tavily, free genealogy sources). It is strong engineering, not patent-defensible IP. Google could replicate the bio-generation step trivially.
- **The most dangerous incumbent is FindAGrave/Ancestry** — they already own the graves, the photos, *and* the visitor audience. Google/Niantic own the whole stack (ARCore Geospatial + Gemini + a POI graph). A memorial incumbent (Legacy.com, a large cemetery operator) could bolt AR onto distribution GraveStory lacks.
- **The moat is currently thin** because the corpus is tiny (~12 testers). The proprietary-data advantage is theoretical until saved-grave coverage grows.

**Conclusion:** Build the AR narrator to *grow the corpus and drive installs*, not as the end in itself. What must be defended is **speed-to-corpus and the cited-bio quality bar.**

---

## 3. Recommended v1 architecture

One concrete stack, mapped against the existing Expo SDK 54 dev-client + Cloudflare Worker + Gemini + R2 + Supabase setup.

| Layer | Choice | How it sits relative to the existing stack | OTA-friendly? |
|---|---|---|---|
| **AR engine** | **ViroReact `@reactvision/react-viro` v2.56.0** (config plugin) | Installs into the *existing* expo-dev-client via the plugins array; bridges to native ARCore for real plane/world anchoring. No eject, no second engine, no per-session fee. | ❌ **Native — new EAS build, no OTA** |
| **Narrator asset** | **Rigged 3D GLB** (skeletal float/idle + viseme blendshape), translucent + emissive "hologram" material, rendered as a `Viro3DObject` | Asset is a static file bundled once and cached on-device → ~$0 marginal per session. Loaded by Viro. | Asset swaps need a build (bundled); animation *logic* tweaks can OTA |
| **TTS narration** | **Gemini 2.5 Flash TTS** (`gemini-2.5-flash-preview-tts`), pre-synthesized once → cached MP3/WAV in **R2** | Same `generativelanguage.googleapis.com/...:generateContent` endpoint the Worker *already* proxies, same `GEMINI_KEY`, same billing. **Only Worker change: add the model id to `ALLOWED_MODELS`** (confirmed currently absent — see `worker.js:36-43`). Audio URL persists on the story and syncs like portraits. | New `api-tts.js` is JS (OTA-able); but **playback needs `expo-audio`, a new native dep → first ship needs a build** |
| **"Talk to it"** | **Tap-a-suggested-question + typed free-text**, one grounded Gemini call (`gemini-2.5-flash-lite`, already in allowlist) → answer spoken via on-device **`expo-speech`** (free) | Identical call path to existing `api-gemini.js` (`X-Client-Key`, `geminiCallWithFallback`). **No new backend, no microphone, no Play permission change.** | ✅ **Pure JS — ships via OTA** |

**The 2D/2.5D vs 3D decision (and why 3D wins for v1):**

You explicitly asked for a 2D/2.5D-vs-3D price comparison expecting 2D to be cheaper. It *is* cheaper to author — but **the world-anchoring requirement kills it for v1.** The narrator must be **world-anchored and appear to stand/float/walk near the grave as the user circles it.** A flat 2D billboard sprite has no volume or parallax; it cannot satisfy "walks near the grave" convincingly — it always faces the camera like a paper cut-out. **2.5D Live2D** has the most distinctive "ghostly" look but **has no first-class React Native renderer** — it would require a native bridge or a WebView-embedded WebGL build, the single highest integration risk on Expo/Android. **Only a real 3D GLB satisfies world-anchoring**, and critically it costs the *same* as 2D in iteration one: **$0** using free tooling, or **$0–$300** with a small art pass.

**Price delta:** 2D sprite (~$0 AI-generated to $150–$600 commissioned) vs 3D GLB (~$0 free pipeline to $300–$1,500 commissioned) — *overlapping at the free/cheap end*. Since 3D is the same price as 2D at v1 **and** the only one that meets the spec, **3D GLB is the unambiguous winner.** 2D is not a cost saving here; it's a capability downgrade for no real money saved.

> **Asset-source caveat (verified, important):** The original "Ready Player Me" recommendation is **obsolete** — Netflix acquired RPM (Dec 2025) and its avatar tool/SDK/APIs went dark **Jan 31 2026**. As of June 2026 RPM is a **dead dependency**. Substitute a live free pipeline (e.g. Mixamo for animations — *also* now Adobe-deprioritized and "unsupported," so treat as usable-but-platform-risk — plus an open/self-hosted avatar base), or a one-time Fiverr GLB commission requesting embedded ARKit/Oculus visemes. **Do not build the asset pipeline on RPM.** A single $300–$800 commissioned stylized "spirit" GLB with a skeleton + a jaw/mouth blendshape is the safest concrete plan.

**Lip-sync at v1** is deliberately crude and cheap: `expo-speech` (and Gemini TTS) provide **no phoneme/viseme stream**, so v1 toggles a single jaw/mouth blendshape on speech start/stop. It looks "good enough" for a stylized hologram. The viseme blendshapes live in the asset already, so a later upgrade to true viseme-timed mouth shapes (via a TTS-with-visemes provider) needs **no re-authoring**.

**What leaves the OTA path (and the consequence):** ViroReact, the bundled GLB, `expo-audio`, and (in Phase 2) `expo-speech-recognition` are all native. The first narration/AR release **must ship as an EAS build with a new versionCode and go through Play review** — days of latency, not a same-day OTA. Plan AR work in **build-gated batches.** Everything *downstream* (prompt tweaks, suggested-question copy, conversation logic, narration text changes) stays OTA-able.

---

## 4. Asset price-check table

| Path | One-time cost | Per-session cost | Performance (mid-range Android) | Lip-sync | Hologram look | World-anchor fit |
|---|---|---|---|---|---|---|
| **2D sprite / billboard** | $0 (AI-gen) – $600 (Fiverr) *[est]* | $0 | Excellent (tiny PNGs) | Crude frame-swap on `isSpeaking` | Alpha/glow baked into PNG — composites naturally | ❌ Flat; no parallax, doesn't "walk" |
| **2.5D Live2D puppet** | $0 SDK*; $200–$1,500 rigged commission *[est]* | $0 | Good, but via native bridge/WebView | Real mouth-open parameter (better than 2D) | Expressive, characterful | ❌ Still 2.5D; **no RN renderer = top integration risk** |
| **Full rigged 3D GLB** ✅ | **$0 free pipeline – $1,500 commission** *[est]* | **$0** | Good (one low-poly rig is fine) | Single jaw blendshape v1 → true visemes later, **no re-author** | Translucent + emissive material = convincing | ✅ **Real volume; stands/floats/walks near grave** |
| **AI talking-head service (D-ID / HeyGen)** | $0 art | **$1–$5.90/MINUTE** *(FACT)*; streaming gated behind paid plans | N/A (cloud video stream) | Broadcast-quality automatic | ❌ **Flat rectangular video — cannot composite as a translucent hologram** | ❌ Not anchorable; cloud-dependent |

\* Live2D SDK is genuinely free below ¥10M (~$67k) annual sales (GraveStory qualifies today). Middle tier (¥10M–¥100M) = ~$312 initial + ~$125/mo per platform.

**Clear winner for v1: full rigged 3D GLB.** Same price as 2D at the cheap end, the only option that meets world-anchoring, and the only one with **zero recurring COGS** — which is decisive. AI talking-head services are disqualified outright: their **$1–$5.90/minute** billing would put **$2–$12 of COGS on a single narrated scan**, obliterating the sub-cent-per-scan economics, and their flat video output is physically incompatible with a translucent anchored hologram.

---

## 5. Per-session COGS model

Modeled on a **typical ~650-word bio** (~4.3 min narration; the bio length is set by the evidence ladder confirmed in `js/biography.js:443-448`). All figures are FACTs from vendor pricing unless labeled ESTIMATE.

| Line item | v1 choice | Cost per AR-narration session | Notes |
|---|---|---|---|
| **TTS narration** | Gemini 2.5 Flash TTS, pre-cached in R2 | **~$0.065 first time; ~$0 every replay** | $0.50/1M input + $10/1M audio tokens (25 tok/sec). Batch API halves to ~$0.033. Cache key = grave_id + bio-hash. |
| **STT (voice input)** | **None in v1** (tap + typed) | **$0** | No mic, no STT bill, no permission. (Phase 2 on-device STT = $0; cloud STT only if needed: Google STT v2 streaming **$0.016/min** — note original research's $0.064/min was *refuted*, real rate is 4× cheaper.) |
| **Gemini conversation turn** | `gemini-2.5-flash-lite` grounded on the persisted story | **~$0.0005–$0.0015 / turn** | $0.10/1M in + $0.40/1M out. Bio already in context; prompt-cache for multi-turn. |
| **Reply TTS (Q&A answer)** | `expo-speech` on-device | **$0** | Robotic but free; acceptable for short answers. |
| **Avatar render / delivery** | On-device GLB, bundled + cached | **~$0 marginal** | No cloud render. Asset is a one-time download. |
| **Bandwidth** | R2 (zero egress) | **~$0** | ~0.5–2 MB MP3 per bio; R2 has no egress fee. |
| **TOTAL per typical session** | | **~$0.065 first narration of a grave; ~$0.001–$0.01 thereafter (with a few Q&A turns)** | Caching per grave_id is the single biggest COGS lever. |

**Where it fits the freemium model & pricing recommendation:**

- **AR narration of the already-generated bio = FREE, bundled into the scan the user already paid for.** The bio exists; TTS is sub-cent and ~$0 on repeats. Charging again would suppress the exact viral demo that drives installs.
- **The interactive "talk to the guide" Q&A = the PREMIUM CREDIT SINK.** It carries the one *unbounded* variable cost (a chatty user can fire 20+ turns; a premium reply voice multiplies it 5–8×). Meter it on the **existing `scan_credits` rail** — e.g. a conversation session (or every N turns) costs 1 credit — so no new billing primitive and consistent with the credits-only, never-expire model already chosen. **Cap conversations at ~8–10 turns** to bound the tail, and give every user **1–2 free conversation sessions** so they feel the magic before paying.
- **Do NOT create a separate AR subscription tier.** It adds billing complexity, contradicts the credits-only model, and recurring billing on a memorial is a known churn/PR liability in grief-tech.

> **COGS guardrail:** ensure narration **replays hit the R2 cache first** (re-synthesizing on every Result-screen open would silently inflate Gemini spend), and that Q&A calls are **not counted against the lifetime scan limit** but are cheap/capped enough that an abusive loop can't run up the bill — mirroring how `resolveSymbolMeanings` is explicitly not scan-gated. Aligns with backlog item #11 (Worker budget guard).

---

## 6. Phased build plan

Each phase lists goal · what's built · library/native work · OTA-or-build · rough effort · decision gate.

### Phase 0 — "Does the *feeling* land?" (cheapest possible proof)
- **Goal:** Validate that hearing the bio narrated by a presence in the camera view *delights* before committing to heavy world-anchored 3D work.
- **What's built:** A **non-anchored AR-lite overlay** — the existing camera view with a translucent narrator (even a 2D sprite or a static GLB rendered in `expo-gl`, *floating, not plane-anchored*) + **bio narration** via `expo-speech` (on-device, free) OR a quick Gemini-TTS pre-cache, + the **tap-to-ask** suggested-question chips answered by the existing Gemini proxy and spoken aloud.
- **Library/native work:** Minimal. Tap-to-ask + grounded Gemini Q&A is **pure JS (OTA)**. `expo-speech` is bundled (no plugin). If you want cached neural TTS, add the model to `ALLOWED_MODELS` + `api-tts.js` (JS/Worker) but you'll need `expo-audio` (one native build).
- **OTA or build:** Tap-to-ask + `expo-speech` narration = **OTA-shippable today.** Cached Gemini-TTS playback = one build.
- **Effort:** ~3–6 days (most of it the Q&A grounding prompt + UI).
- **Decision gate:** Do testers say *"whoa"*? Do they tap questions? If the overlay-without-true-anchoring already delights, you've de-risked the whole feature for almost nothing. If it feels gimmicky even with narration, **stop here** — don't fund world-anchored AR.

### Phase 1 — True world-anchored AR narrator (the real feature)
- **Goal:** The narrator **stays planted / appears to stand by the grave** as the user moves; narrates the cached bio; tap-to-ask works in-scene.
- **What's built:** ViroReact config plugin into the dev-client; `Viro3DObject` loading the commissioned translucent GLB on a detected plane (`ViroARPlaneSelector`); jaw-flap lip-sync on TTS start/stop; cached Gemini-TTS narration from R2; capability detection + graceful fallback to the existing static Result screen on non-ARCore devices.
- **Library/native work:** **`@reactvision/react-viro` (native), bundled GLB, `expo-audio` (native).** Confirm New Architecture is on; pin Viro to a release whose `peerDependencies` cover RN 0.81.5 / Expo 54 (v2.54.0+ already does).
- **OTA or build:** ❌ **New EAS build + versionCode + Play review.** Camera permission already exists; **no mic permission needed** (tap/typed Q&A).
- **Effort:** ~2–4 weeks, dominated by the asset/material pass + the on-device validation loop (each iteration is a build).
- **Decision gate (hard, do this first in the phase):** On a **real mid-range Android device in a dev-client build**, confirm animated-GLB skeletal playback + plane anchoring + the translucent material all render correctly. Viro has historically had glTF-animation rough edges. **If this gate fails, fall back to Google Scene Viewer** (free, real ARCore anchoring, zero native code) as an AR-lite concept test — accepting it sacrifices the in-app narrator UI, live TTS, and Q&A (those move to a separate non-AR screen).

### Phase 2 — Voice input ("actually talk to it") + voice/quality upgrades
- **Goal:** Hold-to-talk questions; optionally a premium narrator voice and true viseme lip-sync.
- **What's built:** `jamsch/expo-speech-recognition` (on-device, $0, MIT) feeding the *same* grounded Gemini call; optional swap of narration to a TTS-with-visemes provider (Azure/ElevenLabs Flash) driving the blendshapes already in the asset; optional metered "talk to the guide" credit sink goes live.
- **Library/native work:** `expo-speech-recognition` — **for Expo SDK 54, pin the `sdk-54` dist-tag (resolves to v3.1.3), NOT the latest 56.x** (which targets SDK 56). Adds `RECORD_AUDIO` → a Play Console data-safety/permission declaration (the team has navigated a media-permission declaration before).
- **OTA or build:** ❌ **Native — new EAS build + mic permission review.**
- **Effort:** ~1–2 weeks.
- **Decision gate:** Does v1's tap-to-ask show enough conversation engagement to justify mic + premium voice cost? On-device STT mis-hears old proper nouns; only proceed if grounded deflection ("I don't have that in the records") keeps it from feeling broken. Only adopt premium voice if voice quality measurably drives retention (it's a 30–50× cost swing).

---

## 7. Risks & open questions

**Technical**
- **Native = no OTA (highest operational risk):** every AR/voice-native change is a build + versionCode + Play review; breaks the team's fast loop. Batch AR work.
- **Device fragmentation / ARCore gating:** users on non-ARCore phones or without Google Play Services for AR get nothing — *must* ship capability detection + graceful fallback to the static Result screen.
- **Viro glTF-animation maturity:** animated GLB on Android is community-reported working (v2.54.0+) but historically rough — **validate on real hardware before committing** (this is the Phase 1 gate).
- **New Architecture requirement:** Viro requires New Arch — confirm the project's status; this is a more material gate than the RN minor version (RN 0.81.5 is already inside Viro's supported range).
- **Latency:** with no STT leg, perceived latency is Gemini (~0.7–2s on flash-lite) + TTS start; mask it with an idle/"thinking" animation and an immediate canned filler line ("Let me recall what I know…") while the call is in flight.
- **Uncanny valley / asset quality:** generic avatars read as "metaverse NPC," not "spirit" — budget the translucent/emissive material pass even on a free base mesh.
- **Gemini TTS quirks (verified):** it's a **preview model** (can change/deprecate — pin a GA fallback like Google Neural2 or `tts-1`) and returns **raw 24kHz PCM, not MP3** — the pipeline must wrap PCM in a WAV header (client or Worker) or `expo-audio` won't play it.
- **Dead-dependency landmines:** **Ready Player Me is discontinued** (APIs dark since Jan 31 2026); **Mixamo is Adobe-"unsupported"** with 2025 outages. Treat both as platform-risk; prefer a commissioned GLB you own.

**Product**
- **Delight vs gimmick** is the whole bet — that's why Phase 0 exists. If a narrated overlay doesn't already wow testers, world-anchored 3D won't save it.
- **Famous-figure grounding:** Q&A must stay pinned to the rendered bio + sources (reuse the bio pipeline's proven *"answer only from CONTEXT… memory is not a source"* framing), so the narrator can't free-associate from the model's open-world memory on a factual-death product.

**Cost**
- **Conversation COGS is unbounded** unlike the lifetime scan counter — hard turn cap + on-device default voice + credit metering required.
- **Premium voice is a 30–50× swing**; cache-warming gap on a viral grave can incur a brief uncached bill — default to a cheap voice + synth-on-first-view + immediate R2 cache.

**Store review / permissions**
- **v1 needs only the camera permission** (already declared) — *no mic* because Q&A is tap/typed. This keeps Phase 1 review clean.
- **Phase 2 adds `RECORD_AUDIO`** → a Play data-safety declaration (process known to the team).
- **Deadbot regulatory trend:** keep narration strictly grounded/cited and labeled a "historical guide," never a simulated personality of a recently-deceased person — that framing is both the ethical moat and the store/legal safety margin.

**Open questions to resolve before Phase 1:**
1. Is the project on the **New Architecture**? (Hard Viro prerequisite.)
2. Commission-vs-DIY for the GLB — who produces the "spirit" asset, and at what rights/budget ($300–$800 recommended)?
3. Confirm `gemini-2.5-flash-preview-tts` (or the newer `gemini-3.1-flash-tts-preview`) is the chosen TTS id and add **exactly that string** to `ALLOWED_MODELS` (mismatch → 400).

---

## 8. Recommendation & next step

**Build it — but earn each phase with a demo gate, and protect the OTA loop by batching the native work.**

**Monday morning, do Phase 0 — the cheapest possible proof, almost all of it OTA-shippable:**
1. **Wire tap-to-ask** onto the Result screen: 4–6 suggested-question chips (`How did they die?`, `What was their family?`, `What do the symbols mean?`, `What records exist?`), each firing **one grounded `gemini-2.5-flash-lite` call** on the *existing* Worker proxy, with the persisted story (biography, sources/source_urls, inscription, symbols+meanings, relationships, subjects/dates) as the CONTEXT block and the bio pipeline's exact anti-hallucination framing. Speak answers with **`expo-speech`** (free). **This is pure JS and ships as an OTA today** — it tests the "conversational" half of the magic with zero native work and zero new cost.
2. **Stand up a translucent narrator overlay** in the live camera view (non-anchored is fine for the proof) reading the bio aloud.
3. **Put it in front of the ~12 testers and one cemetery walk-through yourself.** The gate: *do people light up and tap questions?*

If Phase 0 lands, **commission the "spirit" GLB** (own the asset; don't build on Ready Player Me) and schedule **Phase 1 (ViroReact world-anchored) as a single EAS build**, opening that build with the on-device animated-GLB + plane-anchor validation gate. Keep voice input, premium voices, and the metered "talk to the guide" credit sink for Phase 2.

**The one-line strategic frame to hold onto:** ship the AR narrator as a **growth wedge that grows the corpus and drives installs** — the defensible asset is the grounded, cited biography pipeline and the accumulating proprietary grave corpus, and what must be defended against a FindAGrave/Ancestry or Google fast-follow is **speed-to-corpus and bio quality**, not the AR rendering itself.

---

*Confidence notes: AR-engine, TTS-pricing, conversation-cost, and Worker-reuse facts are verified against vendor docs and the live repo (`worker.js:36-43`, `js/biography.js:443-448`). Flagged uncertainties: Ready Player Me is dead (substitute required); Mixamo is unsupported (platform-risk); Gemini TTS is a preview model returning raw PCM; Viro glTF-animation must be validated on real Android hardware; bio word/char counts and some commission prices are ESTIMATES, not facts.*

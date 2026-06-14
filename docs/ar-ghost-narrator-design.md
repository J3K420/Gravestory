# AR Ghost Narrator — Product & Pricing Design

> Status: **design captured, not built.** Roadmap (Phase B / post-launch). Companion to
> [`ar-holographic-narrator-feasibility.md`](./ar-holographic-narrator-feasibility.md),
> which covers the *technical* feasibility (ViroReact + Gemini-TTS, 3D GLB, Phase 0
> tap-to-ask OTA proof). This memo covers the *product model, the conversational
> design, the guardrails, and how it is paid for.*
>
> Decided in the 2026-06-13 pricing session. The trigger was a COGS review: Tavily
> runs ~11 credits/scan (~$0.09 all-in COGS), and the question "how are the scan
> prices doing" led to "raise prices," which led to "what's the price buffer for?",
> which surfaced the AR ghost as the thing the buffer funds.

---

## 1. The one-liner

**One scan credit = one researched bio = one ghost you can summon at the grave, who
answers up to three questions.** The ghost reads its own biography first, then draws
on the fuller source material already gathered for that scan, and — only if a question
still goes unanswered — *may* consult the records once or twice more. It speaks plainly
about what the records hold, and when asked beyond them it does not refuse: it shifts to
a wistful, openly-imagined voice. **It imagines the world, never fabricates the person.**

Three wishes, bounded and grounded. Like a genie.

---

## 2. Pricing model — the AR feature is pre-funded, not surcharged

The price increase decided in this session **is** how AR gets paid for. There is no
separate "AR currency," no AR surcharge, no second paywall.

### New prices (Premium set)

| Pack | Product ID | Scans | Old price | **New price** | $/scan |
|---|---|---|---|---|---|
| Starter | `gravestory_5_scans` | 5 | $0.99 | **$1.99** | $0.40 |
| Explorer | `gravestory_20_scans` | 20 | $2.99 | **$5.99** | $0.30 |
| Historian | `gravestory_60_scans` | 60 | $6.99 | **$12.99** | $0.22 |
| **Legacy / Gift** | `gravestory_150_scans` | 150 | — *(new)* | **$24.99** | $0.17 |

Free tier unchanged: **guest 3 / signed-in 10** lifetime scans.

The **Legacy tier was added 2026-06-13** following pricing research (see below). The
per-scan prices are fair-to-cheap for 2026 (the ~$0.20/credit consumer norm; cheaper than
the $0.10–0.60 per-usable-output band of AI headshots). The real underpricing was
*structural* — every emotional/legacy comparable charges 5–50× more (BillionGraves Plus
$60/yr, HereAfter AI $4–8/mo, StoryWorth $59–199, Ancestry $20–40/mo). The Legacy tier
captures the high-WTP gift/legacy buyer without raising the floor (which would fight the
*free* category competitors — Find a Grave, FamilySearch, BillionGraves core lookup). It
also anchors the $12.99 Historian as the "sensible middle," lifting its take rate. Even
at $0.17/scan the Legacy tier holds ~47% margin.

Deferred (revisit post-launch with telemetry): a first-purchase intro offer (Starter at
$0.99 for the first buy only), and a possible unlimited subscription *if* `scan_events`
reveals a repeat-scanner power-user tail. The AR ghost is the most underpriced *future*
surface — in-person AR history commands $30–49 — so price it as its own premium unlock,
not lumped in at $0.22/scan.

### Why premium, and why now

- Today's COGS is ~$0.09/scan (~90% Tavily). The old prices netted ~$0.10–0.17/scan
  after the store cut — **profitable, but the Historian pack was razor-thin (~9% margin,
  and *negative* under a 30% store cut or a famous-heavy ~13-credit scan).**
- The AR ghost adds new variable cost (Gemini-TTS narration + a few cheap Gemini text
  turns + optional bounded search). Re-pricing an app *after* launch is painful and
  reads as a cash grab. **Pricing the buffer in now means AR ships later with no second
  increase.**
- At premium pricing the gross is ~$0.35–0.45/scan — **~3–4× today's COGS as headroom.**
  A 3-question ghost session adds at most a few cents (see §6), comfortably inside that
  buffer.

### The free tier gets the ghost too

AR is the **conversion hook** — the thing no competitor has and the thing that makes
someone say "you have to try this." Gating it behind payment hides the best driver.
Free scans summon the ghost; the *premium price on the packs* covers COGS once users
are hooked and buying. **The ghost sells the app; the packs monetize the habit.**

---

## 3. The encounter

- A scan credit buys: photo → researched bio → **a ghost summoned at the grave who
  answers up to 3 questions.**
- **Summon-once** (cost-critical): the 3 questions are tied to that scan, used once, at
  the grave. The ghost then "rests." Re-summonable = unbounded TTS cost = breaks the
  model. The genie metaphor *is* the cost control: three wishes, then the lamp goes quiet.
- **AR only where it makes sense:** the ghost summons on **camera scans at the grave**
  (you have to be physically there — that's the magic). Library-photo scans get the bio
  but not the walk-along. This naturally limits AR to sessions worth the cost and
  reinforces "go visit the cemetery."

---

## 4. The ghost's answer hierarchy (the core design)

When asked a question, the ghost resolves it in this order:

1. **The bio first — the grounding contract.** *(Owner's explicit, repeated requirement.)*
   The bio is the canonical, citation-checked, already-validated account of this life.
   The ghost *is* this person; it must know its own told story before anything else. Its
   persona, voice, and facts anchor to the bio. The bio is canonical: supplementary
   material *supplements*, it never *contradicts* (same discipline as the pipeline
   trusting the stone over noisy sources).

2. **Leftover extracted source material (free — already paid for).** Every scan already
   fetches more than the bio uses: Tavily content sliced to 6000 chars per result, the
   FindAGrave `/extract` full memorial page, Chronicling America / Internet Archive
   snippets. The bio generator mines only a fraction and the rest is currently
   **discarded** after render. That discarded material is the ghost's free knowledge —
   the obituary that named five grandchildren but only two reached the bio, the plot
   location, the county-history paragraph about the mill. **Already paid for, currently
   thrown away.**

3. **(Deferred) bounded live search.** Only if a question still can't be answered from
   tiers 1–2. **Likely NOT in v1** — with tiers 1–2 doing most of the work, live search
   becomes almost optional. Ship without it; add it later only if telemetry shows users
   routinely hit questions the leftover data can't answer. If/when added, it is hard-
   capped and cheap (see §6).

---

## 5. The two voices (the "something more clever")

The ghost has two registers it visibly switches between. **The switch itself is the
disclaimer** — character, not legal fine print.

### The Remembered (grounded)
When the answer is in the bio / sources, the ghost speaks plainly, first person, with
quiet certainty:
> *"I had three children. My daughter Margaret tended this plot for years."*
These are facts. No hedging, because they are real.

### The Imagined (speculative)
When the question goes beyond what is known, the ghost shifts to a wistful, conditional,
dreamlike voice that any listener instantly reads as *the ghost wondering, not
remembering*:
> Q: *"Were you happy?"*
> → *"The stone cannot say, friend. But a life like mine — a mother of three in a close
> country parish — surely held its share of warm hearths and hard winters. I like to
> imagine the hearths won out. Though that is only a ghost's hope."*

The language carries the epistemic status: *"the stone cannot say," "let me imagine," "a
ghost's hope," "it might have been so."* A ghost speculating about its own forgotten life
is **poignant, not a liability.** The disclaimer becomes the emotional core of the feature.

**Why this is better than a grounded-only ghost:** most graves have thin records. A
grounded-only ghost dead-ends on "the records do not say" by question 2 and the magic
dies. The two-voice ghost **never dead-ends** — it turns the *absence* of data into the
most moving part of the experience. And speculation is pure LLM text from context: **zero
new credits**, which further reduces any pressure to do live search.

---

## 6. Guardrails

1. **Facts and speculation never cross registers.** The model classifies each claim: *in
   the sources* or *imagined*. No smuggling a guess into the plain-certainty voice; no
   stating speculation as fact. **Load-bearing rule.**

2. **Speculation is era-anchored — imagine the world, never fabricate the person.**
   Allowed: *"a woman of 1890s Ohio might have known the rhythm of the mill"* (era-typical,
   clearly general). **Forbidden:** specific invented biography about the real individual —
   no invented spouse, lover, cause of death, illness, or named event. *Imagine the world,
   never fabricate the person.* (Decided: **era-anchored only**, the conservative option,
   over a freer "personal narrative" range.)

3. **Off-limits topics decline gracefully, in character.** Cause of death beyond sources,
   morbid/salacious questions, modern/absurd questions ("what do you think of TikTok?") →
   a gentle in-character deflection, not a played-straight answer. The ghost has dignity —
   it is a real person's memorial. *"That is not a question for the dead to answer, friend."*

4. **Never contradict the bio.** The bio is canonical. Speculation fills *gaps*, never
   *overwrites* what's known. A user who just read the bio must never hear the ghost
   clash with it.

5. **The Imagined register is always detectable.** Minimum: through the ghost's word
   choice. Optionally reinforced in the AR layer (e.g. the ghost's form flickers /
   goes translucent when "imagining" vs solid when "remembering").

6. **Live search (if/when built) stays bounded and grounded.** `basic` depth,
   `max_results: 2`, single targeted query (~2 credits, ~5× cheaper than a bio research
   pass which is `advanced` × 6 slots). Hard cap **≤2 searches/session** regardless of how
   the 3 questions split. Searches stay anchored to the person/grave/era — not arbitrary
   topics. Empty result → the honest answer is *"the records are silent,"* never an
   invented fact. (Same "memory is not a source" rule as the bio pipeline.)

---

## 7. Cost model

| | Grounded-only ghost | + leftover data | + guarded live search |
|---|---|---|---|
| New Tavily credits / session | 0 | 0 | 0–4 (≤2 × ~2cr, basic depth) |
| New Gemini text / session | ~3 turns | ~3 turns | ~3 turns + routing |
| TTS | ~90s bounded | ~90s | ~90s |
| Cost predictability | fixed | fixed | **still bounded** (hard cap) |

Worst case (with live search enabled) ≈ 4 new credits ≈ ⅓ of a bio scan's Tavily cost —
**fully inside the premium ~3–4× buffer.** Without live search (the likely v1): **$0 new
search cost.** The 3-question cap makes AR costable; premium pricing makes it pre-paid;
the leftover-data tier makes most "deeper" questions free.

---

## 8. Architecture requirement for the build (do not lose this)

**Persist the full research payload with each story, not just the distilled bio.** Today
the pipeline discards `mergedSearchResults` after `generateBiography` — only the bio, the
`sources` list, and `source_urls` survive into the `story` object. For the ghost to use
tier-2 leftover knowledge *for free*, the raw extracted source content must be **saved
with the story** (or be cheaply re-fetchable). If it isn't, the ghost has nothing but the
bio + live search, and the whole "free paid-for knowledge" advantage is lost. This is a
data-model decision to make **before** the ghost is built — easy to add now, expensive to
retrofit. (Storage/sync impact: the raw payload is larger than the bio; consider a
separate column / object-store blob keyed by `grave_id`, not inline in the synced row.)

---

## 9. Open questions (resolve before/at build time)

- **Is 3 the right number of questions?** Could be 1 (tighter genie metaphor, cheaper) or
  5 (more generous, more cost). 3 chosen as the starting point.
- **Live search in v1 or deferred?** Leaning **deferred** — ship tiers 1–2, add tier 3 if
  telemetry warrants.
- **Should the ghost's searches count against the user's scan credits** (visible/metered)
  **or be invisible** (absorbed by margin)? Invisible feels magical; metered feels fair.
  Leaning invisible, given the cost is small and capped.
- **TTS provider & voice design** — see the feasibility memo (Gemini-TTS reuse). Voice
  needs an era/tone match per ghost; a single voice may feel wrong across a graveyard.

---

## 10. Summary

Premium pricing funds a bounded, bio-grounded ghost that **never dead-ends and never
lies** — it remembers what's known, draws on knowledge already paid for, and openly
*imagines* the rest, era-true and clearly marked. The 3-question cap makes the cost
knowable; premium pricing makes it pre-paid; giving it to the free tier makes it sell
the app.

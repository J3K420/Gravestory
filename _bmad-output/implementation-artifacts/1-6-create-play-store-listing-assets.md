---
baseline_commit: e4b84f3
---

# Story 1.6: Create Play Store Listing Assets

Status: in-progress

## Story

As a product owner,
I want complete Play Store listing assets ready for submission,
So that the internal track submission can be completed without delay.

## Acceptance Criteria

1. Short description ≤80 chars, accurately describes core value proposition
2. Full description ≤4000 chars
3. At least 2 phone screenshots (9:16, min 320px wide)
4. 1 feature graphic (1024×500px)
5. App icon (512×512px) — already in app.config.js

## Tasks / Subtasks

- [x] **Task 1 — Write short and full descriptions**
  - [x] Short description (≤80 chars)
  - [x] Full description (≤4000 chars)
  - [x] Save to `store-listing/description.md`

- [x] **Task 2 — Create feature graphic SVG (1024×500)**
  - [x] Save to `store-listing/feature-graphic.svg`
  - [x] Matches dark gothic GraveStory aesthetic

- [ ] **Task 3 — Screenshots (user action required)**
  - [ ] Screenshot 1: Home screen with "Scan a Gravestone" button visible
  - [ ] Screenshot 2: Biography result screen with a story rendered
  - [ ] Optional Screenshot 3: Cemetery map with pins
  - [ ] Minimum size: 320px wide, 9:16 aspect ratio recommended
  - [ ] Save to `store-listing/screenshots/`

- [x] **Task 4 — Commit text + graphic assets**

## Dev Notes

- Screenshots cannot be generated without a running device/emulator — user must capture these manually
- Feature graphic exported as SVG; open in browser at 1024×500 viewport and screenshot, or open in Inkscape/Figma and export as PNG
- Play Store requires PNG for feature graphic: 1024×500px, no transparency

## Dev Agent Record

### Completion Notes List

- Tasks 1, 2, 4 complete — text assets and feature graphic SVG committed to `store-listing/`
- Task 3 requires user to take screenshots on a real device (Android phone with the app installed)

### File List

- `store-listing/description.md` — created
- `store-listing/feature-graphic.svg` — created

### Change Log

| Date | Change |
|---|---|
| 2026-06-06 | Tasks 1, 2, 4: short/full descriptions written; feature graphic SVG created and committed |

---
baseline_commit: e649e46
---

# Story 1.5: Publish Privacy Policy Page

Status: done

## Story

As a prospective user,
I want to read GraveStory's privacy policy before installing the app,
So that I understand how my photos and GPS data are handled.

## Acceptance Criteria

1. Privacy policy deployed at `https://j3k420.github.io/gravestory-privacy` — publicly accessible without authentication
2. Mobile Settings screen has a "Privacy Policy" link that opens the URL in the in-app browser
3. Web Settings screen has a "Privacy Policy" link that opens the URL in a new tab
4. URL resolves correctly for Play Store listing submission

## Tasks / Subtasks

- [x] **Task 1 — Create and deploy `gravestory-privacy` GitHub Pages repo**
  - [x] Created public `J3K420/gravestory-privacy` repo via gh CLI
  - [x] Pushed `privacy-policy/index.html` as `index.html` in the new repo
  - [x] Enabled GitHub Pages on main branch
  - [x] URL: `https://j3k420.github.io/gravestory-privacy/`

- [x] **Task 2 — Add Privacy Policy link to mobile SettingsScreen.js**
  - [x] Imported `Linking` from react-native
  - [x] Added touchable link below Sign Out button

- [x] **Task 3 — Add Privacy Policy link to web Settings screen**
  - [x] Added anchor link at bottom of `#settings` div in `index.html`

- [x] **Task 4 — Commit and push**

## Dev Notes

- Privacy policy HTML draft: `privacy-policy/index.html` in the Gravestory repo
- Target URL: `https://j3k420.github.io/gravestory-privacy`
- Mobile: use `Linking` from react-native (already available in Expo managed workflow)
- Web: plain `<a href target="_blank" rel="noopener noreferrer">` tag, styled to match existing settings buttons

## Dev Agent Record

### Completion Notes List

### File List

### Change Log

# Play Console release notes

Paste the block **including** the `<en-US>` / `</en-US>` tags into the
Play Console "Release notes" field. Raw text outside the tags errors with
*"Line 1: text outside language tags"*. Opening/closing tags each go on
their own line. Max 500 characters per language.

---

## versionCode 16 — Play permissions compliance (no user-facing feature)

vc16 drops `expo-media-library` (removes the READ_MEDIA_IMAGES request) and
strips the unused RECORD_AUDIO permission so the manifest matches the Data
safety declaration. There is no new feature to announce — the only behavior
change is that on Android, photos picked from the gallery no longer auto-pin
from their GPS (camera shots and famous-grave coords are unaffected). Keep the
notes generic; don't claim a feature the diff doesn't add.

Recommended (honest + slightly specific about the permission tidy-up):

```
<en-US>
Performance, privacy, and stability improvements. This update streamlines the permissions GraveStory requests so the app only asks for what it needs.
</en-US>
```

Minimal / generic:

```
<en-US>
Bug fixes and performance improvements.
</en-US>
```

---

## versionCode 14 — GEDCOM export + backgrounded scans + notification

vc14 supersedes the never-uploaded vc13, so it carries BOTH the S69
backgrounded-scan + notification work AND the new S70 GEDCOM export.

Recommended (names both features):

```
<en-US>
New: Export any story to your family tree — tap "Export to family tree (GEDCOM)" to save a genealogy file. Plus scans now keep running if you switch apps, with a notification when your story is ready.
</en-US>
```

Shorter alternative:

```
<en-US>
New: Export a story to your family tree as a GEDCOM file, and get notified the moment a backgrounded scan is ready.
</en-US>
```

Minimal / generic:

```
<en-US>
Bug fixes and performance improvements.
</en-US>
```

---

## versionCode 13 — Backgrounded scans + "story ready" notification

Recommended (user-facing, names the feature):

```
<en-US>
New: Step away while a scan is running and it keeps going — we'll send a notification when your story is ready so you can pick up right where you left off. Plus stability improvements and small fixes.
</en-US>
```

Shorter alternative:

```
<en-US>
Scans now keep running if you switch apps, and we'll notify you the moment your story is ready to read.
</en-US>
```

Minimal / generic (if not calling out the feature yet):

```
<en-US>
Bug fixes and performance improvements.
</en-US>
```

---

## versionCode 12 — Listen to this story (text-to-speech)

Recommended (user-facing, names the feature):

```
<en-US>
New: Tap "Listen to this story" to hear any biography read aloud. Plus stability improvements and small fixes.
</en-US>
```

Shorter alternative:

```
<en-US>
You can now listen to biographies read aloud. Tap "Listen to this story" on any result.
</en-US>
```

Minimal / generic (if not calling out the feature yet):

```
<en-US>
Bug fixes and performance improvements.
</en-US>
```

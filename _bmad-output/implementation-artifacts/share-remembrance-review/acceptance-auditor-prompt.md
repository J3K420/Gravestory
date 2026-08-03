# Acceptance Auditor review prompt

Review the uncommitted changes in:

`C:\Users\james\Desktop\Gravestoryrepo\.codex\worktrees\share-remembrance-main`

against the feature context in the latest handoff:

`C:\Users\james\Desktop\Gravestoryrepo\docs\share-remembrance-session-handoff-2026-07-23.md`

Review `git diff HEAD` plus these untracked files:

- `supabase-migrations/035_share_remembrances.sql`
- `mobile/src/lib/api-remembrances.js`
- `mobile/src/screens/RemembranceScreen.js`
- `mobile/src/screens/CommunityStoriesScreen.js`
- `docs/remembrance-moderation-runbook.md`

Check privacy-by-default, server-authoritative moderation, public list versus map behavior,
GPS-less stories, report/block/delete controls, image safety, migration 035 integration, and
the stated no-deploy/no-commit handoff constraints. Return each finding as a Markdown list
item with a one-line title, violated requirement/constraint, and diff evidence.

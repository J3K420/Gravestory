# Edge Case Hunter review prompt

Invoke the `bmad-review-edge-case-hunter` skill against the uncommitted changes in:

`C:\Users\james\Desktop\Gravestoryrepo\.codex\worktrees\share-remembrance-main`

Review `git diff HEAD` plus these untracked files:

- `supabase-migrations/035_share_remembrances.sql`
- `mobile/src/lib/api-remembrances.js`
- `mobile/src/screens/RemembranceScreen.js`
- `mobile/src/screens/CommunityStoriesScreen.js`
- `docs/remembrance-moderation-runbook.md`

Focus on ownership/RLS, private-to-public transitions, moderation ambiguity, duplicate and
lost-response behavior, R2 orphan cleanup, account deletion, GPS-less stories, blocking,
existing researched-story compatibility, migration replay, and mobile interruption/retry
behavior. Return actionable findings with severity, file/line evidence, trigger scenario,
and a concrete remediation.

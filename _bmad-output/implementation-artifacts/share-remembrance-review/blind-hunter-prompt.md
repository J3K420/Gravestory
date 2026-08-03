# Blind Hunter review prompt

Invoke the `bmad-review-adversarial-general` skill against the uncommitted changes in:

`C:\Users\james\Desktop\Gravestoryrepo\.codex\worktrees\share-remembrance-main`

Review `git diff HEAD` plus these untracked files:

- `supabase-migrations/035_share_remembrances.sql`
- `mobile/src/lib/api-remembrances.js`
- `mobile/src/screens/RemembranceScreen.js`
- `mobile/src/screens/CommunityStoriesScreen.js`
- `docs/remembrance-moderation-runbook.md`

The change ports the Share a Remembrance / Community Stories feature onto current main
`496a1f3`, including Supabase migration 035, Worker upload/moderation/deletion routes,
mobile creation and community screens, privacy/RLS controls, and deploy-contract updates.
Return only actionable findings with severity, file/line evidence, exploit or failure
scenario, and a concrete remediation.

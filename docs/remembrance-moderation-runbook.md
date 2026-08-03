# Share a Remembrance — Moderation and Release Runbook

## Launch order

1. Back up the Supabase schema and verify migrations 001–036 are present.
2. Confirm `supabase-migrations/035_share_remembrances.sql` has already run.
3. Confirm migration 036 is already applied and matches its catalog fingerprint; do not re-run it.
4. Run `supabase-migrations/037_remembrance_operator_moderation.sql` in the Supabase SQL editor.
5. Provision the private `gravestory-remembrance-private` R2 bucket, bind it as `REMEMBRANCE_IMAGES`, and do not attach an R2 public/custom domain.
6. Execute the verification queries at the end of this document.
7. Deploy `worker/worker.js` so authenticated story-photo upload/deletion routes exist.
8. Test with an internal APK before publishing any OTA or Play release.
9. Re-check the hosted Terms, Privacy Policy, Data Safety answers, and Content Rating.
10. Roll out through internal testing, closed testing, then a staged production rollout.

Do not enable the remembrance release until migrations 035, 036, and 037 have run. The mobile
sync layer and Worker depend on the schema, security controls, and service-role human-review path.

## Publication rules

- `private`: visible only to the owner.
- `pending`: requested for public sharing but held out of all public queries.
- `published`: `is_public = true` and `moderation_status = approved`.
- `rejected`: not public; the moderator records a short operational reason.
- `removed`: taken down after publication; not public.

The mobile client can request public visibility but cannot approve itself. The authenticated
`/moderate-remembrance` Worker route reloads the authoritative story row and every R2 object,
checks the primary grave image plus the combined text/image safety review, and writes the result
with the service role. Provider errors, low confidence, safety blocks, and ambiguous responses
always become `pending`; they never fail open for public UGC.

Photo uploads reserve one of four database-backed slots before writing private R2. The mobile
client retries an ambiguous response once with the same upload UUID, then discards that exact
unlinked key. On a later upload, the Worker atomically claims unlinked reservations older than
15 minutes, deletes those private objects, and only then releases their slots; a concurrent link
cannot win after cleanup is claimed.

## Daily queue

Run in Supabase with a trusted administrator account. Never expose service-role credentials in
the app or a client-side dashboard.

```sql
select s.id, s.name, s.dates, s.user_id, s.content_revision,
       s.moderation_reason, s.created_at,
       coalesce(array_agg(sp.id order by sp.sort_order)
         filter (where sp.id is not null), '{}'::uuid[]) as photo_ids,
       coalesce(array_agg(sp.object_key order by sp.sort_order)
         filter (where sp.id is not null), '{}'::text[]) as object_keys
from public.stories s
left join public.story_photos sp
  on sp.story_id = s.id and sp.deleted_at is null
where s.story_type = 'remembrance'
  and s.publication_status = 'pending'
  and s.deleted_at is null
group by s.id, s.name, s.dates, s.user_id, s.content_revision,
         s.moderation_reason, s.created_at
order by s.created_at asc;
```

Review the primary/supporting photos, the remembrance text, the requested location, the Terms
acceptance timestamp, and any existing reports. Check for prohibited content, rights/privacy
issues, living-person data, spam, and whether the primary image is a grave marker.

The bucket stays private. View each queue `object_key` only through the audited
`GET /admin/remembrance-photo?key=...` Worker route using the independently managed
`ADMIN_KEY`; the route returns an object only while its exact story/photo rows are still pending
and logs a redacted correlation for every successful view. Do not copy the key into the mobile
app, a public dashboard, or a public R2 URL. For example, from an administrator workstation:

```powershell
$headers = @{ Authorization = "Bearer $env:GRAVESTORY_ADMIN_KEY" }
$objectKey = 'stories/<owner uuid>/<story uuid>/<photo uuid>.jpg'
$url = 'https://gravestory-proxy.james-gravestory.workers.dev/admin/remembrance-photo?key=' +
  [uri]::EscapeDataString($objectKey)
Invoke-WebRequest -Uri $url -Headers $headers -OutFile '.\remembrance-review-photo.jpg'
```

Delete the local review copy when the decision is complete under the normal moderation-data
retention policy. Never place `ADMIN_KEY` in command history, source control, or client code.

Do not approve by running an unrestricted update on `story_id`. The moderation Worker is the
authoritative approval path: it reloads the exact story revision and exact private-bucket photo
object set, then commits only when the revision, deletion state, and requested visibility still
match. The service-role-only `moderate_remembrance_operator` RPC applies the same revision and
exact-photo-set requirements for a human decision. If any reviewed value changed, reload the item
and review it again.

For a human queue review, record the `content_revision`, every reviewed `story_photos.id`, and
the matching private object keys. Run the RPC as a trusted administrator or service-role process;
do not manually set `is_public`, `publication_status`, `moderation_status`, photo visibility, or
photo URLs. Copy the exact attested Worker origin from `js/config.js`; the RPC reconstructs every
canonical photo URL from that origin and the immutable private-bucket object key. Use `approved`
or `rejected` as the decision, and retain a concise operational reason:

```sql
select public.moderate_remembrance_operator(
  p_story_id := '<story uuid>'::uuid,
  p_expected_revision := 1,
  p_expected_photo_ids := array[
    '<primary photo uuid>'::uuid,
    '<supporting photo uuid>'::uuid
  ],
  p_expected_object_keys := array[
    'stories/<owner uuid>/<story uuid>/<primary object>',
    'stories/<owner uuid>/<story uuid>/<supporting object>'
  ],
  p_worker_origin := 'https://gravestory-proxy.james-gravestory.workers.dev',
  p_decision := 'approved',
  p_reason := 'Human review completed; grave marker and remembrance content are acceptable.'
);
```

A result of `true` confirms the exact reviewed state was applied (or that an identical call was
already applied). Any stale revision, changed photo set, deletion, visibility change, or conflicting
terminal decision raises an error and performs no partial update.

## Reports and takedowns

The `content_reports` table is client-write-only. Triage public/privacy, threat, sexual-content,
and violence reports first; then copyright, hate/harassment, spam, accuracy, and other reports.

```sql
select id, target_type, story_id, target_user_id, person_name, reason, note,
       reporter_id, created_at
from public.content_reports
order by created_at asc;
```

For an urgent takedown, set the story to `removed`, `moderation_status = removed`, and
`is_public = false`, then set every linked photo to private/removed. Contact the contributor only
when appropriate; never reveal reporter identity. Preserve the report as the moderation record.

The owner can delete a remembrance in-app. The client first removes it from public sync, then calls
the authenticated `/delete-story-photos` Worker route, which removes every R2 object under that
user's story prefix and soft-deletes the remembrance, story-photo, and linked gallery rows.
Account deletion removes story photos and rows and anonymizes reporter/target identifiers retained
in moderation records.

## Response targets

- Credible threat, child safety, or non-consensual sexual content: disable immediately and escalate.
- Privacy/doxxing or impersonation: review within 24 hours.
- Copyright/takedown request: acknowledge within 24 hours and preserve the request record.
- Other reports: review within 72 hours.
- Repeat severe violations: remove affected content and suspend/delete the contributor account.

## Verification queries

```sql
-- Must return zero: public remembrances that bypassed approval.
select id from public.stories
where story_type = 'remembrance'
  and is_public = true
  and (publication_status <> 'published' or moderation_status <> 'approved');

-- Must return zero: public grave-photo rows belonging to private/deleted stories.
select gp.id
from public.grave_photos gp
left join public.stories s on s.id = gp.story_id
where gp.deleted_at is null
  and gp.visibility = 'public'
  and (s.id is null or s.is_public is not true or s.deleted_at is not null);

-- Confirm GPS-less public stories are listable but not map-eligible.
select id, name from public.community_public_stories(100, 0)
where latitude is null or longitude is null;

select id, name from public.global_public_stories(500)
where latitude is null or longitude is null;
```

The final query must return zero rows by construction.



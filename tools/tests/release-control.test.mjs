import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  canonicalJson,
  createCandidate,
  createGenesisAcceptance,
  createIntent,
  createReconciliation,
  createResolution,
  revalidateExecutionLease,
  recordHash,
  sealRecord,
  validateImmutableHistory,
  validateRecord,
  validateRecordSet,
  validateReleaseRepository,
} from '../release-control.mjs';

const sourceCommit = 'a'.repeat(40);
const baselines = {
  schemaVersion: 1,
  components: {
    mobile: {
      baselineId: 'baseline-mobile-test',
      releaseId: 'release-current',
      rollback: { status: 'known', releaseId: 'release-previous' },
      ordinaryEligibility: 'eligible',
    },
    pages: {
      baselineId: 'baseline-pages-test', releaseId: 'pages-current', rollback: { status: 'unknown', releaseId: null }, ordinaryEligibility: 'blocked-no-known-rollback',
    },
    worker: {
      baselineId: 'baseline-worker-test', releaseId: 'worker-current', rollback: { status: 'unknown', releaseId: null }, ordinaryEligibility: 'blocked-no-known-rollback',
    },
    database: {
      baselineId: 'baseline-database-test', releaseId: null, rollback: { status: 'unknown', releaseId: null }, ordinaryEligibility: 'blocked-unverified-live-state',
    },
  },
};

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'gravestory-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const migration001 = 'select 1;';
  const migration034 = 'select 2;';
  const checksum = (value) => createHash('sha256').update(value).digest('hex');
  const files = {
    'mobile/app.config.js': "export default { runtimeVersion: { policy: 'sdkVersion' } };",
    'mobile/eas.json': '{"build":{"production":{"channel":"production","android":{"buildType":"app-bundle"}}}}',
    'mobile/package-lock.json': '{}',
    'docs/cloudflare-pages-manifest.txt': 'index.html',
    'sw.js': 'cache',
    'worker/worker.js': 'worker',
    'worker/wrangler.toml': 'WORKER_ENV = "production"\nALLOWED_ORIGIN = "https://gravestory.pages.dev,https://j3k420.github.io"',
    'worker/package-lock.json': '{}',
    'database/catalog.json': JSON.stringify({
      schemaVersion: 1,
      migrationDirectory: 'supabase-migrations',
      queryDirectory: 'queries',
      environmentInputProfiles: { 'explicit-production-write': { inputs: ['approved test input'] } },
      bootstrap: { status: 'unresolved', missing: ['authoritative pre-001 baseline'], productionInspectionRequired: true },
      knownGaps: [],
      operationalEntrypoints: [],
      artifacts: [
        { id: '001', kind: 'migration', path: 'supabase-migrations/001_test.sql', sha256: checksum(migration001), summary: 'test one', access: 'write', release: 'schema-before-dependent-release', approval: 'explicit-production-write', verification: 'disposable-local-reset', recovery: 'forward-fix-only' },
        { id: '002', kind: 'migration', path: 'supabase-migrations/002_test.sql', sha256: checksum(migration034), summary: 'test two', access: 'write', release: 'schema-before-dependent-release', approval: 'explicit-production-write', verification: 'disposable-local-reset', recovery: 'forward-fix-only' },
      ],
    }),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, 'supabase-migrations'), { recursive: true });
  writeFileSync(join(root, 'supabase-migrations/001_test.sql'), migration001);
  writeFileSync(join(root, 'supabase-migrations/002_test.sql'), migration034);
  return root;
}

function candidateFixture(t, component = 'mobile', authority = 'deploy-config-contract', root = fixtureRoot(t)) {
  return createCandidate({
    root,
    component,
    sourceCommit,
    createdAt: '2026-07-15T12:00:00Z',
    review: { sourceCommit, reviewCommit: 'f'.repeat(40), reviewId: 'bmad-review-123', pr: 'J3K420/Gravestory#99', bmad: 'passed', recordPath: '_bmad-output/review-receipt.json', recordBlob: 'e'.repeat(40), artifactPath: '_bmad-output/specs/review.md', artifactBlob: 'c'.repeat(40) },
    configuration: {
      sourceCommit, component, identity: 'd'.repeat(64), validation: 'passed', remotePresence: 'attested',
      authoritative: authority === 'deploy-config-contract', attestationPath: `deploy/config/${component}.json`, attestationBlob: 'c'.repeat(40),
    },
    baselines,
  });
}

test('canonical JSON and hashes ignore object insertion order but detect mutation', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  const record = sealRecord({ schemaVersion: 1, recordType: 'candidate', recordId: 'candidate-invalid-shell', component: 'mobile', createdAt: '2026-07-15T12:00:00Z' });
  assert.notEqual(record.contentHash, sealRecord({ ...record, component: 'pages', contentHash: undefined }).contentHash);
});

test('candidate binds source, review, configuration, build, migration, and rollback identity', (t) => {
  const candidate = candidateFixture(t);
  assert.equal(candidate.eligibility.status, 'eligible');
  assert.equal(candidate.baseline.rollback.releaseId, 'release-previous');
  assert.equal(candidate.migrations.basis, 'repository-intended');
  assert.equal(candidate.migrations.bootstrapStatus, 'unresolved');
  assert.doesNotThrow(() => validateRecord(candidate));
  assert.throws(() => validateRecord({ ...candidate, sourceCommit: 'b'.repeat(40) }), /contentHash|not bound/);
});

test('missing deploy-config authority and unknown genesis rollback block ordinary eligibility', (t) => {
  const missingAuthority = candidateFixture(t, 'mobile', 'ad-hoc');
  assert.deepEqual(missingAuthority.eligibility.blockingReasons, ['missing-authoritative-deploy-config-contract']);
  const worker = candidateFixture(t, 'worker');
  assert.equal(worker.eligibility.status, 'blocked');
  assert.match(worker.eligibility.blockingReasons.join(','), /blocked-no-known-rollback/);
});

test('review and configuration attestations must bind to the exact source SHA', (t) => {
  const root = fixtureRoot(t);
  assert.throws(() => createCandidate({
    root,
    component: 'mobile',
    sourceCommit,
    createdAt: '2026-07-15T12:00:00Z',
    review: { sourceCommit: 'b'.repeat(40), reviewCommit: 'f'.repeat(40), reviewId: 'review-1', pr: 'repo#1', bmad: 'passed', recordPath: '_bmad-output/review-receipt.json', recordBlob: 'e'.repeat(40), artifactPath: '_bmad-output/specs/review.md', artifactBlob: 'c'.repeat(40) },
    configuration: { sourceCommit, component: 'mobile', identity: 'd'.repeat(64), validation: 'passed', authoritative: true, attestationPath: 'deploy/config/mobile.json', attestationBlob: 'c'.repeat(40) },
    baselines,
  }), /Review evidence/);
  assert.throws(() => createCandidate({
    root,
    component: 'mobile',
    sourceCommit,
    createdAt: '2026-07-15T12:00:00Z',
    review: { sourceCommit, reviewCommit: 'f'.repeat(40), reviewId: 'review-safe', pr: 'J3K420/Gravestory#1', bmad: 'passed', recordPath: '_bmad-output/review-receipt.json', recordBlob: 'e'.repeat(40), artifactPath: '_bmad-output/specs/review.md', artifactBlob: 'c'.repeat(40) },
    configuration: { sourceCommit, component: 'mobile', identity: 'd'.repeat(64), validation: 'passed', remotePresence: { secret: 'nested' }, authoritative: false },
    baselines,
  }), /remotePresence/);
});

test('intent serialization rejects blocked candidates and overlapping component leases', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-001' });
  assert.doesNotThrow(() => validateRecordSet([candidate, intent], baselines));
  const second = sealRecord({ ...intent, recordId: 'intent-exec-mobile-002', executionId: 'exec-mobile-002', createdAt: '2026-07-15T12:02:00Z' });
  assert.throws(() => validateRecordSet([candidate, intent, second], baselines), /overlapping open execution intents/);
  const duplicateId = sealRecord({ ...intent, recordId: 'intent-exec-mobile-duplicate' });
  assert.throws(() => validateRecordSet([candidate, intent, duplicateId], baselines), /Duplicate intent executionId/);
  const blocked = candidateFixture(t, 'worker');
  blocked.contentHash = sealRecord(blocked).contentHash;
  assert.throws(() => createIntent({ candidate: blocked, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-pages-001' }), /eligible candidate/);
});

test('finalization is unique by execution ID and abandonment requires never-started evidence', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-001' });
  const final = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: 'release-new', approvalRef: 'approval-1', evidenceRef: 'eas-result-1' },
  });
  assert.doesNotThrow(() => validateRecordSet([candidate, intent, final], baselines));
  const duplicate = sealRecord({ ...final, recordId: 'final-exec-mobile-retry', createdAt: '2026-07-15T12:04:00Z' });
  assert.throws(() => validateRecordSet([candidate, intent, final, duplicate], baselines), /multiple resolutions/);
  const abandon = createResolution({
    type: 'abandon', candidate, intent, createdAt: '2026-07-15T12:03:00Z', reason: 'operator proved command never started',
    neverStartedAttestation: { executionId: intent.executionId, executionStarted: false, operator: 'operator-1', approvalRef: 'approval-1', observedAt: '2026-07-15T12:02:00Z' },
  });
  assert.equal(abandon.executionNeverBegan, true);
  const mismatched = sealRecord({ ...final, executionEvidence: { ...final.executionEvidence, executionId: 'exec-other-001' } });
  assert.throws(() => validateRecord(mismatched), /bound to executionId/);
  const unsafe = sealRecord({ ...final, executionEvidence: { ...final.executionEvidence, secret: 'must-not-persist' } });
  assert.throws(() => validateRecord(unsafe), /unapproved fields/);
  const evidenceFreeAbandon = sealRecord({ ...abandon, neverStartedAttestation: undefined });
  assert.throws(() => validateRecord(evidenceFreeAbandon), /never-started evidence/);
});

test('successful final evidence advances the immutable current baseline', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-advance' });
  const final = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: 'release-next', approvalRef: 'approval-2', evidenceRef: 'eas-result-2' },
  });
  const state = validateRecordSet([candidate, intent, final], baselines);
  assert.equal(state.currentBaselines.mobile.baselineId, final.recordId);
  assert.equal(state.currentBaselines.mobile.releaseId, 'release-next');
  assert.equal(state.currentBaselines.mobile.rollback.releaseId, 'release-current');
});

test('repository validation recomputes candidate eligibility and chronology', (t) => {
  const blocked = candidateFixture(t, 'worker');
  const forged = sealRecord({ ...blocked, eligibility: { status: 'eligible', blockingReasons: [] } });
  assert.throws(() => validateRecordSet([forged], baselines), /inconsistent eligibility/);
  const candidate = candidateFixture(t);
  const earlyIntent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-early' });
  const predating = sealRecord({ ...earlyIntent, createdAt: '2026-07-15T11:59:00Z' });
  assert.throws(() => validateRecordSet([candidate, predating], baselines), /later than its candidate/);
});

test('baseline revalidation rejects stale main, dirty source, and resolved leases', (t) => {
  const candidate = candidateFixture(t);
  const originMainCommit = 'b'.repeat(40);
  const intent = createIntent({ candidate, originMainCommit, createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-001' });
  const root = fixtureRoot(t);
  const state = { ...validateRecordSet([candidate, intent], baselines), baselines, root };
  assert.equal(revalidateExecutionLease({ candidate, intent, state, headCommit: originMainCommit, originMainCommit, clean: true }), true);
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state, headCommit: 'c'.repeat(40), originMainCommit, clean: true }), /stale/);
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state, headCommit: originMainCommit, originMainCommit, clean: false }), /clean worktree/);
  writeFileSync(join(root, 'mobile/eas.json'), '{"build":{"production":{"channel":"preview","android":{"buildType":"app-bundle"}}}}');
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state, headCommit: originMainCommit, originMainCommit, clean: true }), /production Android channel/);
  const final = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: 'new', approvalRef: 'approval-1', evidenceRef: 'eas-result-1' },
  });
  const resolved = { ...validateRecordSet([candidate, intent, final], baselines), baselines, root };
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state: resolved, headCommit: originMainCommit, originMainCommit, clean: true }), /already resolved/);
});

test('history validator permits additions and rejects mutation, deletion, and rename', () => {
  assert.doesNotThrow(() => validateImmutableHistory('A\trelease/records/candidate-one.json\n'));
  for (const status of ['M', 'D', 'R100']) {
    assert.throws(() => validateImmutableHistory(`${status}\trelease/records/old.json\trelease/records/new.json\n`), /append-only/);
  }
});

test('tracked component and migration graph changes stale an execution candidate', (t) => {
  const root = fixtureRoot(t);
  const candidate = candidateFixture(t, 'mobile', 'deploy-config-contract', root);
  const originMainCommit = 'b'.repeat(40);
  const intent = createIntent({ candidate, originMainCommit, createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-graph' });
  const state = { ...validateRecordSet([candidate, intent], baselines), root };
  mkdirSync(join(root, 'mobile/src'), { recursive: true });
  writeFileSync(join(root, 'mobile/src/new-release-input.js'), 'export const changed = true;');
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state, headCommit: originMainCommit, originMainCommit, clean: true }), /component source is stale/);
  rmSync(join(root, 'mobile/src'), { recursive: true, force: true });
  writeFileSync(join(root, 'supabase-migrations/001_test.sql'), 'select changed;');
  assert.throws(() => revalidateExecutionLease({ candidate, intent, state, headCommit: originMainCommit, originMainCommit, clean: true }), /fingerprint mismatch|checksum does not match/);
});

test('failed execution needs no release identity while unknown execution keeps the lease blocked', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-outcome' });
  const failed = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'failed-run-1' },
  });
  assert.equal(validateRecordSet([candidate, intent, failed], baselines).openByComponent.has('mobile'), false);
  const unknown = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'unknown', approvalRef: 'approval-1', evidenceRef: 'unknown-run-1' },
  });
  assert.equal(validateRecordSet([candidate, intent, unknown], baselines).openByComponent.get('mobile'), intent.executionId);
});

test('execution evidence rejects extra fields, impossible chronology, and forged rollback identity', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-evidence' });
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'failed-run-1', secret: 'nope' },
  }), /unapproved fields/);
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'failed-run-1', startedAt: '2026-07-15T12:00:59Z' },
  }), /predates its intent/);
  const final = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: 'release-new', approvalRef: 'approval-1', evidenceRef: 'run-1' },
  });
  const forged = sealRecord({ ...final, rollbackBaselineId: 'baseline-forged' });
  assert.throws(() => validateRecordSet([candidate, intent, forged], baselines), /rollback baseline/);
  const impossible = sealRecord({ ...candidate, createdAt: '2026-02-30T12:00:00Z' });
  assert.throws(() => validateRecord(impossible), /canonical ISO UTC/);
});

test('database completion is bound to the exact candidate migration ledger', (t) => {
  const candidate = candidateFixture(t, 'database');
  const intent = sealRecord({
    schemaVersion: 1, recordType: 'intent', recordId: 'intent-exec-database-001', component: 'database',
    candidateId: candidate.recordId, executionId: 'exec-database-001', createdAt: '2026-07-15T12:01:00Z', originMainCommit: 'b'.repeat(40), executionStarted: false,
  });
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'database', executionId: intent.executionId, result: 'success', approvalRef: 'approval-1', evidenceRef: 'db-run-1', migrations: [{ id: '999', sha256: 'f'.repeat(64) }] },
  }), /candidate migration ledger/);
});

test('an intent cannot lease an eligible candidate from a superseded baseline', (t) => {
  const candidateA = candidateFixture(t);
  const candidateB = sealRecord({ ...candidateA, recordId: `${candidateA.recordId}-b`, createdAt: '2026-07-15T12:00:30Z' });
  const intentA = createIntent({ candidate: candidateA, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-a' });
  const finalA = createResolution({
    type: 'final', candidate: candidateA, intent: intentA, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intentA.executionId, result: 'success', releaseId: 'release-a', approvalRef: 'approval-1', evidenceRef: 'run-a' },
  });
  const intentB = createIntent({ candidate: candidateB, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:04:00Z', executionId: 'exec-mobile-b' });
  assert.throws(() => validateRecordSet([candidateA, candidateB, intentA, finalA, intentB], baselines), /exact current baseline/);
});

test('mobile and worker contracts are evaluated rather than satisfied by comments or partial origins', (t) => {
  const mobileRoot = fixtureRoot(t);
  writeFileSync(join(mobileRoot, 'mobile/app.config.js'), "// runtimeVersion: { policy: 'sdkVersion' }\nexport default { runtimeVersion: { policy: 'appVersion' } };");
  assert.throws(() => candidateFixture(t, 'mobile', 'deploy-config-contract', mobileRoot), /evaluated sdkVersion/);
  const workerRoot = fixtureRoot(t);
  writeFileSync(join(workerRoot, 'worker/wrangler.toml'), 'WORKER_ENV = "production"\nALLOWED_ORIGIN = "https://gravestory.pages.dev"');
  assert.throws(() => candidateFixture(t, 'worker', 'deploy-config-contract', workerRoot), /exact production origin/);
});

test('chronological replay rejects leases that overlapped before a later terminal outcome', (t) => {
  const candidate = candidateFixture(t);
  const first = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-first' });
  const second = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:02:00Z', executionId: 'exec-mobile-second' });
  const final = createResolution({
    type: 'final', candidate, intent: first, createdAt: '2026-07-15T12:05:00Z',
    executionEvidence: { kind: 'platform', executionId: first.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'run-first' },
  });
  assert.throws(() => validateRecordSet([candidate, first, second, final], baselines), /overlapping open execution intents/);
});

test('unknown outcomes can be closed only by an approval-bound immutable reconciliation', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-reconcile' });
  const unknown = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'unknown', approvalRef: 'approval-1', evidenceRef: 'run-unknown' },
  });
  const reconciled = createReconciliation({
    candidate, intent, priorOutcome: unknown, createdAt: '2026-07-15T12:04:00Z', ownerDecisionRef: 'owner-decision-1',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: 'release-reconciled', approvalRef: 'approval-1', evidenceRef: 'reconciled-run' },
  });
  const state = validateRecordSet([candidate, intent, unknown, reconciled], baselines);
  assert.equal(state.openByComponent.has('mobile'), false);
  assert.equal(state.currentBaselines.mobile.releaseId, 'release-reconciled');
  assert.throws(() => createReconciliation({
    candidate, intent, priorOutcome: unknown, createdAt: '2026-07-15T12:04:00Z', ownerDecisionRef: 'owner-decision-1',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'unknown', approvalRef: 'approval-1', evidenceRef: 'still-unknown' },
  }), /success or failed/);
});

test('owner-approved no-rollback genesis is append-only and makes a new candidate representably eligible', (t) => {
  const acceptance = createGenesisAcceptance({
    component: 'worker', baseline: baselines.components.worker, createdAt: '2026-07-15T11:00:00Z', ownerApprovalRef: 'owner-approval-1', evidenceRef: 'decision-record-1',
  });
  const accepted = validateRecordSet([acceptance], baselines);
  assert.equal(accepted.currentBaselines.worker.ordinaryEligibility, 'eligible');
  assert.equal(accepted.currentBaselines.worker.genesisAcceptance.recordId, acceptance.recordId);
  const candidate = createCandidate({
    root: fixtureRoot(t), component: 'worker', sourceCommit, createdAt: '2026-07-15T12:00:00Z',
    review: { sourceCommit, reviewCommit: 'f'.repeat(40), reviewId: 'bmad-review-123', pr: 'J3K420/Gravestory#99', bmad: 'passed', recordPath: '_bmad-output/review-receipt.json', recordBlob: 'e'.repeat(40), artifactPath: '_bmad-output/specs/review.md', artifactBlob: 'c'.repeat(40) },
    configuration: { sourceCommit, component: 'worker', identity: 'd'.repeat(64), validation: 'passed', remotePresence: 'attested', authoritative: true, attestationPath: 'deploy/config/worker.json', attestationBlob: 'c'.repeat(40) },
    baselines: { components: accepted.currentBaselines },
  });
  assert.equal(candidate.eligibility.status, 'eligible');
  assert.equal(candidate.baseline.genesisAcceptance.ownerApprovalRef, 'owner-approval-1');
});

test('success must create a distinct release and all lifecycle timestamps are strictly ordered', (t) => {
  const candidate = candidateFixture(t);
  assert.throws(() => createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: candidate.createdAt, executionId: 'exec-mobile-same-time' }), /later than its candidate/);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-distinct' });
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:02:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: candidate.baseline.releaseId, approvalRef: 'approval-1', evidenceRef: 'same-release' },
  }), /new release identity/);
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: intent.createdAt,
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'same-time' },
  }), /later than its intent/);
});

test('repository validation recomputes identities from reviewed Git objects and enforces canonical filenames', (t) => {
  const root = fixtureRoot(t);
  const reviewPath = '_bmad-output/specs/review.md';
  const receiptPath = '_bmad-output/review-receipt.json';
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'user.name', 'Release Test');
  git('add', '.');
  git('commit', '-m', 'reviewed source');
  const commit = git('rev-parse', 'HEAD');
  mkdirSync(dirname(join(root, reviewPath)), { recursive: true });
  writeFileSync(join(root, reviewPath), '# Review\n\n## Review Findings\n\n- [x] [Review][Patch] Complete\n');
  const artifactBlob = git('hash-object', reviewPath);
  writeFileSync(join(root, receiptPath), canonicalJson({ schemaVersion: 1, kind: 'bmad-code-review-receipt', sourceCommit: commit, reviewId: 'bmad-review-source', pr: 'J3K420/Gravestory#99', bmad: 'passed', completedAt: '2026-07-15T11:30:00Z', findingsResolved: true, artifactPath: reviewPath, artifactBlob }));
  git('add', '.');
  git('commit', '-m', 'record completed review');
  const reviewCommit = git('rev-parse', 'HEAD');
  const candidate = createCandidate({
    root, component: 'mobile', sourceCommit: commit, createdAt: '2026-07-15T12:00:00Z',
    review: { sourceCommit: commit, reviewCommit, reviewId: 'bmad-review-source', pr: 'J3K420/Gravestory#99', bmad: 'passed', recordPath: receiptPath, recordBlob: git('rev-parse', `HEAD:${receiptPath}`), artifactPath: reviewPath, artifactBlob },
    configuration: { sourceCommit: commit, component: 'mobile', identity: 'd'.repeat(64), validation: 'passed', remotePresence: 'unverified', authoritative: false },
    baselines,
  });
  const evidenceDirectory = join(root, 'release/evidence');
  mkdirSync(evidenceDirectory, { recursive: true });
  const components = {};
  for (const [component, baseline] of Object.entries(baselines.components)) {
    const evidencePath = `release/evidence/${component}.json`;
    writeFileSync(join(root, evidencePath), '{}\n');
    components[component] = { ...baseline, sourceCommit: null, basis: 'test-genesis', evidencePath };
  }
  const baselineFile = { schemaVersion: 1, components };
  baselineFile.contentHash = recordHash(baselineFile);
  mkdirSync(join(root, 'release/records'), { recursive: true });
  writeFileSync(join(root, 'release/baselines.json'), canonicalJson(baselineFile));
  const candidatePath = join(root, `release/records/${candidate.recordId}.json`);
  writeFileSync(candidatePath, canonicalJson(candidate));
  assert.doesNotThrow(() => validateReleaseRepository(root, { checkHistory: false }));
  const forged = sealRecord({ ...candidate, build: { ...candidate.build, identity: 'f'.repeat(64) } });
  writeFileSync(candidatePath, canonicalJson(forged));
  assert.throws(() => validateReleaseRepository(root, { checkHistory: false }), /reviewed sourceCommit/);
  rmSync(candidatePath);
  writeFileSync(join(root, 'release/records/alias.json'), canonicalJson(candidate));
  assert.throws(() => validateReleaseRepository(root, { checkHistory: false }), /filename must match recordId/);
});

test('release preflight rejects malformed migration ordering and Windows-unsafe execution IDs', (t) => {
  const root = fixtureRoot(t);
  const catalogPath = join(root, 'database/catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  catalog.artifacts.reverse();
  writeFileSync(catalogPath, JSON.stringify(catalog));
  assert.throws(() => candidateFixture(t, 'mobile', 'deploy-config-contract', root), /ascending order/);
  const candidate = candidateFixture(t);
  assert.throws(() => createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec:mobile:unsafe' }), /cross-platform filename/);
  assert.throws(() => createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: `exec-${'x'.repeat(140)}` }), /cross-platform filename/);
});

test('hand-authored records cannot smuggle nested references or malformed abandonment proof', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:01:00Z', executionId: 'exec-mobile-schema' });
  const final = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:03:00Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'run-1' },
  });
  const nested = sealRecord({ ...final, executionEvidence: { ...final.executionEvidence, approvalRef: { secret: 'nested' } } });
  assert.throws(() => validateRecord(nested), /approvalRef is invalid/);
  const abandon = createResolution({
    type: 'abandon', candidate, intent, createdAt: '2026-07-15T12:03:00Z', reason: 'command never began',
    neverStartedAttestation: { executionId: intent.executionId, executionStarted: false, operator: 'operator-1', approvalRef: 'approval-1', observedAt: '2026-07-15T12:02:00Z' },
  });
  const malformed = sealRecord({ ...abandon, reason: 'line one\nline two' });
  assert.throws(() => validateRecord(malformed), /single-line/);
});

test('millisecond timestamps replay numerically and prior rollback releases cannot be promoted', (t) => {
  const candidate = candidateFixture(t);
  const intent = createIntent({ candidate, originMainCommit: 'b'.repeat(40), createdAt: '2026-07-15T12:00:00.001Z', executionId: 'exec-mobile-millis' });
  const failed = createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:00:00.002Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'failed', approvalRef: 'approval-1', evidenceRef: 'run-millis' },
  });
  assert.doesNotThrow(() => validateRecordSet([failed, intent, candidate], baselines));
  assert.throws(() => createResolution({
    type: 'final', candidate, intent, createdAt: '2026-07-15T12:00:00.003Z',
    executionEvidence: { kind: 'platform', executionId: intent.executionId, result: 'success', releaseId: candidate.baseline.rollback.releaseId, approvalRef: 'approval-1', evidenceRef: 'old-rollback' },
  }), /new release identity/);
});

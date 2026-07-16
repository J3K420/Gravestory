#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateDatabaseControl } from './database-control.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPONENTS = Object.freeze(['pages', 'worker', 'mobile', 'database']);
export const RECORD_TYPES = Object.freeze(['genesis', 'candidate', 'intent', 'final', 'abandon', 'reconcile']);
const RECORD_DIRECTORY = 'release/records';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PR_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/;
const RESULT_VALUES = new Set(['success', 'failed', 'conflict', 'unknown']);
const REQUIRED_PAGES_ASSETS = Object.freeze([
  'index.html', 'sw.js', 'og-image.png', 'css/base.css', 'css/home.css', 'css/maps.css', 'css/result.css',
  'js/config.js', 'js/util-json.js', 'js/util-html.js', 'js/util-dom.js', 'js/auth.js', 'js/symbols.js',
  'js/grave-markers.js', 'js/render-result.js', 'js/map-global.js', 'js/analytics.js', 'js/api-reports.js',
  'privacy-policy/index.html', 'terms/index.html', 'delete-account/index.html', 'disclaimers/index.html',
]);

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalized(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function recordHash(record) {
  const { contentHash, ...body } = record;
  return sha256(canonicalJson(body));
}

export function sealRecord(record) {
  return { ...record, contentHash: recordHash(record) };
}

function assertPlainId(value, label, maxLength = 160) {
  if (typeof value !== 'string' || value.length > maxLength || !/^[a-z0-9][a-z0-9._-]{5,159}$/.test(value)) fail(`${label} is invalid or unsafe as a cross-platform filename`);
}

function assertReference(value, label, maxLength = 240) {
  if (typeof value !== 'string' || value.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,239}$/.test(value)) fail(`${label} is invalid`);
}

function assertComponent(value) {
  if (!COMPONENTS.includes(value)) fail(`Unknown release component: ${value}`);
}

function assertTimestamp(value, label) {
  const canonical = typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : '';
  const normalizedInput = typeof value === 'string' && value.includes('.') ? value : String(value).replace(/Z$/, '.000Z');
  if (!canonical || canonical !== normalizedInput) fail(`${label} must be a canonical ISO UTC timestamp`);
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) fail(`${label} must be a full lowercase Git SHA`);
}

function assertAllowedKeys(value, allowed, label) {
  const extra = Object.keys(value ?? {}).filter((key) => !allowed.includes(key));
  if (extra.length) fail(`${label} contains unapproved fields: ${extra.join(', ')}`);
}

export function validateRecord(record) {
  if (!record || record.schemaVersion !== 1) fail('Release record schemaVersion must be 1');
  if (!RECORD_TYPES.includes(record.recordType)) fail(`Unknown release record type: ${record.recordType}`);
  assertPlainId(record.recordId, 'recordId');
  assertComponent(record.component);
  assertTimestamp(record.createdAt, 'createdAt');
  if (!HASH_PATTERN.test(record.contentHash ?? '') || record.contentHash !== recordHash(record)) fail(`Release record ${record.recordId} has an invalid contentHash`);

  const commonKeys = ['schemaVersion', 'recordType', 'recordId', 'component', 'createdAt', 'contentHash'];
  const typeKeys = {
    genesis: ['baselineId', 'decision', 'ownerApprovalRef', 'evidenceRef'],
    candidate: ['sourceCommit', 'review', 'configuration', 'build', 'migrations', 'baseline', 'baselineHash', 'eligibility'],
    intent: ['candidateId', 'executionId', 'originMainCommit', 'executionStarted'],
    final: ['candidateId', 'executionId', 'executionEvidence', 'rollbackBaselineId'],
    abandon: ['candidateId', 'executionId', 'executionNeverBegan', 'neverStartedAttestation', 'reason'],
    reconcile: ['candidateId', 'executionId', 'priorOutcomeId', 'ownerDecisionRef', 'executionEvidence', 'rollbackBaselineId'],
  }[record.recordType];
  assertAllowedKeys(record, [...commonKeys, ...typeKeys], `${record.recordType} record`);

  if (record.recordType === 'genesis') {
    if (!record.baselineId || record.decision !== 'accept-no-known-rollback') fail('Genesis acceptance decision is invalid');
    for (const key of ['ownerApprovalRef', 'evidenceRef']) if (typeof record[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,239}$/.test(record[key])) fail(`Genesis ${key} is invalid`);
  } else if (record.recordType === 'candidate') {
    assertSha(record.sourceCommit, 'candidate sourceCommit');
    if (record.review?.sourceCommit !== record.sourceCommit) fail('Candidate review evidence is not bound to sourceCommit');
    if (record.configuration?.sourceCommit !== record.sourceCommit) fail('Candidate configuration evidence is not bound to sourceCommit');
    assertAllowedKeys(record.review, ['sourceCommit', 'reviewCommit', 'reviewId', 'pr', 'bmad', 'evidenceSha256', 'recordPath', 'recordBlob', 'artifactPath', 'artifactBlob'], 'candidate review');
    assertAllowedKeys(record.configuration, ['sourceCommit', 'component', 'identity', 'authority', 'validation', 'remotePresence', 'attestationPath', 'attestationBlob'], 'candidate configuration');
    assertAllowedKeys(record.build, ['inputs', 'identity', 'details'], 'candidate build');
    for (const input of record.build?.inputs ?? []) assertAllowedKeys(input, ['path', 'sha256'], 'candidate build input');
    assertAllowedKeys(record.migrations, ['basis', 'catalogSha256', 'first', 'last', 'count', 'bootstrapStatus', 'items'], 'candidate migrations');
    for (const item of record.migrations?.items ?? []) assertAllowedKeys(item, ['id', 'sha256', 'gitBlob'], 'candidate migration');
    assertAllowedKeys(record.baseline, ['baselineId', 'releaseId', 'rollback', 'ordinaryEligibility', 'cacheVersion', 'genesisAcceptance'], 'candidate baseline');
    assertAllowedKeys(record.baseline?.rollback, ['status', 'releaseId', 'baselineId'], 'candidate rollback');
    if (record.baseline?.genesisAcceptance) assertAllowedKeys(record.baseline.genesisAcceptance, ['recordId', 'ownerApprovalRef', 'evidenceRef'], 'candidate genesis acceptance');
    assertAllowedKeys(record.eligibility, ['status', 'blockingReasons'], 'candidate eligibility');
    const { evidenceSha256, ...reviewBody } = record.review ?? {};
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(record.review?.reviewId ?? '') || !PR_PATTERN.test(record.review?.pr ?? '') || record.review?.bmad !== 'passed' || evidenceSha256 !== sha256(canonicalJson(reviewBody)) || !record.review?.recordPath || !record.review?.artifactPath || !/^[a-f0-9]{40,64}$/.test(record.review?.recordBlob ?? '') || !/^[a-f0-9]{40,64}$/.test(record.review?.artifactBlob ?? '')) fail('Candidate lacks complete versioned PR/BMad review evidence');
    assertSha(record.review.reviewCommit, 'candidate reviewCommit');
    if (record.configuration?.component !== record.component || !HASH_PATTERN.test(record.configuration?.identity ?? '') || record.configuration?.validation !== 'passed') fail('Candidate lacks validated component configuration identity');
    if (!['unverified', 'attested'].includes(record.configuration.remotePresence)) fail('Candidate configuration remotePresence is invalid');
    if (!record.migrations?.catalogSha256 || !record.migrations?.basis) fail('Candidate lacks migration catalog identity and basis');
    if (!Array.isArray(record.migrations.items) || record.migrations.items.some((item) => !item.id || !HASH_PATTERN.test(item.sha256 ?? '') || !/^[a-f0-9]{40,64}$/.test(item.gitBlob ?? ''))) fail('Candidate lacks migration checksums/Git blobs');
    if (!record.baseline?.baselineId || !record.baselineHash || !record.build?.identity) fail('Candidate lacks baseline or build identity');
    if (!['eligible', 'blocked'].includes(record.eligibility?.status)) fail('Candidate eligibility status is invalid');
    if (!Array.isArray(record.eligibility.blockingReasons)) fail('Candidate blockingReasons must be an array');
  } else {
    assertPlainId(record.candidateId, 'candidateId');
    assertPlainId(record.executionId, 'executionId', 140);
    if (record.recordType === 'intent') {
      assertSha(record.originMainCommit, 'intent originMainCommit');
      if (record.executionStarted !== false) fail('Intent must begin with executionStarted=false');
    }
    if (record.recordType === 'final' || record.recordType === 'reconcile') {
      const evidence = record.executionEvidence;
      assertAllowedKeys(evidence, ['kind', 'executionId', 'result', 'approvalRef', 'evidenceRef', 'startedAt', 'completedAt', 'releaseId', 'migrations'], 'executionEvidence');
      if (!evidence || evidence.executionId !== record.executionId || !RESULT_VALUES.has(evidence.result) || !evidence.approvalRef || !evidence.evidenceRef) fail('Final record requires approved execution evidence bound to executionId');
      assertReference(evidence.approvalRef, 'execution approvalRef');
      assertReference(evidence.evidenceRef, 'execution evidenceRef');
      if (evidence.releaseId !== undefined) assertReference(evidence.releaseId, 'execution releaseId');
      if (evidence.result === 'success' && evidence.kind === 'platform' && !evidence.releaseId) fail('Successful platform final evidence requires releaseId');
      if (evidence.result === 'success' && evidence.kind === 'database' && (!Array.isArray(evidence.migrations) || !evidence.migrations.length)) fail('Successful database final evidence requires migration IDs and checksums');
      if (!['platform', 'database'].includes(evidence.kind)) fail('Final evidence kind is invalid');
      if (record.component === 'database' ? evidence.kind !== 'database' : evidence.kind !== 'platform') fail('Final evidence kind does not match component');
      for (const item of evidence.migrations ?? []) {
        assertAllowedKeys(item, ['id', 'sha256'], 'database migration evidence');
        if (!/^\d{3}$/.test(item.id ?? '') || !HASH_PATTERN.test(item.sha256 ?? '')) fail('Database migration evidence item is invalid');
      }
      if (evidence.startedAt) assertTimestamp(evidence.startedAt, 'execution startedAt');
      if (evidence.completedAt) assertTimestamp(evidence.completedAt, 'execution completedAt');
      if (evidence.startedAt && evidence.completedAt && Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) fail('Execution evidence completedAt predates startedAt');
      if (record.recordType === 'reconcile') {
        assertPlainId(record.priorOutcomeId, 'priorOutcomeId');
        assertReference(record.ownerDecisionRef, 'reconciliation ownerDecisionRef');
        if (!['success', 'failed'].includes(evidence.result)) fail('Reconciliation must resolve to success or failed');
      }
    }
    if (record.recordType === 'abandon') {
      const proof = record.neverStartedAttestation;
      assertAllowedKeys(proof, ['executionId', 'executionStarted', 'operator', 'approvalRef', 'observedAt'], 'neverStartedAttestation');
      if (record.executionNeverBegan !== true || proof?.executionId !== record.executionId || proof?.executionStarted !== false || !proof?.operator || !proof?.approvalRef) fail('An intent can be abandoned only with preserved never-started evidence');
      assertReference(proof.operator, 'never-started operator', 160);
      assertReference(proof.approvalRef, 'never-started approvalRef', 160);
      assertTimestamp(proof.observedAt, 'never-started observedAt');
      if (typeof record.reason !== 'string' || !record.reason.trim() || record.reason.length > 240 || /[\r\n]/.test(record.reason)) fail('Abandonment reason must be a short single-line explanation');
    }
  }
  return record;
}

function safeRepositoryPath(root, input, label) {
  if (typeof input !== 'string' || !input || isAbsolute(input)) fail(`${label} must be a repository-relative path`);
  const absolute = resolve(root, input);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) fail(`${label} escapes the repository`);
  return absolute;
}

function listRecordFiles(root) {
  const directory = join(root, RECORD_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(directory, entry.name));
}

export function validateRecordSet(records, baselines) {
  const byId = new Map();
  const executionOwners = new Map();
  for (const record of records) {
    validateRecord(record);
    if (byId.has(record.recordId)) fail(`Duplicate release recordId: ${record.recordId}`);
    byId.set(record.recordId, record);
    if (record.executionId) {
      const owner = executionOwners.get(record.executionId);
      if (owner && owner.candidateId !== record.candidateId) fail(`executionId ${record.executionId} spans multiple candidates`);
      executionOwners.set(record.executionId, record);
    }
  }

  const candidates = new Map(records.filter((item) => item.recordType === 'candidate').map((item) => [item.recordId, item]));
  const intents = new Map(records.filter((item) => item.recordType === 'intent').map((item) => [item.executionId, item]));
  if (intents.size !== records.filter((item) => item.recordType === 'intent').length) fail('Duplicate intent executionId');
  const resolutions = new Map();
  for (const record of records.filter((item) => item.recordType === 'final' || item.recordType === 'abandon')) {
    const candidate = candidates.get(record.candidateId);
    const intent = intents.get(record.executionId);
    if (!candidate || !intent || intent.candidateId !== record.candidateId || intent.component !== record.component) {
      fail(`Resolution ${record.recordId} does not reference a matching candidate and intent`);
    }
    if (resolutions.has(record.executionId)) fail(`executionId ${record.executionId} has multiple resolutions`);
    resolutions.set(record.executionId, record);
  }
  const reconciliations = new Map();
  for (const record of records.filter((item) => item.recordType === 'reconcile')) {
    const candidate = candidates.get(record.candidateId);
    const intent = intents.get(record.executionId);
    const prior = resolutions.get(record.executionId);
    if (!candidate || !intent || !prior || prior.recordId !== record.priorOutcomeId || prior.recordType !== 'final' || !['unknown', 'conflict'].includes(prior.executionEvidence.result)) fail(`Reconciliation ${record.recordId} does not reference a matching unresolved outcome`);
    if (reconciliations.has(record.executionId)) fail(`executionId ${record.executionId} has multiple reconciliations`);
    reconciliations.set(record.executionId, record);
  }
  for (const intent of intents.values()) {
    const candidate = candidates.get(intent.candidateId);
    if (!candidate) fail(`Intent ${intent.recordId} references an unknown candidate`);
    if (candidate.component !== intent.component) fail(`Intent ${intent.recordId} component mismatches its candidate`);
    if (Date.parse(intent.createdAt) <= Date.parse(candidate.createdAt)) fail(`Intent ${intent.recordId} must be later than its candidate`);
  }

  for (const resolution of resolutions.values()) {
    const intent = intents.get(resolution.executionId);
    if (Date.parse(resolution.createdAt) <= Date.parse(intent.createdAt)) fail(`Resolution ${resolution.recordId} must be later than its intent`);
    if (resolution.recordType === 'final') {
      const candidate = candidates.get(resolution.candidateId);
      if (resolution.rollbackBaselineId !== candidate.baseline.baselineId) fail(`Final ${resolution.recordId} does not preserve its candidate rollback baseline`);
      const evidence = resolution.executionEvidence;
      if (evidence.startedAt && Date.parse(evidence.startedAt) < Date.parse(intent.createdAt)) fail(`Final ${resolution.recordId} started before its intent`);
      if (evidence.completedAt && Date.parse(evidence.completedAt) > Date.parse(resolution.createdAt)) fail(`Final ${resolution.recordId} completed after its record was created`);
      if (resolution.component === 'database' && evidence.migrations) {
        const expected = candidate.migrations.items.map(({ id, sha256: checksum }) => ({ id, sha256: checksum }));
        if (!sameValue(evidence.migrations, expected)) fail(`Final ${resolution.recordId} migration evidence does not match its candidate ledger`);
      }
    } else {
      const observedAt = resolution.neverStartedAttestation.observedAt;
      if (Date.parse(observedAt) < Date.parse(intent.createdAt) || Date.parse(observedAt) > Date.parse(resolution.createdAt)) fail(`Abandonment ${resolution.recordId} observation is outside the intent window`);
    }
  }
  for (const reconciliation of reconciliations.values()) {
    const prior = resolutions.get(reconciliation.executionId);
    if (Date.parse(reconciliation.createdAt) <= Date.parse(prior.createdAt)) fail(`Reconciliation ${reconciliation.recordId} must be later than its unresolved outcome`);
    const intent = intents.get(reconciliation.executionId);
    const candidate = candidates.get(reconciliation.candidateId);
    if (reconciliation.rollbackBaselineId !== candidate.baseline.baselineId) fail(`Reconciliation ${reconciliation.recordId} does not preserve its candidate rollback baseline`);
    const evidence = reconciliation.executionEvidence;
    if (evidence.startedAt && Date.parse(evidence.startedAt) < Date.parse(intent.createdAt)) fail(`Reconciliation ${reconciliation.recordId} started before its intent`);
    if (evidence.completedAt && Date.parse(evidence.completedAt) > Date.parse(reconciliation.createdAt)) fail(`Reconciliation ${reconciliation.recordId} completed after its record was created`);
    if (reconciliation.component === 'database' && evidence.migrations) {
      const expected = candidate.migrations.items.map(({ id, sha256: checksum }) => ({ id, sha256: checksum }));
      if (!sameValue(evidence.migrations, expected)) fail(`Reconciliation ${reconciliation.recordId} migration evidence does not match its candidate ledger`);
    }
  }

  const currentBaselines = structuredClone(baselines.components ?? {});
  const openByComponent = new Map();
  const genesisAcceptances = new Map();
  const typeOrder = { genesis: 0, candidate: 1, intent: 2, final: 3, abandon: 3, reconcile: 4 };
  const promote = (record) => {
    const candidate = candidates.get(record.candidateId);
    currentBaselines[record.component] = {
      baselineId: record.recordId,
      releaseId: record.executionEvidence.kind === 'platform' ? record.executionEvidence.releaseId : null,
      sourceCommit: candidate.sourceCommit,
      basis: record.recordType === 'reconcile' ? 'owner-reconciled-execution-evidence' : 'final-execution-evidence',
      evidencePath: `${RECORD_DIRECTORY}/${record.recordId}.json`,
      rollback: { status: 'known', releaseId: candidate.baseline.releaseId, baselineId: candidate.baseline.baselineId },
      ordinaryEligibility: 'eligible',
      ...(record.component === 'pages' ? { cacheVersion: candidate.build.details.cacheVersion } : {}),
    };
  };
  for (const record of [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || typeOrder[a.recordType] - typeOrder[b.recordType] || a.recordId.localeCompare(b.recordId))) {
    if (record.recordType === 'genesis') {
      const baseline = currentBaselines[record.component];
      if (!baseline || record.baselineId !== baseline.baselineId || baseline.rollback.status !== 'unknown' || baseline.ordinaryEligibility !== 'blocked-no-known-rollback' || genesisAcceptances.has(record.component)) fail(`Genesis acceptance ${record.recordId} does not match one blocked no-rollback baseline`);
      baseline.ordinaryEligibility = 'eligible';
      baseline.genesisAcceptance = { recordId: record.recordId, ownerApprovalRef: record.ownerApprovalRef, evidenceRef: record.evidenceRef };
      genesisAcceptances.set(record.component, record);
    }
    if (record.recordType === 'candidate') {
      const baseline = currentBaselines[record.component];
      const expected = baselineSnapshot(baseline);
      if (!baseline || !sameValue(record.baseline, expected) || record.baselineHash !== sha256(canonicalJson(expected))) fail(`Candidate ${record.recordId} does not use the exact current baseline`);
      const blockers = eligibilityBlockers(record, baseline);
      const expectedEligibility = { status: blockers.length ? 'blocked' : 'eligible', blockingReasons: blockers };
      if (!sameValue(record.eligibility, expectedEligibility)) fail(`Candidate ${record.recordId} has inconsistent eligibility`);
    }
    if (record.recordType === 'intent') {
      const candidate = candidates.get(record.candidateId);
      const expected = baselineSnapshot(currentBaselines[record.component]);
      if (candidate.eligibility.status !== 'eligible' || !sameValue(candidate.baseline, expected) || candidate.baselineHash !== sha256(canonicalJson(expected))) fail(`Intent ${record.recordId} does not use an eligible candidate on the exact current baseline`);
      if (openByComponent.has(record.component)) fail(`Component ${record.component} has overlapping open execution intents`);
      openByComponent.set(record.component, record.executionId);
    }
    if (record.recordType === 'final' || record.recordType === 'abandon') {
      if (openByComponent.get(record.component) !== record.executionId) fail(`Resolution ${record.recordId} does not own the active component lease`);
      if (record.recordType === 'abandon' || ['success', 'failed'].includes(record.executionEvidence.result)) openByComponent.delete(record.component);
      if (record.recordType === 'final' && record.executionEvidence.result === 'success') {
        const candidate = candidates.get(record.candidateId);
        if (record.executionEvidence.kind === 'platform' && [candidate.baseline.releaseId, candidate.baseline.rollback?.releaseId].filter(Boolean).includes(record.executionEvidence.releaseId)) fail(`Successful release ${record.recordId} did not produce a new release identity`);
        promote(record);
      }
    }
    if (record.recordType === 'reconcile') {
      if (openByComponent.get(record.component) !== record.executionId) fail(`Reconciliation ${record.recordId} does not own the blocked component lease`);
      openByComponent.delete(record.component);
      if (record.executionEvidence.result === 'success') {
        const candidate = candidates.get(record.candidateId);
        if (record.executionEvidence.kind === 'platform' && [candidate.baseline.releaseId, candidate.baseline.rollback?.releaseId].filter(Boolean).includes(record.executionEvidence.releaseId)) fail(`Reconciled release ${record.recordId} did not produce a new release identity`);
        promote(record);
      }
    }
  }
  return { byId, openByComponent, resolutions, reconciliations, genesisAcceptances, currentBaselines };
}

function baselineSnapshot(baseline) {
  if (!baseline) return null;
  return {
    baselineId: baseline.baselineId,
    releaseId: baseline.releaseId,
    rollback: baseline.rollback,
    ordinaryEligibility: baseline.ordinaryEligibility,
    ...(baseline.cacheVersion === undefined ? {} : { cacheVersion: baseline.cacheVersion }),
    ...(baseline.genesisAcceptance === undefined ? {} : { genesisAcceptance: baseline.genesisAcceptance }),
  };
}

function eligibilityBlockers(candidate, baseline) {
  const reasons = [];
  if (baseline.ordinaryEligibility !== 'eligible') reasons.push(baseline.ordinaryEligibility);
  if (candidate.configuration.authority !== 'deploy-config-contract' || !candidate.configuration.attestationPath || !candidate.configuration.attestationBlob) reasons.push('missing-authoritative-deploy-config-contract');
  if (candidate.component === 'database') reasons.push('database-live-state-unverified');
  return reasons;
}

export function validateImmutableHistory(nameStatusText) {
  const violations = [];
  for (const raw of nameStatusText.split(/\r?\n/).filter(Boolean)) {
    const [status, ...paths] = raw.split('\t');
    if (paths.some((path) => path.replace(/\\/g, '/').startsWith(`${RECORD_DIRECTORY}/`)) && status !== 'A') violations.push(raw);
  }
  if (violations.length) fail(`Release history is append-only; found mutation/deletion: ${violations.join(', ')}`);
}

function runGit(root, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, timeout: 30_000 });
  if (result.error) fail(`git ${args.join(' ')} could not complete: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.status === 0 ? result.stdout.trim() : null;
}

function withCommitTree(root, sourceCommit, callback) {
  if (!existsSync(join(root, '.git'))) return callback(root);
  const temporary = mkdtempSync(join(tmpdir(), 'gravestory-release-tree-'));
  const archivePath = join(temporary, 'source.tar');
  const treePath = join(temporary, 'tree');
  mkdirSync(treePath);
  try {
    const archive = spawnSync('git', ['archive', '--format=tar', `--output=${archivePath}`, sourceCommit], { cwd: root, encoding: 'utf8', shell: false, timeout: 60_000 });
    if (archive.status !== 0) fail(`Could not materialize candidate source ${sourceCommit}: ${(archive.stderr || archive.stdout).trim()}`);
    const extract = spawnSync('tar', ['-xf', archivePath, '-C', treePath], { cwd: root, encoding: 'utf8', shell: false, timeout: 60_000 });
    if (extract.status !== 0) fail(`Could not extract candidate source ${sourceCommit}: ${(extract.stderr || extract.stdout).trim()}`);
    return callback(treePath);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function sourceIdentities(root, sourceCommit, component, baseline) {
  return withCommitTree(root, sourceCommit, (tree) => ({ build: buildIdentity(tree, component, baseline), migrations: migrationIdentity(tree) }));
}

function assertCompletedBmadReview(content, path) {
  if (!/^#{2,3} Review Findings\s*$/m.test(content) || !/^- \[x\] \[Review\]/mi.test(content) || /^- \[ \] \[Review\]/mi.test(content)) fail(`BMad review record ${path} is not complete`);
}

function validateReviewReceipt(root, review, expectedSourceCommit, validatingRef = 'HEAD') {
  assertSha(review.reviewCommit, 'reviewCommit');
  if (runGit(root, ['merge-base', '--is-ancestor', expectedSourceCommit, review.reviewCommit], true) === null || runGit(root, ['merge-base', '--is-ancestor', review.reviewCommit, validatingRef], true) === null) fail('BMad review receipt is not on the candidate source-to-HEAD ancestry');
  if (typeof review.recordPath !== 'string' || !review.recordPath.startsWith('_bmad-output/') || !review.recordPath.endsWith('.json')) fail('BMad review receipt must be a repository JSON record under _bmad-output');
  safeRepositoryPath(root, review.recordPath, 'review receipt path');
  const recordBlob = runGit(root, ['rev-parse', `${review.reviewCommit}:${review.recordPath}`], true);
  if (!recordBlob || (review.recordBlob && review.recordBlob !== recordBlob)) fail('BMad review receipt blob is missing or mismatched');
  const receipt = JSON.parse(runGit(root, ['show', `${review.reviewCommit}:${review.recordPath}`]));
  assertAllowedKeys(receipt, ['schemaVersion', 'kind', 'sourceCommit', 'reviewId', 'pr', 'bmad', 'completedAt', 'findingsResolved', 'artifactPath', 'artifactBlob'], 'BMad review receipt');
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'bmad-code-review-receipt' || receipt.sourceCommit !== expectedSourceCommit || !/^[A-Za-z0-9._:-]{8,160}$/.test(receipt.reviewId ?? '') || !PR_PATTERN.test(receipt.pr ?? '') || receipt.bmad !== 'passed' || receipt.findingsResolved !== true) fail('BMad review receipt does not bind a completed pass to the exact candidate source');
  assertTimestamp(receipt.completedAt, 'BMad review completedAt');
  if (typeof receipt.artifactPath !== 'string' || !receipt.artifactPath.startsWith('_bmad-output/') || isAbsolute(receipt.artifactPath)) fail('BMad review artifact path is invalid');
  safeRepositoryPath(root, receipt.artifactPath, 'review artifact path');
  const artifactBlob = runGit(root, ['rev-parse', `${review.reviewCommit}:${receipt.artifactPath}`], true);
  if (!artifactBlob || artifactBlob !== receipt.artifactBlob) fail('BMad review artifact blob is missing or mismatched');
  assertCompletedBmadReview(runGit(root, ['show', `${review.reviewCommit}:${receipt.artifactPath}`]), receipt.artifactPath);
  return { sourceCommit: expectedSourceCommit, reviewCommit: review.reviewCommit, reviewId: receipt.reviewId, pr: receipt.pr, bmad: receipt.bmad, recordPath: review.recordPath, recordBlob, artifactPath: receipt.artifactPath, artifactBlob };
}

function assertDeployConfigAttestation(root, path, component, expectedIdentity) {
  const verifier = join(root, 'tools', 'deploy-config.mjs');
  if (!existsSync(verifier)) fail('Authoritative deploy config requires the versioned deploy-config verifier');
  const result = spawnSync(process.execPath, [verifier, 'verify-attestation', '--component', component, '--path', path], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    env: Object.fromEntries(['SystemRoot', 'PATH', 'TEMP', 'TMP', 'HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
  });
  if (result.status !== 0) fail(`Deploy config attestation failed versioned validation: ${(result.stderr || result.stdout).trim()}`);
  const verified = JSON.parse(result.stdout);
  if (verified.component !== component || verified.identity !== expectedIdentity || verified.validation !== 'passed') fail('Deploy config verifier output does not match the candidate attestation');
}

export function validateReleaseRepository(root, { checkHistory = true } = {}) {
  const baselinesPath = join(root, 'release', 'baselines.json');
  if (!existsSync(baselinesPath)) fail('release/baselines.json is missing');
  const baselines = readJson(baselinesPath);
  if (baselines.schemaVersion !== 1) fail('Release baseline schemaVersion must be 1');
  if (!HASH_PATTERN.test(baselines.contentHash ?? '') || baselines.contentHash !== recordHash(baselines)) fail('release/baselines.json has an invalid contentHash');
  for (const component of COMPONENTS) {
    const baseline = baselines.components?.[component];
    if (!baseline || !baseline.baselineId || !baseline.evidencePath || !['eligible', 'blocked-no-known-rollback', 'blocked-unverified-live-state'].includes(baseline.ordinaryEligibility)) fail(`Release baseline is incomplete for ${component}`);
    const evidence = safeRepositoryPath(root, baseline.evidencePath, `${component} evidencePath`);
    if (!existsSync(evidence) || !statSync(evidence).isFile()) fail(`Release baseline evidence is missing for ${component}`);
    if (baseline.sourceCommit !== null) assertSha(baseline.sourceCommit, `${component} baseline sourceCommit`);
    if (!['known', 'unknown'].includes(baseline.rollback?.status)) fail(`${component} rollback status is invalid`);
    if (baseline.rollback.status === 'known' && !baseline.rollback.releaseId) fail(`${component} known rollback lacks a releaseId`);
    if (baseline.ordinaryEligibility === 'eligible' && baseline.rollback.status !== 'known') fail(`${component} cannot be eligible without a known rollback`);
  }
  const records = listRecordFiles(root).map((path) => {
    const record = readJson(path);
    if (basename(path) !== `${record.recordId}.json`) fail(`Release record filename must match recordId: ${relative(root, path)}`);
    return record;
  });
  const state = validateRecordSet(records, baselines);
  if (existsSync(join(root, '.git'))) {
    for (const candidate of records.filter((record) => record.recordType === 'candidate')) {
      if (runGit(root, ['merge-base', '--is-ancestor', candidate.sourceCommit, 'HEAD'], true) === null) fail(`Candidate ${candidate.recordId} sourceCommit is not an ancestor of the validating tree`);
      const verifiedReview = validateReviewReceipt(root, candidate.review, candidate.sourceCommit);
      const { evidenceSha256, ...storedReview } = candidate.review;
      if (!sameValue(storedReview, verifiedReview)) fail(`Candidate ${candidate.recordId} review fields do not match its source-bound receipt`);
      const source = sourceIdentities(root, candidate.sourceCommit, candidate.component, candidate.baseline);
      if (!sameValue(candidate.build, source.build) || !sameValue(candidate.migrations, source.migrations)) fail(`Candidate ${candidate.recordId} identities do not match its reviewed sourceCommit`);
      if (candidate.configuration.authority !== 'deploy-config-contract') continue;
      const path = candidate.configuration.attestationPath;
      if (!path?.startsWith('deploy/config/')) fail(`Candidate ${candidate.recordId} uses an invalid config authority path`);
      const blob = runGit(root, ['rev-parse', `${candidate.sourceCommit}:${path}`], true);
      if (!blob || blob !== candidate.configuration.attestationBlob) fail(`Candidate ${candidate.recordId} config authority blob is not present at sourceCommit`);
      withCommitTree(root, candidate.sourceCommit, (tree) => assertDeployConfigAttestation(tree, path, candidate.component, candidate.configuration.identity));
    }
  }
  if (checkHistory && existsSync(join(root, '.git'))) {
    const history = runGit(root, ['log', '--all', '-m', '--format=', '--name-status', '--', RECORD_DIRECTORY]);
    validateImmutableHistory(history);
    const baselineHistory = runGit(root, ['log', '--all', '-m', '--format=', '--name-status', '--', 'release/baselines.json']);
    const baselineMutations = baselineHistory.split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith('A\t'));
    if (baselineMutations.length) fail(`Release genesis baseline is append-only; found mutation/deletion: ${baselineMutations.join(', ')}`);
    const worktree = runGit(root, ['status', '--porcelain=v1', '--', RECORD_DIRECTORY]);
    const unsafe = worktree.split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith('?? ') && !line.startsWith('A  '));
    if (unsafe.length) fail(`Committed release records cannot be edited or deleted: ${unsafe.join(', ')}`);
  }
  return { root, baselines, records, ...state };
}

function fileIdentity(root, paths) {
  const items = [...new Set(paths)].sort().map((path) => {
    const absolute = safeRepositoryPath(root, path, 'build input');
    if (!existsSync(absolute) || !statSync(absolute).isFile()) fail(`Build input is missing: ${path}`);
    return { path, sha256: sha256(readFileSync(absolute)) };
  });
  return { inputs: items, identity: sha256(canonicalJson(items)) };
}

function recursiveFiles(root, prefix) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ['node_modules', '.expo', '.wrangler', 'dist', 'coverage'].includes(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) output.push(relative(root, absolute).replace(/\\/g, '/'));
    }
  };
  const start = join(root, prefix);
  if (existsSync(start)) visit(start);
  return output;
}

function componentInputGraph(root, component) {
  if (component === 'pages') return ['docs/cloudflare-pages-manifest.txt', ...REQUIRED_PAGES_ASSETS];
  const prefixes = component === 'database' ? ['database', 'supabase-migrations', 'queries'] : [component];
  if (existsSync(join(root, '.git'))) {
    const tracked = runGit(root, ['ls-files', '--', ...prefixes], true);
    if (tracked !== null) return tracked.split(/\r?\n/).filter(Boolean).filter((path) => !/(^|\/)(?:node_modules|\.expo|\.wrangler|dist|coverage)(?:\/|$)/.test(path));
  }
  return prefixes.flatMap((prefix) => recursiveFiles(root, prefix));
}

function pagesAssetRevision(root, entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort()) {
    let content = readFileSync(join(root, entry));
    if (/\.(?:css|html|js)$/i.test(entry)) content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
    if (entry === 'sw.js') content = Buffer.from(content.toString('utf8').replace(/^const CACHE = .*;$/m, "const CACHE = '<asset-revision>';"));
    hash.update(entry); hash.update('\0'); hash.update(content); hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

function validateComponentContract(root, component, baseline) {
  if (component === 'pages') {
    const entries = readFileSync(join(root, 'docs', 'cloudflare-pages-manifest.txt'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!sameValue(entries, REQUIRED_PAGES_ASSETS)) fail('Pages candidate does not use the exact reviewed 22-file allowlist');
    for (const entry of entries) if (!existsSync(join(root, entry)) || !statSync(join(root, entry)).isFile()) fail(`Pages candidate asset is missing: ${entry}`);
    const revision = pagesAssetRevision(root, entries);
    const cache = readFileSync(join(root, 'sw.js'), 'utf8').match(/^const CACHE = 'gravestory-v(\d+)-([a-f0-9]{12})';/m);
    const cacheVersion = Number(cache?.[1]);
    if (!cache || !Number.isSafeInteger(cacheVersion) || cache[2] !== revision) fail('Pages candidate cache does not match the exact asset graph');
    if (baseline.cacheVersion !== undefined && cacheVersion <= baseline.cacheVersion) fail('Pages candidate cache version did not advance beyond the current release');
    return { assets: entries, cacheVersion, assetRevision: revision };
  }
  if (component === 'mobile') {
    const eas = readJson(join(root, 'mobile', 'eas.json'));
    if (eas.build?.production?.channel !== 'production' || eas.build?.production?.android?.buildType !== 'app-bundle') fail('Mobile candidate must preserve the production Android channel/app-bundle contract');
    const configUrl = pathToFileURL(join(root, 'mobile', 'app.config.js')).href;
    const script = "const {default:value}=await import(process.argv[1]); const c=value?.expo ?? value; process.stdout.write(JSON.stringify({runtimePolicy:c?.runtimeVersion?.policy,package:c?.android?.package,projectId:c?.extra?.eas?.projectId}));";
    const evaluated = spawnSync(process.execPath, ['--input-type=module', '--eval', script, configUrl], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      env: Object.fromEntries(['SystemRoot', 'PATH', 'TEMP', 'TMP', 'HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    });
    if (evaluated.status !== 0) fail(`Mobile app config could not be evaluated: ${(evaluated.stderr || evaluated.stdout).trim()}`);
    const app = JSON.parse(evaluated.stdout);
    if (app.runtimePolicy !== 'sdkVersion') fail('Mobile candidate must preserve the evaluated sdkVersion runtime policy');
    return { channel: 'production', platform: 'android', runtimePolicy: app.runtimePolicy, buildType: 'app-bundle', package: app.package ?? null, projectId: app.projectId ?? null };
  }
  if (component === 'worker') {
    const wrangler = readFileSync(join(root, 'worker', 'wrangler.toml'), 'utf8');
    const originValue = wrangler.match(/^ALLOWED_ORIGIN\s*=\s*"([^"]+)"$/m)?.[1] ?? '';
    const origins = originValue.split(',').map((value) => value.trim()).filter(Boolean).sort();
    const requiredOrigins = ['https://gravestory.pages.dev', 'https://j3k420.github.io'].sort();
    if (!/^WORKER_ENV\s*=\s*"production"$/m.test(wrangler) || !sameValue(origins, requiredOrigins)) fail('Worker candidate violates the exact production origin contract');
    return { environment: 'production', allowedOrigins: origins, wildcardOrigin: false };
  }
  const catalog = readJson(join(root, 'database', 'catalog.json'));
  if (catalog.bootstrap?.status !== 'unresolved') fail('Database bootstrap status changed without release-control support');
  return { bootstrapStatus: 'unresolved' };
}

function buildIdentity(root, component, baseline) {
  const inputs = componentInputGraph(root, component);
  if (!inputs.length) fail(`No tracked build inputs found for ${component}`);
  const files = fileIdentity(root, inputs);
  return { ...files, details: validateComponentContract(root, component, baseline) };
}

function migrationIdentity(root) {
  const catalog = readJson(join(root, 'database', 'catalog.json'));
  validateDatabaseControl(root, catalog);
  const migrations = catalog.artifacts.filter((item) => item.kind === 'migration');
  const items = migrations.map((item) => {
    const content = readFileSync(join(root, item.path));
    const checksum = sha256(content);
    if (checksum !== item.sha256) fail(`Migration ${item.id} checksum does not match database/catalog.json`);
    const header = Buffer.from(`blob ${content.length}\0`);
    return { id: item.id, sha256: checksum, gitBlob: createHash('sha1').update(header).update(content).digest('hex') };
  });
  return {
    basis: 'repository-intended',
    catalogSha256: sha256(readFileSync(join(root, 'database', 'catalog.json'))),
    first: migrations[0]?.id ?? null,
    last: migrations.at(-1)?.id ?? null,
    count: migrations.length,
    bootstrapStatus: catalog.bootstrap?.status ?? 'unknown',
    items,
  };
}

export function createCandidate({ root, component, sourceCommit, createdAt, review, configuration, baselines }) {
  assertComponent(component);
  assertSha(sourceCommit, 'sourceCommit');
  assertTimestamp(createdAt, 'createdAt');
  if (review?.sourceCommit !== sourceCommit || review?.bmad !== 'passed' || !/^[A-Za-z0-9._:-]{8,160}$/.test(review.reviewId ?? '') || !PR_PATTERN.test(review.pr ?? '') || !review.recordPath || !review.artifactPath || !/^[a-f0-9]{40,64}$/.test(review.recordBlob ?? '') || !/^[a-f0-9]{40,64}$/.test(review.artifactBlob ?? '')) fail('Review evidence must be complete, versioned, and bound to sourceCommit');
  assertSha(review.reviewCommit, 'reviewCommit');
  if (configuration?.sourceCommit !== sourceCommit || configuration?.component !== component || configuration?.validation !== 'passed' || !configuration.identity) {
    fail('Configuration attestation must be validated and bound to component/sourceCommit');
  }
  if (!HASH_PATTERN.test(configuration.identity)) fail('Configuration identity must be a SHA-256 hash');
  if (!['unverified', 'attested'].includes(configuration.remotePresence ?? 'unverified')) fail('Configuration remotePresence must be unverified or attested');
  const baseline = baselines.components[component];
  if (!baseline) fail(`No genesis/current baseline exists for ${component}`);
  const baselineRecord = baselineSnapshot(baseline);
  const configurationRecord = {
    sourceCommit,
    component,
    identity: configuration.identity,
    authority: configuration.authoritative === true ? 'deploy-config-contract' : 'unverified',
    validation: configuration.validation,
    remotePresence: configuration.remotePresence ?? 'unverified',
    ...(configuration.authoritative === true ? { attestationPath: configuration.attestationPath, attestationBlob: configuration.attestationBlob } : {}),
  };
  const provisional = { component, configuration: configurationRecord };
  const blockingReasons = eligibilityBlockers(provisional, baseline);
  const stamp = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  const reviewRecord = { sourceCommit, reviewCommit: review.reviewCommit, reviewId: review.reviewId, pr: review.pr, bmad: review.bmad, recordPath: review.recordPath, recordBlob: review.recordBlob, artifactPath: review.artifactPath, artifactBlob: review.artifactBlob };
  const source = sourceIdentities(root, sourceCommit, component, baseline);
  if (existsSync(join(root, '.git'))) {
    const current = sourceIdentities(root, runGit(root, ['rev-parse', 'HEAD']), component, baseline);
    if (!sameValue(source, current)) fail('Reviewed component or migration inputs changed after the source-bound BMad review');
  }
  return sealRecord({
    schemaVersion: 1,
    recordType: 'candidate',
    recordId: `candidate-${component}-${sourceCommit.slice(0, 12)}-${stamp}`,
    component,
    createdAt,
    sourceCommit,
    review: { ...reviewRecord, evidenceSha256: sha256(canonicalJson(reviewRecord)) },
    configuration: configurationRecord,
    build: source.build,
    migrations: source.migrations,
    baseline: baselineRecord,
    baselineHash: sha256(canonicalJson(baselineRecord)),
    eligibility: { status: blockingReasons.length ? 'blocked' : 'eligible', blockingReasons },
  });
}

export function createIntent({ candidate, originMainCommit, createdAt, executionId }) {
  validateRecord(candidate);
  if (candidate.recordType !== 'candidate' || candidate.eligibility.status !== 'eligible') fail('Only an eligible candidate can acquire an execution intent');
  assertSha(originMainCommit, 'originMainCommit');
  assertPlainId(executionId, 'executionId', 140);
  assertTimestamp(createdAt, 'createdAt');
  if (Date.parse(createdAt) <= Date.parse(candidate.createdAt)) fail('Intent must be later than its candidate');
  return sealRecord({
    schemaVersion: 1,
    recordType: 'intent',
    recordId: `intent-${executionId}`,
    component: candidate.component,
    candidateId: candidate.recordId,
    executionId,
    createdAt,
    originMainCommit,
    executionStarted: false,
  });
}

function sanitizeExecutionEvidence(input, intent, candidate, createdAt) {
  assertAllowedKeys(input, ['kind', 'executionId', 'result', 'approvalRef', 'evidenceRef', 'startedAt', 'completedAt', 'releaseId', 'migrations'], 'execution evidence input');
  if (!input || input.executionId !== intent.executionId || !RESULT_VALUES.has(input.result) || !input.approvalRef || !input.evidenceRef) fail('Execution evidence must be approved and bound to the intent');
  assertReference(input.approvalRef, 'execution approvalRef');
  assertReference(input.evidenceRef, 'execution evidenceRef');
  const common = { kind: input.kind, executionId: input.executionId, result: input.result, approvalRef: input.approvalRef, evidenceRef: input.evidenceRef };
  if (input.startedAt) {
    assertTimestamp(input.startedAt, 'execution startedAt');
    if (Date.parse(input.startedAt) < Date.parse(intent.createdAt)) fail('Execution startedAt predates its intent');
    common.startedAt = input.startedAt;
  }
  if (input.completedAt) {
    assertTimestamp(input.completedAt, 'execution completedAt');
    if (input.startedAt && Date.parse(input.completedAt) < Date.parse(input.startedAt)) fail('Execution completedAt predates startedAt');
    if (Date.parse(input.completedAt) > Date.parse(createdAt)) fail('Execution completedAt is after the final record timestamp');
    common.completedAt = input.completedAt;
  }
  if (input.kind === 'platform' && candidate.component !== 'database') {
    if (input.releaseId !== undefined) assertReference(input.releaseId, 'platform releaseId');
    if (input.result === 'success' && !input.releaseId) fail('Successful platform evidence requires a releaseId');
    if (input.result === 'success' && [candidate.baseline.releaseId, candidate.baseline.rollback?.releaseId].filter(Boolean).includes(input.releaseId)) fail('Successful platform evidence requires a new release identity');
    return { ...common, ...(input.releaseId ? { releaseId: input.releaseId } : {}) };
  }
  if (input.kind === 'database' && candidate.component === 'database') {
    if (input.migrations !== undefined && (!Array.isArray(input.migrations) || input.migrations.some((item) => {
      assertAllowedKeys(item, ['id', 'sha256'], 'database migration evidence input');
      return !/^\d{3}$/.test(item.id ?? '') || !HASH_PATTERN.test(item.sha256 ?? '');
    }))) fail('Database evidence contains invalid migration IDs or SHA-256 checksums');
    if (input.result === 'success' && (!input.migrations || !input.migrations.length)) fail('Successful database evidence requires migration IDs and SHA-256 checksums');
    const migrations = input.migrations?.map(({ id, sha256: checksum }) => ({ id, sha256: checksum }));
    const expected = candidate.migrations.items.map(({ id, sha256: checksum }) => ({ id, sha256: checksum }));
    if (migrations && !sameValue(migrations, expected)) fail('Database evidence does not match the candidate migration ledger');
    return { ...common, ...(migrations ? { migrations } : {}) };
  }
  fail('Execution evidence kind does not match the component');
}

function sanitizeNeverStartedAttestation(input, intent, createdAt) {
  assertAllowedKeys(input, ['executionId', 'executionStarted', 'operator', 'approvalRef', 'observedAt'], 'never-started attestation input');
  if (!input || input.executionId !== intent.executionId || input.executionStarted !== false || !input.operator || !input.approvalRef) fail('Abandonment requires approved never-started evidence');
  assertTimestamp(input.observedAt, 'never-started observedAt');
  if (Date.parse(input.observedAt) < Date.parse(intent.createdAt) || Date.parse(input.observedAt) > Date.parse(createdAt)) fail('Never-started observation is outside the intent window');
  for (const key of ['operator', 'approvalRef']) if (typeof input[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,159}$/.test(input[key])) fail(`Never-started ${key} is invalid`);
  return { executionId: input.executionId, executionStarted: false, operator: input.operator, approvalRef: input.approvalRef, observedAt: input.observedAt };
}

export function createResolution({ type, candidate, intent, createdAt, executionEvidence, neverStartedAttestation, reason }) {
  if (!['final', 'abandon'].includes(type)) fail('Resolution type must be final or abandon');
  validateRecord(candidate);
  validateRecord(intent);
  assertTimestamp(createdAt, 'createdAt');
  if (intent.candidateId !== candidate.recordId || intent.component !== candidate.component) fail('Resolution candidate and intent do not match');
  if (Date.parse(createdAt) <= Date.parse(intent.createdAt)) fail('Resolution must be later than its intent');
  if (type === 'abandon' && (typeof reason !== 'string' || !reason.trim() || reason.length > 240 || /[\r\n]/.test(reason))) fail('Abandonment reason must be a short single-line explanation');
  const body = {
    schemaVersion: 1,
    recordType: type,
    recordId: `${type}-${intent.executionId}`,
    component: candidate.component,
    candidateId: candidate.recordId,
    executionId: intent.executionId,
    createdAt,
    ...(type === 'final'
      ? { executionEvidence: sanitizeExecutionEvidence(executionEvidence, intent, candidate, createdAt), rollbackBaselineId: candidate.baseline.baselineId }
      : { executionNeverBegan: true, neverStartedAttestation: sanitizeNeverStartedAttestation(neverStartedAttestation, intent, createdAt), reason }),
  };
  return sealRecord(body);
}

export function createReconciliation({ candidate, intent, priorOutcome, createdAt, executionEvidence, ownerDecisionRef }) {
  validateRecord(candidate);
  validateRecord(intent);
  validateRecord(priorOutcome);
  assertTimestamp(createdAt, 'createdAt');
  if (priorOutcome.recordType !== 'final' || !['unknown', 'conflict'].includes(priorOutcome.executionEvidence.result) || priorOutcome.executionId !== intent.executionId || priorOutcome.candidateId !== candidate.recordId) fail('Reconciliation requires the matching unresolved final outcome');
  if (Date.parse(createdAt) <= Date.parse(priorOutcome.createdAt)) fail('Reconciliation must be later than the unresolved outcome');
  if (typeof ownerDecisionRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,239}$/.test(ownerDecisionRef)) fail('Reconciliation requires an owner decision reference');
  const evidence = sanitizeExecutionEvidence(executionEvidence, intent, candidate, createdAt);
  if (!['success', 'failed'].includes(evidence.result)) fail('Reconciliation must resolve to success or failed');
  if (evidence.result === 'success' && evidence.kind === 'platform' && evidence.releaseId === candidate.baseline.releaseId) fail('Successful reconciliation requires a new release identity');
  return sealRecord({
    schemaVersion: 1,
    recordType: 'reconcile',
    recordId: `reconcile-${intent.executionId}`,
    component: candidate.component,
    candidateId: candidate.recordId,
    executionId: intent.executionId,
    createdAt,
    priorOutcomeId: priorOutcome.recordId,
    ownerDecisionRef,
    executionEvidence: evidence,
    rollbackBaselineId: candidate.baseline.baselineId,
  });
}

export function createGenesisAcceptance({ component, baseline, createdAt, ownerApprovalRef, evidenceRef }) {
  assertComponent(component);
  assertTimestamp(createdAt, 'createdAt');
  if (!['pages', 'worker'].includes(component) || baseline?.rollback?.status !== 'unknown' || baseline?.ordinaryEligibility !== 'blocked-no-known-rollback') fail('Genesis acceptance applies only to a blocked Pages/Worker no-rollback baseline');
  const stamp = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  const record = sealRecord({ schemaVersion: 1, recordType: 'genesis', recordId: `genesis-${component}-${stamp}`, component, createdAt, baselineId: baseline.baselineId, decision: 'accept-no-known-rollback', ownerApprovalRef, evidenceRef });
  validateRecord(record);
  return record;
}

function assertCandidateCurrent(candidate, state) {
  const baseline = state.currentBaselines[candidate.component];
  const expected = baselineSnapshot(baseline);
  if (!sameValue(candidate.baseline, expected) || candidate.baselineHash !== sha256(canonicalJson(expected))) fail('Candidate rollback baseline is stale');
  const currentCommit = existsSync(join(state.root, '.git')) ? runGit(state.root, ['rev-parse', 'HEAD']) : candidate.sourceCommit;
  const current = sourceIdentities(state.root, currentCommit, candidate.component, baseline);
  if (!sameValue(candidate.build, current.build)) fail('Candidate component source is stale relative to current origin/main');
  if (!sameValue(candidate.migrations, current.migrations)) fail('Candidate migration ledger is stale relative to current origin/main');
  if (candidate.configuration.authority === 'deploy-config-contract' && existsSync(join(state.root, '.git'))) {
    const path = candidate.configuration.attestationPath;
    const headBlob = runGit(state.root, ['rev-parse', `HEAD:${path}`], true);
    const workingBlob = runGit(state.root, ['hash-object', path], true);
    if (!headBlob || headBlob !== candidate.configuration.attestationBlob || workingBlob !== headBlob) fail('Candidate authoritative deploy config is stale relative to current HEAD');
  }
}

export function revalidateExecutionLease({ candidate, intent, state, headCommit, originMainCommit, clean }) {
  validateRecord(candidate);
  validateRecord(intent);
  if (!clean) fail('Baseline revalidation requires a clean worktree');
  if (headCommit !== originMainCommit) fail('Execution intent is stale relative to current origin/main');
  if (existsSync(join(state.root, '.git')) && runGit(state.root, ['merge-base', '--is-ancestor', intent.originMainCommit, headCommit], true) === null) fail('Execution intent was not created from an ancestor of current origin/main');
  if (candidate.eligibility.status !== 'eligible') fail('Execution candidate is no longer eligible');
  if (intent.candidateId !== candidate.recordId || intent.component !== candidate.component) fail('Execution intent does not match its candidate');
  if (state.resolutions.has(intent.executionId)) fail('Execution intent is already resolved');
  if (state.openByComponent.get(intent.component) !== intent.executionId) fail('Execution intent is not the component lease holder');
  assertCandidateCurrent(candidate, state);
  return true;
}

function parseArgs(argv) {
  const [command = 'validate', ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(options, key)) fail(`Duplicate --${key}`);
    if (key === 'write') options[key] = true;
    else {
      const value = tokens[index + 1];
      if (!value || value.startsWith('--')) fail(`--${key} requires a value`);
      options[key] = value;
      index += 1;
    }
  }
  return { command, options };
}

function assertCleanSource(root) {
  const status = runGit(root, ['status', '--porcelain']);
  if (status) fail('Release preflight requires a clean source tree');
  return runGit(root, ['rev-parse', 'HEAD']);
}

function writeRecord(root, record) {
  const directory = join(root, RECORD_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${record.recordId}.json`);
  if (existsSync(path)) fail(`Release record already exists: ${relative(root, path)}`);
  writeFileSync(path, canonicalJson(record), { flag: 'wx' });
  return relative(root, path);
}

function recordFromOption(root, state, input, expectedType) {
  if (!input) fail(`--${expectedType} is required`);
  const path = safeRepositoryPath(root, input, expectedType);
  const relativePath = relative(root, path).replace(/\\/g, '/');
  if (!relativePath.startsWith(`${RECORD_DIRECTORY}/`) || !existsSync(path)) fail(`${expectedType} must name an existing release/records JSON file`);
  const record = readJson(path);
  validateRecord(record);
  if (record.recordType !== expectedType) fail(`${input} is not a ${expectedType} record`);
  if (state.byId.get(record.recordId)?.contentHash !== record.contentHash) fail(`${expectedType} is not part of the validated record set`);
  return record;
}

function currentGitState(root, refreshOrigin = true) {
  if (refreshOrigin) runGit(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  const status = runGit(root, ['status', '--porcelain']);
  const headCommit = runGit(root, ['rev-parse', 'HEAD']);
  const originMainCommit = runGit(root, ['rev-parse', 'origin/main']);
  return { clean: !status, headCommit, originMainCommit };
}

function loadConfigurationEvidence(root, sourceCommit, input) {
  if (!input) fail('configuration attestation path is required');
  const absolute = resolve(input);
  const evidence = loadEvidence(absolute, 'configuration attestation');
  const fromRoot = relative(root, absolute).replace(/\\/g, '/');
  const inAuthoritativeBoundary = !isAbsolute(fromRoot) && !fromRoot.startsWith('../') && fromRoot.startsWith('deploy/config/');
  if (!inAuthoritativeBoundary) return { ...evidence, authoritative: false };
  const blob = runGit(root, ['rev-parse', `${sourceCommit}:${fromRoot}`], true);
  if (!blob || !/^[a-f0-9]{40,64}$/.test(blob)) fail('Authoritative config attestation must be committed at the candidate source SHA');
  const workingBlob = runGit(root, ['hash-object', fromRoot]);
  if (workingBlob !== blob) fail('Authoritative config attestation differs from the candidate source blob');
  assertDeployConfigAttestation(root, fromRoot, evidence.component, evidence.identity);
  return { ...evidence, sourceCommit, authoritative: true, attestationPath: fromRoot, attestationBlob: blob };
}

function loadReviewEvidence(root, headCommit, input) {
  const evidence = loadEvidence(input, 'review evidence');
  assertSha(evidence.sourceCommit, 'reviewed sourceCommit');
  return validateReviewReceipt(root, evidence, evidence.sourceCommit, headCommit);
}

function loadEvidence(path, label) {
  if (!path) fail(`${label} path is required`);
  const value = readJson(resolve(path));
  if (!value || typeof value !== 'object') fail(`${label} must be a JSON object`);
  return value;
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  if (command === 'validate') {
    const state = validateReleaseRepository(ROOT);
    console.log(`Release provenance valid: ${state.records.length} append-only record(s).`);
    return;
  }
  if (command === 'accept-genesis') {
    const git = currentGitState(ROOT);
    if (!git.clean || git.headCommit !== git.originMainCommit) fail('Genesis acceptance must be created from a clean current origin/main');
    const state = validateReleaseRepository(ROOT);
    if (state.genesisAcceptances.has(options.component)) fail(`Component ${options.component} already has a genesis acceptance`);
    const record = createGenesisAcceptance({ component: options.component, baseline: state.currentBaselines[options.component], createdAt: options['created-at'], ownerApprovalRef: options['owner-approval-ref'], evidenceRef: options['evidence-ref'] });
    if (options.write) console.log(`Wrote ${writeRecord(ROOT, record)}`);
    else process.stdout.write(canonicalJson(record));
    return;
  }
  if (command === 'candidate') {
    const headCommit = assertCleanSource(ROOT);
    const state = validateReleaseRepository(ROOT);
    const review = loadReviewEvidence(ROOT, headCommit, options['review-evidence']);
    const sourceCommit = review.sourceCommit;
    const candidate = createCandidate({
      root: ROOT,
      component: options.component,
      sourceCommit,
      createdAt: options['created-at'],
      review,
      configuration: loadConfigurationEvidence(ROOT, sourceCommit, options['config-attestation']),
      baselines: { components: state.currentBaselines },
    });
    if (options.write) console.log(`Wrote ${writeRecord(ROOT, candidate)}`);
    else process.stdout.write(canonicalJson(candidate));
    return;
  }
  if (command === 'intent') {
    const git = currentGitState(ROOT);
    if (!git.clean || git.headCommit !== git.originMainCommit) fail('Execution intent must be created from a clean current origin/main');
    const state = validateReleaseRepository(ROOT);
    const candidate = recordFromOption(ROOT, state, options.candidate, 'candidate');
    if (state.openByComponent.has(candidate.component)) fail(`Component ${candidate.component} already has an open execution intent`);
    assertCandidateCurrent(candidate, state);
    const intent = createIntent({ candidate, originMainCommit: git.originMainCommit, createdAt: options['created-at'], executionId: options['execution-id'] });
    if (options.write) console.log(`Wrote ${writeRecord(ROOT, intent)}`);
    else process.stdout.write(canonicalJson(intent));
    return;
  }
  if (command === 'revalidate') {
    const git = currentGitState(ROOT);
    const state = validateReleaseRepository(ROOT);
    const intent = recordFromOption(ROOT, state, options.intent, 'intent');
    const candidate = state.byId.get(intent.candidateId);
    revalidateExecutionLease({ candidate, intent, state, ...git });
    console.log(`Execution lease ${intent.executionId} is current. No external command was run.`);
    return;
  }
  if (command === 'reconcile') {
    const git = currentGitState(ROOT);
    if (!git.clean || git.headCommit !== git.originMainCommit) fail('Reconciliation must be created from a clean current origin/main');
    const state = validateReleaseRepository(ROOT);
    const intent = recordFromOption(ROOT, state, options.intent, 'intent');
    const candidate = state.byId.get(intent.candidateId);
    const priorOutcome = state.resolutions.get(intent.executionId);
    const evidence = loadEvidence(options.evidence, 'reconciled execution evidence');
    const record = createReconciliation({ candidate, intent, priorOutcome, createdAt: options['created-at'], executionEvidence: evidence, ownerDecisionRef: options['owner-decision-ref'] });
    const existing = state.reconciliations.get(intent.executionId);
    if (existing) {
      if (existing.ownerDecisionRef !== record.ownerDecisionRef || !sameValue(existing.executionEvidence, record.executionEvidence)) fail(`Execution ${intent.executionId} already has a different reconciliation`);
      console.log(`Execution ${intent.executionId} is already reconciled by ${existing.recordId}; retry is idempotent.`);
      return;
    }
    const expected = baselineSnapshot(state.currentBaselines[candidate.component]);
    if (!sameValue(candidate.baseline, expected) || candidate.baselineHash !== sha256(canonicalJson(expected))) fail('Reconciliation candidate rollback baseline is stale');
    if (options.write) console.log(`Wrote ${writeRecord(ROOT, record)}`);
    else process.stdout.write(canonicalJson(record));
    return;
  }
  if (command === 'finalize' || command === 'abandon') {
    const git = currentGitState(ROOT);
    if (!git.clean || git.headCommit !== git.originMainCommit) fail('Resolution must be created from a clean current origin/main');
    const state = validateReleaseRepository(ROOT);
    const intent = recordFromOption(ROOT, state, options.intent, 'intent');
    const candidate = state.byId.get(intent.candidateId);
    let record;
    if (command === 'finalize') {
      const evidence = loadEvidence(options.evidence, 'execution evidence');
      record = createResolution({ type: 'final', candidate, intent, createdAt: options['created-at'], executionEvidence: evidence });
    } else {
      const attestation = loadEvidence(options.attestation, 'never-started attestation');
      record = createResolution({ type: 'abandon', candidate, intent, createdAt: options['created-at'], reason: options.reason, neverStartedAttestation: attestation });
    }
    const existing = state.resolutions.get(intent.executionId);
    if (existing) {
      const sameResolution = existing.recordType === record.recordType
        && (record.recordType === 'final'
          ? sameValue(existing.executionEvidence, record.executionEvidence)
          : sameValue(existing.neverStartedAttestation, record.neverStartedAttestation) && existing.reason === record.reason);
      if (!sameResolution) fail(`Execution ${intent.executionId} is already resolved with different evidence`);
      console.log(`Execution ${intent.executionId} is already resolved by ${existing.recordId}; retry is idempotent.`);
      return;
    }
    if (options.write) console.log(`Wrote ${writeRecord(ROOT, record)}`);
    else process.stdout.write(canonicalJson(record));
    return;
  }
  fail(`Unknown release-control command: ${command}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Release control failed: ${error.message}`);
    process.exitCode = 1;
  }
}

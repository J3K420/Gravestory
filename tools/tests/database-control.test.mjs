import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertLocalBootstrapReady,
  fingerprintSql,
  isSelectOnlySql,
  isLocalDockerEndpoint,
  loadDatabaseCatalog,
  localExecutionEnvironment,
  parseLocalSelection,
  validateDatabaseControl,
  verifyGeneratedMigrationDirectory,
} from '../database-control.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('database catalog fingerprints and classifies the complete SQL inventory', () => {
  const result = validateDatabaseControl(root, loadDatabaseCatalog());
  assert.deepEqual(result, { artifactCount: 44, migrationCount: 33, bootstrapStatus: 'unresolved' });
});

test('SQL fingerprints preserve exact bytes, including line endings', () => {
  assert.notEqual(fingerprintSql('select 1;\nselect 2;\n'), fingerprintSql('select 1;\r\nselect 2;\r\n'));
});

test('database catalog rejects drift, uncataloged SQL, and unexplained gaps', () => {
  const fingerprintDrift = structuredClone(loadDatabaseCatalog());
  fingerprintDrift.artifacts[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateDatabaseControl(root, fingerprintDrift), /fingerprint mismatch/);

  const uncataloged = structuredClone(loadDatabaseCatalog());
  uncataloged.artifacts = uncataloged.artifacts.filter(({ path }) => path !== 'queries/dashboard.sql');
  assert.throws(() => validateDatabaseControl(root, uncataloged), /Uncataloged SQL artifacts/);

  const unexplainedGap = structuredClone(loadDatabaseCatalog());
  unexplainedGap.knownGaps = [];
  assert.throws(() => validateDatabaseControl(root, unexplainedGap), /Unexplained migration gap: 027/);

  const outOfOrder = structuredClone(loadDatabaseCatalog());
  [outOfOrder.artifacts[0], outOfOrder.artifacts[1]] = [outOfOrder.artifacts[1], outOfOrder.artifacts[0]];
  assert.throws(() => validateDatabaseControl(root, outOfOrder), /ascending order/);
});

test('write-capable SQL cannot be cataloged as read-only', () => {
  const misclassified = structuredClone(loadDatabaseCatalog());
  misclassified.artifacts.find(({ id }) => id === 'verify-026').access = 'read';
  assert.throws(() => validateDatabaseControl(root, misclassified), /contains SQL writes/);

  const readApproval = structuredClone(loadDatabaseCatalog());
  readApproval.artifacts.find(({ id }) => id === 'verify-026').approval = 'explicit-production-read';
  assert.throws(() => validateDatabaseControl(root, readApproval), /production-write approval/);
});

test('read-only SQL requires an enforced read-only transaction and rejects write forms', () => {
  const guard = 'set session characteristics as transaction read only; set transaction read only;';
  assert.equal(isSelectOnlySql(`${guard} select count(*) from x;`), true);
  for (const sql of [
    `${guard} merge into x using y on true when matched then delete;`,
    `${guard} copy x from stdin;`,
    `${guard} select 1 into temporary x;`,
    `${guard} refresh materialized view x;`,
    `${guard} select '-- not a comment'; update x set y = 1;`,
  ]) assert.equal(isSelectOnlySql(sql), false);
  assert.equal(isSelectOnlySql(`${guard} select mutating_rpc();`), false);
  assert.equal(isSelectOnlySql(`${guard} select count$side_effect();`), false);
  assert.equal(isSelectOnlySql(`${guard} select π();`), false);
  assert.equal(isSelectOnlySql(`${guard} select "pg_terminate_backend"(1);`), false);
});

test('bootstrap and operational metadata cannot claim inconsistent readiness', () => {
  const inconsistent = structuredClone(loadDatabaseCatalog());
  inconsistent.bootstrap.status = 'ready';
  assert.throws(() => validateDatabaseControl(root, inconsistent), /Ready bootstrap/);

  const noEvidence = structuredClone(loadDatabaseCatalog());
  noEvidence.bootstrap = { status: 'ready', missing: [], productionInspectionRequired: false, baselineEvidence: [] };
  assert.throws(() => validateDatabaseControl(root, noEvidence), /baseline evidence/);

  const missingOperation = structuredClone(loadDatabaseCatalog());
  missingOperation.operationalEntrypoints = missingOperation.operationalEntrypoints.filter(({ id }) => id !== 'metrics-digest');
  assert.throws(() => validateDatabaseControl(root, missingOperation), /Uncataloged database operations/);

  const downgradedOperation = structuredClone(loadDatabaseCatalog());
  downgradedOperation.operationalEntrypoints.find(({ id }) => id === 'tester-unlimited-toggle').approval = 'explicit-production-read';
  assert.throws(() => validateDatabaseControl(root, downgradedOperation), /write task requires/);

  const missingReadConfirmation = structuredClone(loadDatabaseCatalog());
  missingReadConfirmation.operationalEntrypoints.find(({ id }) => id === 'metrics-digest').confirmation = 'none';
  assert.throws(() => validateDatabaseControl(root, missingReadConfirmation), /target-specific confirmation/);
});

test('local database execution requires explicit disposable target selection', () => {
  assert.throws(() => parseLocalSelection([]), /--target must be supplied exactly once/);
  assert.throws(() => parseLocalSelection(['--target', 'local']), /--confirm must be supplied exactly once/);
  assert.throws(
    () => parseLocalSelection(['--target', 'local', '--target', 'production', '--confirm', 'disposable-local']),
    /--target must be supplied exactly once/,
  );
  assert.deepEqual(
    parseLocalSelection(['--target', 'local', '--confirm', 'disposable-local']),
    { target: 'local', confirmation: 'disposable-local' },
  );
});

test('unresolved baseline prevents a local parity claim before Docker is touched', () => {
  assert.throws(() => assertLocalBootstrapReady(loadDatabaseCatalog()), /Local Supabase parity is blocked/);
});

test('local child processes do not inherit cloud, Docker-host, or secret inputs', () => {
  const sanitized = localExecutionEnvironment({
    PATH: 'safe-path',
    SUPABASE_URL: 'https://production.example',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    DOCKER_HOST: 'tcp://remote.example:2375',
    DOCKER_CONTEXT: 'production-context',
    SOME_API_KEY: 'secret',
    DATABASE_URL: 'postgresql://production.example/db',
    PGHOST: 'production.example',
    NODE_OPTIONS: '--require=malicious.js',
  });
  assert.equal(sanitized.PATH, 'safe-path');
  assert.equal(sanitized.DO_NOT_TRACK, '1');
  assert.equal(sanitized.SUPABASE_URL, undefined);
  assert.equal(sanitized.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(sanitized.DOCKER_HOST, undefined);
  assert.equal(sanitized.DOCKER_CONTEXT, 'default');
  assert.equal(sanitized.SOME_API_KEY, undefined);
  assert.equal(sanitized.DATABASE_URL, undefined);
  assert.equal(sanitized.PGHOST, undefined);
  assert.equal(sanitized.NODE_OPTIONS, undefined);
});

test('generated migration cleanup requires an exact manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gravestory-generated-migrations-'));
  try {
    const name = '20000101000001_001_test.sql';
    const content = 'select 1;\n';
    writeFileSync(join(directory, name), content);
    writeFileSync(join(directory, '.generated-by-database-control'), `${JSON.stringify({
      schemaVersion: 1,
      files: [{ name, sha256: fingerprintSql(content) }],
    })}\n`);
    assert.doesNotThrow(() => verifyGeneratedMigrationDirectory(directory));
    writeFileSync(join(directory, 'manual.sql'), 'select 2;\n');
    assert.throws(() => verifyGeneratedMigrationDirectory(directory), /outside its manifest/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local database execution rejects remote Docker endpoints', () => {
  assert.equal(isLocalDockerEndpoint('npipe:////./pipe/docker_engine'), true);
  assert.equal(isLocalDockerEndpoint('unix:///var/run/docker.sock'), true);
  assert.equal(isLocalDockerEndpoint('tcp://127.0.0.1:2375'), true);
  assert.equal(isLocalDockerEndpoint('ssh://operator@production.example'), false);
  assert.equal(isLocalDockerEndpoint('npipe:////remote/pipe/docker_engine'), false);
  assert.equal(isLocalDockerEndpoint('tcp://production.example:2375'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

import {
  buildDeployConfigAttestation,
  calculateDeployConfigIdentity,
  canonicalJson,
  resolveMobileDeployConfig,
  resolvePagesDeployConfig,
  resolveWorkerDeployConfig,
  validateDeployConfigRepository,
  verifyDeployConfigAttestation,
} from '../deploy-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_PATHS = [
  'deploy/config',
  'deploy/config/pages-target.json',
  'js/config.js',
  'js/auth.js',
  'index.html',
  'sw.js',
  'mobile/app.config.js',
  'worker/config.js',
  'worker/wrangler.toml',
  'worker/worker.js',
  'tools/supabase-target-policy.mjs',
  'tools/metrics-digest/target.mjs',
  'database/catalog.json',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gravestory-deploy-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of FIXTURE_PATHS) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(ROOT, relative), target, { recursive: true });
  }
  return root;
}

function json(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function writeJson(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSealed(root, path, value) {
  const record = { ...value, contentHash: sha256(canonicalJson(value)) };
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, canonicalJson(record));
  return sha256(readFileSync(target));
}

function resealAll(root) {
  for (const component of ['pages', 'mobile', 'worker', 'database']) {
    writeFileSync(join(root, `deploy/config/${component}.json`), canonicalJson(buildDeployConfigAttestation(root, component)));
  }
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

test('the repository deploy-config contract and all release attestations validate', () => {
  const result = validateDeployConfigRepository(ROOT);
  assert.deepEqual(Object.keys(result), ['pages', 'mobile', 'worker', 'database']);
  assert.ok(Object.values(result).every((item) => item.validation === 'passed' && item.remotePresence === 'unverified'));
});

test('canonical JSON and configuration identity are deterministic', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(calculateDeployConfigIdentity(ROOT, 'pages'), calculateDeployConfigIdentity(ROOT, 'pages'));
});

test('configuration identities are stable across LF and CRLF checkouts', (t) => {
  const root = fixture(t);
  const before = calculateDeployConfigIdentity(root, 'pages');
  for (const relative of ['js/config.js', 'js/auth.js', 'index.html', 'sw.js', 'deploy/config/contract.json', 'deploy/config/compatibility.json', 'deploy/config/pages-target.json']) {
    const path = join(root, relative);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  assert.equal(calculateDeployConfigIdentity(root, 'pages'), before);
  const authPath = join(root, 'js/auth.js');
  writeFileSync(authPath, `\uFEFF${readFileSync(authPath, 'utf8')}`);
  assert.notEqual(calculateDeployConfigIdentity(root, 'pages'), before);
  writeFileSync(authPath, 'const marker = "text";\0\r\n');
  assert.throws(() => calculateDeployConfigIdentity(root, 'pages'), /must be UTF-8 text without NUL bytes/);
  writeFileSync(authPath, Buffer.from([0x61, 0x80, 0x62]));
  assert.throws(() => calculateDeployConfigIdentity(root, 'pages'), /must be valid UTF-8 text for deploy identity hashing/);
});

test('full repository validation permits one client locator boundary to move independently', (t) => {
  const root = fixture(t);
  const oldOrigin = resolvePagesDeployConfig(root).workerOrigin;
  const nextOrigin = 'https://preview-worker.example.test';
  const sourcePath = join(root, 'js/config.js');
  writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').split(oldOrigin).join(nextOrigin));
  const compatibility = json(root, 'deploy/config/compatibility.json');
  compatibility.generations.find((item) => item.id === compatibility.currentGenerations.pages).locators.workerOrigin = nextOrigin;
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  resealAll(root);
  assert.equal(resolvePagesDeployConfig(root).workerOrigin, nextOrigin);
  assert.doesNotThrow(() => validateDeployConfigRepository(root));
});

test('Expo uses its attested default boundary and validates optional supplied build identifiers', async () => {
  const module = await import(`${pathToFileURL(join(ROOT, 'mobile/app.config.js')).href}?deploy-config-test`);
  const substituted = module.resolveMobileDeployConfig({ workerOrigin: 'https://preview-worker.example.test' });
  assert.equal(substituted.workerOrigin, 'https://preview-worker.example.test');
  assert.equal(substituted.supabaseOrigin, resolveMobileDeployConfig(ROOT).supabaseOrigin);
  assert.throws(() => module.resolveMobileDeployConfig({ workerOrigin: 'http://not-secure.test' }), /exact HTTPS origin/);
  assert.throws(() => module.resolveMobileDeployConfig({ unknown: 'value' }), /Unknown mobile public configuration/);
  assert.deepEqual(module.resolveMobileBuildInputs({ }).enabledFeatures, []);
  assert.deepEqual(module.resolveMobileBuildInputs({ REVENUECAT_API_KEY: 'existing-eas-public-key' }).enabledFeatures, ['revenuecat']);
  assert.throws(() => module.resolveMobileBuildInputs({ GRAVESTORY_ENABLE_REVENUECAT: 'false', REVENUECAT_API_KEY: 'real-looking-key' }), /requires GRAVESTORY_ENABLE_REVENUECAT=true/);
  assert.throws(() => module.resolveMobileBuildInputs({ GRAVESTORY_ENABLE_REVENUECAT: 'true' }), /non-placeholder public value/);
  assert.throws(() => module.resolveMobileBuildInputs({ REVENUECAT_API_KEY: 'placeholder' }), /non-placeholder public value/);
  assert.throws(() => module.resolveMobileBuildInputs({ GRAVESTORY_ENABLE_GOOGLE_MAPS: 'true', GOOGLE_MAPS_ANDROID_API_KEY: '<insert-key>' }), /non-placeholder public value/);
  assert.deepEqual(module.resolveMobileBuildInputs({ GRAVESTORY_ENABLE_REVENUECAT: 'true', REVENUECAT_API_KEY: 'real-public-sdk-key' }).enabledFeatures, ['revenuecat']);
});

test('cached web overlap can initialize Supabase when the preceding config script lacks the new object', () => {
  const calls = [];
  const context = vm.createContext({ window: { supabase: { createClient: (...args) => { calls.push(args); return {}; } } } });
  vm.runInContext(readFileSync(join(ROOT, 'js/auth.js'), 'utf8'), context, { filename: 'js/auth.js' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://idbrjonofqrsykqsqpwo.supabase.co');
});

test('Worker service, binding, bucket, handles, and runtime inventory are evaluated', (t) => {
  const root = fixture(t);
  const before = resolveWorkerDeployConfig(root);
  assert.equal(before.imagesBinding, 'IMAGES');
  assert.equal(before.imagesBucket, 'gravestory-images');
  const path = join(root, 'worker/wrangler.toml');
  writeFileSync(path, readFileSync(path, 'utf8').replace('binding = "IMAGES"', 'binding = "RENAMED"'));
  assert.throws(() => buildDeployConfigAttestation(root, 'worker'), /must declare exactly one IMAGES binding/);
  cpSync(join(ROOT, 'worker/wrangler.toml'), path);
  const contract = json(root, 'deploy/config/contract.json');
  contract.components.worker.resources = contract.components.worker.resources.filter((item) => item.name !== 'CLIENT_KEY');
  writeJson(root, 'deploy/config/contract.json', contract);
  assert.throws(() => buildDeployConfigAttestation(root, 'worker'), /must enumerate the same names/);
});

test('Worker runtime coverage, feature mappings, entrypoint type, and TOML scopes fail closed', (t) => {
  const requiredRoot = fixture(t);
  const requiredPath = join(requiredRoot, 'worker/config.js');
  writeFileSync(requiredPath, readFileSync(requiredPath, 'utf8').replace("  'SCAN_TOKEN_SECRET',\n", ''));
  assert.throws(() => buildDeployConfigAttestation(requiredRoot, 'worker'), /must exactly enumerate every required runtime input/);

  const featureRoot = fixture(t);
  const featurePath = join(featureRoot, 'worker/config.js');
  writeFileSync(featurePath, readFileSync(featurePath, 'utf8').replace(/\s+gemini: \['GEMINI_KEY'\],/, ''));
  assert.throws(() => buildDeployConfigAttestation(featureRoot, 'worker'), /must exactly map every feature-gated runtime input/);

  const mainRoot = fixture(t);
  const mainPath = join(mainRoot, 'worker/wrangler.toml');
  writeFileSync(mainPath, readFileSync(mainPath, 'utf8').replace('main = "worker.js"', 'main = "."'));
  assert.throws(() => buildDeployConfigAttestation(mainRoot, 'worker'), /must reference a repository file/);

  const scopeRoot = fixture(t);
  const scopePath = join(scopeRoot, 'worker/wrangler.toml');
  writeFileSync(scopePath, readFileSync(scopePath, 'utf8').replace('WORKER_ENV = "production"', 'WORKER_ENV_REMOVED = "production"') + '\n[env.preview.vars]\nWORKER_ENV = "production"\n');
  assert.throws(() => buildDeployConfigAttestation(scopeRoot, 'worker'), /WORKER_ENV: is missing from the required wrangler.toml scope/);
});

test('mobile update URL and EAS project identity enforce their declared rules', (t) => {
  const urlRoot = fixture(t);
  const appPath = join(urlRoot, 'mobile/app.config.js');
  writeFileSync(appPath, readFileSync(appPath, 'utf8').replace('https://u.expo.dev/f26f7a8b-2c63-4a68-bb44-903d7ed01b30', 'not-a-url'));
  assert.throws(() => buildDeployConfigAttestation(urlRoot, 'mobile'), /must be an exact HTTPS URL/);
  const idRoot = fixture(t);
  const idPath = join(idRoot, 'mobile/app.config.js');
  writeFileSync(idPath, readFileSync(idPath, 'utf8').replace("projectId: 'f26f7a8b-2c63-4a68-bb44-903d7ed01b30'", "projectId: 'not-a-uuid'"));
  assert.throws(() => buildDeployConfigAttestation(idRoot, 'mobile'), /must be a UUID/);
});

test('Pages project, cache generation, and mobile version are machine-bound', (t) => {
  const projectRoot = fixture(t);
  writeJson(projectRoot, 'deploy/config/pages-target.json', { projectName: 'placeholder' });
  assert.throws(() => buildDeployConfigAttestation(projectRoot, 'pages'), /pages\.projectName/);

  const cacheRoot = fixture(t);
  const cachePath = join(cacheRoot, 'sw.js');
  writeFileSync(cachePath, readFileSync(cachePath, 'utf8').replace('gravestory-v72-f36d9e62c920', 'gravestory-v73-next'));
  assert.throws(() => buildDeployConfigAttestation(cacheRoot, 'pages'), /pages\.serviceWorkerCacheId/);

  const versionRoot = fixture(t);
  const appPath = join(versionRoot, 'mobile/app.config.js');
  writeFileSync(appPath, readFileSync(appPath, 'utf8').replace('versionCode: 16', 'versionCode: 17'));
  assert.throws(() => buildDeployConfigAttestation(versionRoot, 'mobile'), /mobile\.versionCode/);
});

test('missing, broad placeholder, or permissive supplied inputs fail without echoing values', async (t) => {
  const root = fixture(t);
  const sourcePath = join(root, 'js/config.js');
  writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace('https://gravestory-proxy.james-gravestory.workers.dev', 'https://example.invalid'));
  assert.throws(() => resolvePagesDeployConfig(root), (error) => {
    assert.match(error.message, /pages\.workerOrigin: must not be a placeholder/);
    assert.doesNotMatch(error.message, /https:\/\/example\.invalid/);
    return true;
  });
  const module = await import(`${pathToFileURL(join(ROOT, 'mobile/app.config.js')).href}?deploy-config-placeholder-test`);
  assert.throws(() => module.resolveMobileDeployConfig({ clientKey: 'TODO' }), /non-placeholder public value/);
});

test('supported browser origins and current Pages origin are compatibility-bound', (t) => {
  const root = fixture(t);
  const compatibility = json(root, 'deploy/config/compatibility.json');
  const pages = compatibility.generations.find((item) => item.id === compatibility.currentGenerations.pages);
  pages.browserOrigins.push('https://retained.example.test');
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(root, 'worker'), /must exactly retain every supported browser generation origin/);
  pages.locators.siteOrigin = 'https://retained.example.test';
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(root, 'pages'), /pages\.siteOrigin/);
});

test('database target policy retains every supported generation Supabase origin', (t) => {
  const root = fixture(t);
  const compatibility = json(root, 'deploy/config/compatibility.json');
  compatibility.generations.find((item) => item.id === 'mobile-android-v15-production-a405b5dc').locators.supabaseOrigin = 'https://retained-project.supabase.co';
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(root, 'pages'), /must retain every supported generation Supabase origin/);
});

test('installed generation retirement requires sealed evidence and a sealed owner approval', (t) => {
  const root = fixture(t);
  const compatibility = json(root, 'deploy/config/compatibility.json');
  const generationId = 'mobile-android-v15-production-a405b5dc';
  compatibility.retirements.push({ generationId, evidenceKind: 'adoption-telemetry', evidencePath: 'deploy/config/retirement-evidence/missing.json', evidenceSha256: 'f'.repeat(64), ownerApprovalPath: 'deploy/config/owner-approvals/missing.json', ownerApprovalSha256: 'e'.repeat(64), retiredAt: '2026-07-15T12:02:00.000Z' });
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(root, 'mobile'), /references a missing file/);
  const evidencePath = 'deploy/config/retirement-evidence/mobile-v15.json';
  const approvalPath = 'deploy/config/owner-approvals/mobile-v15.json';
  const evidenceSha256 = writeSealed(root, evidencePath, { schemaVersion: 1, kind: 'installed-client-retirement-evidence', generationId, evidenceKind: 'adoption-telemetry', observedAt: '2026-07-15T12:00:00.000Z', summary: 'Installed generation adoption is below the approved retirement threshold.' });
  const approvalSha256 = writeSealed(root, approvalPath, { schemaVersion: 1, kind: 'deploy-config-owner-approval', scope: 'retire-installed-generation', subject: generationId, approvedAt: '2026-07-15T12:01:00.000Z', approvalRef: 'owner-record-2026-07-15-mobile-v15' });
  Object.assign(compatibility.retirements[0], { evidencePath, evidenceSha256, ownerApprovalPath: approvalPath, ownerApprovalSha256: approvalSha256 });
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.deepEqual(buildDeployConfigAttestation(root, 'mobile').compatibilityGenerationIds, ['mobile-android-v16-source']);
});

test('retirement timestamps must be real and observation must precede approval', (t) => {
  const impossibleRoot = fixture(t);
  const impossible = json(impossibleRoot, 'deploy/config/compatibility.json');
  impossible.retirements.push({ generationId: 'mobile-android-v15-production-a405b5dc', evidenceKind: 'adoption-telemetry', evidencePath: 'deploy/config/retirement-evidence/missing.json', evidenceSha256: 'f'.repeat(64), ownerApprovalPath: 'deploy/config/owner-approvals/missing.json', ownerApprovalSha256: 'e'.repeat(64), retiredAt: '2026-02-30T12:02:00.000Z' });
  writeJson(impossibleRoot, 'deploy/config/compatibility.json', impossible);
  assert.throws(() => buildDeployConfigAttestation(impossibleRoot, 'mobile'), /must be a real canonical UTC timestamp/);

  const chronologyRoot = fixture(t);
  const compatibility = json(chronologyRoot, 'deploy/config/compatibility.json');
  const generationId = 'mobile-android-v15-production-a405b5dc';
  const evidencePath = 'deploy/config/retirement-evidence/mobile-v15.json';
  const approvalPath = 'deploy/config/owner-approvals/mobile-v15.json';
  const evidenceSha256 = writeSealed(chronologyRoot, evidencePath, { schemaVersion: 1, kind: 'installed-client-retirement-evidence', generationId, evidenceKind: 'adoption-telemetry', observedAt: '2026-07-15T12:00:00.000Z', summary: 'Installed generation adoption is below the approved retirement threshold.' });
  const ownerApprovalSha256 = writeSealed(chronologyRoot, approvalPath, { schemaVersion: 1, kind: 'deploy-config-owner-approval', scope: 'retire-installed-generation', subject: generationId, approvedAt: '2026-07-15T11:59:00.000Z', approvalRef: 'owner-record-chronology-test' });
  compatibility.retirements.push({ generationId, evidenceKind: 'adoption-telemetry', evidencePath, evidenceSha256, ownerApprovalPath: approvalPath, ownerApprovalSha256, retiredAt: '2026-07-15T12:02:00.000Z' });
  writeJson(chronologyRoot, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(chronologyRoot, 'mobile'), /approval must follow the retirement evidence/);
});

test('generation and retirement history are append-only after their first commit', (t) => {
  const root = fixture(t);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  const compatibility = json(root, 'deploy/config/compatibility.json');
  compatibility.generations.find((item) => item.id === 'pages-cache-v70-source').locators.workerOrigin = 'https://rewritten-worker.example.test';
  writeJson(root, 'deploy/config/compatibility.json', compatibility);
  assert.throws(() => buildDeployConfigAttestation(root, 'pages'), /generation pages-cache-v70-source was deleted or rewritten/);
});

test('compatibility history fails closed when a Git boundary exists but history is unavailable', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, '.git'));
  assert.throws(() => buildDeployConfigAttestation(root, 'pages'), /Git history is unavailable/);
});

test('remote presence rejects incomplete fields and accepts only sealed approved evidence', (t) => {
  const root = fixture(t);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  const component = 'database';
  const attestationPath = `deploy/config/${component}.json`;
  const attestation = buildDeployConfigAttestation(root, component);
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const approvalPath = 'deploy/config/owner-approvals/database-observation.json';
  const approvalSha256 = writeSealed(root, approvalPath, { schemaVersion: 1, kind: 'deploy-config-owner-approval', scope: 'observe-remote-presence', subject: `${component}:${attestation.identity}`, approvedAt: '2026-07-15T11:59:00.000Z', approvalRef: 'owner-record-2026-07-15-database-read' });
  const evidencePath = 'deploy/config/remote/database.json';
  const evidenceBase = { schemaVersion: 1, kind: 'deploy-config-remote-presence', component, configurationIdentity: attestation.identity, sourceCommit, observedAt: '2026-07-15T12:00:00.000Z', enabledFeatures: [], fieldsPresent: [], approvalPath, approvalSha256 };
  let evidenceSha256 = writeSealed(root, evidencePath, evidenceBase);
  Object.assign(attestation, { remotePresence: 'attested', remoteEvidence: evidencePath, remoteEvidenceSha256: evidenceSha256 });
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.throws(() => verifyDeployConfigAttestation(root, component, attestationPath), /must exactly enumerate required fields and enabled feature fields/);
  const contract = json(root, 'deploy/config/contract.json');
  evidenceBase.fieldsPresent = contract.components.database.resources.filter((item) => !['optional', 'optional-local', 'required-for-local'].includes(item.requirement)).map((item) => item.name).sort();
  evidenceSha256 = writeSealed(root, evidencePath, evidenceBase);
  attestation.remoteEvidenceSha256 = evidenceSha256;
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.equal(verifyDeployConfigAttestation(root, component, attestationPath).remotePresence, 'attested');
  const stale = json(root, evidencePath);
  stale.configurationIdentity = 'f'.repeat(64);
  evidenceSha256 = writeSealed(root, evidencePath, Object.fromEntries(Object.entries(stale).filter(([key]) => key !== 'contentHash')));
  attestation.remoteEvidenceSha256 = evidenceSha256;
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.throws(() => verifyDeployConfigAttestation(root, component, attestationPath), /does not bind the component and configuration identity/);
  stale.configurationIdentity = attestation.identity;
  stale.sourceCommit = 'f'.repeat(40);
  evidenceSha256 = writeSealed(root, evidencePath, Object.fromEntries(Object.entries(stale).filter(([key]) => key !== 'contentHash')));
  attestation.remoteEvidenceSha256 = evidenceSha256;
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.throws(() => verifyDeployConfigAttestation(root, component, attestationPath), /must reference a commit containing the reviewed component attestation/);
});

test('remote evidence requires feature fields only for explicitly enabled conditions', (t) => {
  const root = fixture(t);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  const component = 'mobile';
  const attestationPath = `deploy/config/${component}.json`;
  const attestation = buildDeployConfigAttestation(root, component);
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const approvalPath = 'deploy/config/owner-approvals/mobile-observation.json';
  const approvalSha256 = writeSealed(root, approvalPath, { schemaVersion: 1, kind: 'deploy-config-owner-approval', scope: 'observe-remote-presence', subject: `${component}:${attestation.identity}`, approvedAt: '2026-07-15T11:59:00.000Z', approvalRef: 'owner-record-mobile-conditional-test' });
  const evidencePath = 'deploy/config/remote/mobile.json';
  const contract = json(root, 'deploy/config/contract.json').components.mobile.resources;
  const requiredFields = contract.filter((item) => !['optional', 'feature-gated'].includes(item.requirement)).map((item) => item.name).sort();
  const evidence = { schemaVersion: 1, kind: 'deploy-config-remote-presence', component, configurationIdentity: attestation.identity, sourceCommit, observedAt: '2026-07-15T12:00:00.000Z', enabledFeatures: [], fieldsPresent: requiredFields, approvalPath, approvalSha256 };
  let remoteEvidenceSha256 = writeSealed(root, evidencePath, evidence);
  Object.assign(attestation, { remotePresence: 'attested', remoteEvidence: evidencePath, remoteEvidenceSha256 });
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.equal(verifyDeployConfigAttestation(root, component, attestationPath).remotePresence, 'attested');

  evidence.enabledFeatures = ['revenuecat'];
  remoteEvidenceSha256 = writeSealed(root, evidencePath, evidence);
  attestation.remoteEvidenceSha256 = remoteEvidenceSha256;
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.throws(() => verifyDeployConfigAttestation(root, component, attestationPath), /enabled feature fields/);

  evidence.fieldsPresent = [...requiredFields, 'REVENUECAT_API_KEY'].sort();
  remoteEvidenceSha256 = writeSealed(root, evidencePath, evidence);
  attestation.remoteEvidenceSha256 = remoteEvidenceSha256;
  writeFileSync(join(root, attestationPath), canonicalJson(attestation));
  assert.equal(verifyDeployConfigAttestation(root, component, attestationPath).remotePresence, 'attested');
});

test('attestations fail on stale identity, incomplete compatibility coverage, and path substitution', (t) => {
  const root = fixture(t);
  const attestationPath = 'deploy/config/pages.json';
  const attestation = json(root, attestationPath);
  attestation.identity = 'f'.repeat(64);
  writeJson(root, attestationPath, attestation);
  assert.throws(() => verifyDeployConfigAttestation(root, 'pages', attestationPath), /identity/);
  writeFileSync(join(root, attestationPath), canonicalJson(buildDeployConfigAttestation(root, 'pages')));
  const missing = json(root, attestationPath);
  missing.compatibilityGenerationIds = [];
  writeJson(root, attestationPath, missing);
  assert.throws(() => verifyDeployConfigAttestation(root, 'pages', attestationPath), /compatibilityGenerationIds/);
  assert.throws(() => verifyDeployConfigAttestation(root, 'pages', 'deploy/config/mobile.json'), /must be deploy\/config\/pages\.json/);
});

test('unverified remote presence cannot smuggle evidence', (t) => {
  const root = fixture(t);
  const path = 'deploy/config/database.json';
  const attestation = buildDeployConfigAttestation(root, 'database');
  attestation.remoteEvidence = 'deploy/config/remote/database.json';
  writeJson(root, path, attestation);
  assert.throws(() => verifyDeployConfigAttestation(root, 'database', path), /must be absent/);
});

test('metrics target semantics are part of repository deploy-config validation', (t) => {
  const root = fixture(t);
  const path = join(root, 'tools/metrics-digest/target.mjs');
  writeFileSync(path, readFileSync(path, 'utf8').replace("production: 'production-read'", "production: 'unsafe-default'"));
  assert.throws(() => buildDeployConfigAttestation(root, 'database'), /must retain explicit target-specific inputs, confirmations, and fail-closed behavior/);

  const controlRoot = fixture(t);
  const controlPath = join(controlRoot, 'tools/metrics-digest/target.mjs');
  writeFileSync(controlPath, readFileSync(controlPath, 'utf8').replace('if (confirmation !== DIGEST_CONFIRMATIONS[target]) {', 'if (false && confirmation !== DIGEST_CONFIRMATIONS[target]) {'));
  assert.throws(() => buildDeployConfigAttestation(controlRoot, 'database'), /fail-closed behavior/);

  const placeholderRoot = fixture(t);
  const expression = `import('./tools/metrics-digest/target.mjs').then(m=>m.resolveDigestTarget(['--target','production','--confirm','production-read'],{SUPABASE_PRODUCTION_URL:'https://idbrjonofqrsykqsqpwo.supabase.co',SUPABASE_PRODUCTION_SERVICE_ROLE_KEY:'TODO'}))`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', expression], { cwd: placeholderRoot, encoding: 'utf8', shell: false });
  assert.notEqual(result.status, 0);
});

test('database control remains fail closed at the missing pre-001 baseline', (t) => {
  const root = fixture(t);
  const catalog = json(root, 'database/catalog.json');
  catalog.bootstrap.status = 'ready';
  writeJson(root, 'database/catalog.json', catalog);
  assert.throws(() => buildDeployConfigAttestation(root, 'database'), /preserve the fail-closed unresolved pre-001 boundary/);
});

test('component source changes invalidate authoritative identities', (t) => {
  const root = fixture(t);
  const before = buildDeployConfigAttestation(root, 'pages');
  const sourcePath = join(root, 'js/auth.js');
  writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n// compatibility source change\n`);
  const after = buildDeployConfigAttestation(root, 'pages');
  assert.notEqual(after.identity, before.identity);
  assert.throws(() => verifyDeployConfigAttestation(root, 'pages', 'deploy/config/pages.json'), /identity/);
});

test('duplicate CLI options fail instead of silently taking the last value', () => {
  const project = spawnSync(process.execPath, ['tools/deploy-config.mjs', 'pages-project-name'], { cwd: ROOT, encoding: 'utf8', shell: false });
  assert.equal(project.status, 0);
  assert.equal(project.stdout, 'gravestory');
  const result = spawnSync(process.execPath, ['tools/deploy-config.mjs', 'verify-attestation', '--component', 'pages', '--component', 'mobile', '--path', 'deploy/config/pages.json'], { cwd: ROOT, encoding: 'utf8', shell: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /may be supplied only once/);
});

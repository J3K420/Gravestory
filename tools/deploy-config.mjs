#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_COMPONENTS = Object.freeze(['pages', 'mobile', 'worker', 'database']);
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RETIREMENT_EVIDENCE = Object.freeze(['adoption-telemetry', 'enforced-version', 'installed-client-verification']);
const ATTESTATION_KEYS = Object.freeze(['schemaVersion', 'kind', 'component', 'identity', 'validation', 'remotePresence', 'compatibilityGenerationIds', 'remoteEvidence', 'remoteEvidenceSha256']);
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function fail(key, rule) {
  throw new Error(`${key}: ${rule}`);
}

function readText(path, key = path) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(key, 'required file is missing');
  try { return FATAL_UTF8.decode(readFileSync(path)); } catch { fail(key, 'must be valid UTF-8 text'); }
}

function readJson(path, key = path) {
  const text = readText(path, key);
  try { return JSON.parse(text); } catch (error) { fail(key, `invalid JSON (${error.message})`); }
}

function assertObject(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(key, 'must be an object');
}

function assertAllowedKeys(value, allowed, key) {
  assertObject(value, key);
  const extra = Object.keys(value).filter((name) => !allowed.includes(name));
  if (extra.length) fail(key, `contains unsupported fields: ${extra.join(', ')}`);
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalized(value))}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileHash(path) {
  return sha256(readFileSync(path));
}

function portableSourceHash(path, key) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)); } catch { fail(key, 'must be valid UTF-8 text for deploy identity hashing'); }
  if (text.includes('\0')) fail(key, 'must be UTF-8 text without NUL bytes for deploy identity hashing');
  return sha256(text.replace(/\r\n?/g, '\n'));
}

function exactHttpsOrigin(value, key) {
  value = requiredValue(value, key);
  let url;
  try { url = new URL(value); } catch { fail(key, 'must be an exact HTTPS origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) fail(key, 'must be an exact HTTPS origin');
  return value;
}

function exactHttpsUrl(value, key) {
  value = requiredValue(value, key);
  let url;
  try { url = new URL(value); } catch { fail(key, 'must be an exact HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) fail(key, 'must be an exact HTTPS URL');
  return value;
}

function canonicalPastTimestamp(value, key) {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) fail(key, 'must be a canonical UTC timestamp');
  if (new Date(Date.parse(value)).toISOString() !== value) fail(key, 'must be a real canonical UTC timestamp');
  if (Date.parse(value) > Date.now()) fail(key, 'must not be in the future');
  return value;
}

function nonEmptyValue(value, key) {
  if (typeof value !== 'string' || !value.trim()) fail(key, 'must be a non-empty string');
  return value.trim();
}

function requiredValue(value, key) {
  const trimmed = nonEmptyValue(value, key);
  if (/(?:^|[-_<])(?:paste|placeholder|replace|change|changeme|your|todo|tbd|insert)(?:$|[-_>:])/i.test(trimmed) || /example\.(?:com|invalid)/i.test(trimmed)) fail(key, 'must not be a placeholder');
  return trimmed;
}

function safeRepositoryPath(root, input, key) {
  if (typeof input !== 'string' || !input || isAbsolute(input)) fail(key, 'must be a repository-relative path');
  const absolute = resolve(root, input);
  const fromRoot = relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) fail(key, 'escapes the repository');
  if (!existsSync(absolute)) fail(key, 'references a missing file');
  const realRoot = realpathSync(root);
  const real = realpathSync(absolute);
  const realRelative = relative(realRoot, real);
  if (realRelative === '..' || realRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(realRelative)) fail(key, 'resolves outside the repository');
  return absolute;
}

function childModule(root, path, expression, key) {
  const url = pathToFileURL(join(root, path)).href;
  const script = `const m=await import(process.argv[1]); process.stdout.write(JSON.stringify(${expression}));`;
  const env = Object.fromEntries(['SystemRoot', 'PATH', 'TEMP', 'TMP', 'HOME'].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, url], {
    cwd: root, encoding: 'utf8', shell: false, timeout: 30_000, env,
  });
  if (result.status !== 0) fail(key, `could not evaluate (${(result.stderr || result.stdout).trim()})`);
  try { return JSON.parse(result.stdout); } catch { fail(key, 'returned invalid evaluation output'); }
}

export function resolvePagesDeployConfig(root = DEFAULT_ROOT) {
  const source = readText(join(root, 'js', 'config.js'), 'pages.boundary');
  const context = vm.createContext({});
  try { vm.runInContext(source, context, { filename: 'js/config.js', timeout: 1_000 }); } catch (error) { fail('pages.boundary', `could not evaluate (${error.message})`); }
  const value = context.GRAVESTORY_DEPLOY_CONFIG;
  assertAllowedKeys(value, ['workerOrigin', 'supabaseOrigin', 'supabaseAnonKey', 'clientKey'], 'pages.boundary');
  const canonical = readText(join(root, 'index.html'), 'pages.site-origin').match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  let siteOrigin;
  try { siteOrigin = new URL(canonical).origin; } catch { fail('pages.site-origin', 'canonical URL is missing or invalid'); }
  const target = readJson(join(root, 'deploy', 'config', 'pages-target.json'), 'pages.target');
  assertAllowedKeys(target, ['projectName'], 'pages.target');
  const cacheSource = readText(join(root, 'sw.js'), 'pages.service-worker-cache');
  const serviceWorkerCacheId = cacheSource.match(/^const CACHE\s*=\s*'([^']+)'/m)?.[1];
  const projectName = requiredValue(target.projectName, 'pages.projectName');
  return {
    projectName: SAFE_ID.test(projectName) ? projectName : fail('pages.projectName', 'must be a platform project handle'),
    siteOrigin: exactHttpsOrigin(siteOrigin, 'pages.site-origin'),
    workerOrigin: exactHttpsOrigin(value.workerOrigin, 'pages.workerOrigin'),
    supabaseOrigin: exactHttpsOrigin(value.supabaseOrigin, 'pages.supabaseOrigin'),
    supabaseAnonKey: requiredValue(value.supabaseAnonKey, 'pages.supabaseAnonKey'),
    clientKey: requiredValue(value.clientKey, 'pages.clientKey'),
    serviceWorkerCacheId: requiredValue(serviceWorkerCacheId, 'pages.service-worker-cache'),
  };
}

export function resolveMobileDeployConfig(root = DEFAULT_ROOT) {
  const value = childModule(root, 'mobile/app.config.js', "(()=>{const c=m.default?.expo??m.default; return {public:m.resolveMobileDeployConfig(),buildInputs:m.resolveMobileBuildInputs({}),updatesUrl:c?.updates?.url,projectId:c?.extra?.eas?.projectId,versionCode:c?.android?.versionCode}})()", 'mobile.boundary');
  assertAllowedKeys(value.public, ['workerOrigin', 'supabaseOrigin', 'supabaseAnonKey', 'clientKey'], 'mobile.boundary.public');
  assertAllowedKeys(value.buildInputs, ['enabledFeatures', 'googleMapsApiKey', 'revenueCatApiKey'], 'mobile.boundary.buildInputs');
  if (canonicalJson(value.buildInputs.enabledFeatures) !== canonicalJson([]) || value.buildInputs.googleMapsApiKey !== '' || value.buildInputs.revenueCatApiKey !== '') fail('mobile.boundary.buildInputs', 'empty repository verification must not inherit remote public identifiers or feature state');
  return {
    workerOrigin: exactHttpsOrigin(value.public.workerOrigin, 'mobile.workerOrigin'),
    supabaseOrigin: exactHttpsOrigin(value.public.supabaseOrigin, 'mobile.supabaseOrigin'),
    supabaseAnonKey: requiredValue(value.public.supabaseAnonKey, 'mobile.supabaseAnonKey'),
    clientKey: requiredValue(value.public.clientKey, 'mobile.clientKey'),
    updatesUrl: exactHttpsUrl(value.updatesUrl, 'mobile.updatesUrl'),
    projectId: UUID.test(value.projectId ?? '') ? value.projectId : fail('mobile.projectId', 'must be a UUID'),
    versionCode: Number.isSafeInteger(value.versionCode) && value.versionCode > 0 ? value.versionCode : fail('mobile.versionCode', 'must be a positive integer'),
    googleMapsSdkKeyIdentity: 'remote-unverified',
    revenueCatSdkKeyIdentity: 'remote-unverified',
  };
}

function parseWranglerToml(text) {
  const model = { root: {}, vars: {}, r2Buckets: [] };
  let current = model.root;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[vars]') { current = model.vars; continue; }
    if (line === '[[r2_buckets]]') { current = {}; model.r2Buckets.push(current); continue; }
    if (/^\[/.test(line)) { current = null; continue; }
    if (!current) continue;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (!match) continue;
    if (Object.hasOwn(current, match[1])) fail(`worker.${match[1]}`, 'is declared more than once in its TOML scope');
    current[match[1]] = match[2];
  }
  return model;
}

function scopedTomlString(scope, name) {
  if (!Object.hasOwn(scope, name)) fail(`worker.${name}`, 'is missing from the required wrangler.toml scope');
  return scope[name];
}

export function resolveWorkerDeployConfig(root = DEFAULT_ROOT) {
  const wrangler = readText(join(root, 'worker', 'wrangler.toml'), 'worker.boundary');
  const toml = parseWranglerToml(wrangler);
  const runtime = childModule(root, 'worker/config.js', '({contract:m.WORKER_CONFIG_CONTRACT,required:m.WORKER_REQUIRED_PRODUCTION,features:m.WORKER_FEATURE_REQUIREMENTS})', 'worker.contract');
  const { contract } = runtime;
  if (!Array.isArray(contract) || !contract.length) fail('worker.contract', 'must enumerate Worker inputs');
  const names = new Set();
  for (const item of contract) {
    assertAllowedKeys(item, ['name', 'kind', 'requirement', 'features', 'sensitive'], `worker.contract.${item?.name ?? 'unknown'}`);
    const name = requiredValue(item.name, 'worker.contract.name');
    if (names.has(name)) fail('worker.contract', `duplicates ${name}`);
    names.add(name);
    if (!['var', 'secret', 'binding'].includes(item.kind)) fail(`worker.contract.${name}`, 'has an invalid kind');
    if (!['required', 'feature-gated', 'optional'].includes(item.requirement)) fail(`worker.contract.${name}`, 'has an invalid requirement');
    if (!Array.isArray(item.features) || !item.features.length || item.features.some((feature) => !SAFE_ID.test(feature))) fail(`worker.contract.${name}`, 'must list valid feature identifiers');
    if (typeof item.sensitive !== 'boolean') fail(`worker.contract.${name}`, 'must classify sensitivity');
    if (item.sensitive === true && item.kind !== 'secret') fail(`worker.contract.${name}`, 'sensitive inputs must use secret injection');
  }
  const expectedRequired = contract.filter((item) => item.requirement === 'required').map((item) => item.name).sort();
  if (!Array.isArray(runtime.required) || canonicalJson([...runtime.required].sort()) !== canonicalJson(expectedRequired)) fail('worker.contract.required', 'must exactly enumerate every required runtime input');
  assertObject(runtime.features, 'worker.contract.features');
  const expectedFeatures = {};
  for (const item of contract.filter((entry) => entry.requirement === 'feature-gated')) {
    for (const feature of item.features) (expectedFeatures[feature] ??= []).push(item.name);
  }
  for (const values of Object.values(expectedFeatures)) values.sort();
  for (const [feature, required] of Object.entries(runtime.features)) {
    if (!SAFE_ID.test(feature) || !Array.isArray(required) || required.some((name) => !names.has(name))) fail(`worker.contract.features.${feature}`, 'references an input absent from the inventory');
  }
  if (canonicalJson(Object.fromEntries(Object.entries(runtime.features).map(([feature, values]) => [feature, [...values].sort()]))) !== canonicalJson(expectedFeatures)) fail('worker.contract.features', 'must exactly map every feature-gated runtime input');
  const allowedOrigins = scopedTomlString(toml.vars, 'ALLOWED_ORIGIN').split(',').map((part) => exactHttpsOrigin(part.trim(), 'worker.ALLOWED_ORIGIN'));
  if (new Set(allowedOrigins).size !== allowedOrigins.length) fail('worker.ALLOWED_ORIGIN', 'contains duplicates');
  const serviceName = requiredValue(scopedTomlString(toml.root, 'name'), 'worker.name');
  const accountId = requiredValue(scopedTomlString(toml.root, 'account_id'), 'worker.account_id');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) fail('worker.account_id', 'must be a Cloudflare account identifier');
  const entrypoint = requiredValue(scopedTomlString(toml.root, 'main'), 'worker.main');
  const entrypointPath = safeRepositoryPath(join(root, 'worker'), entrypoint, 'worker.main');
  if (!statSync(entrypointPath).isFile()) fail('worker.main', 'must reference a repository file');
  const imageBuckets = toml.r2Buckets.filter((item) => item.binding === 'IMAGES');
  if (imageBuckets.length !== 1) fail('worker.IMAGES.binding', 'must declare exactly one IMAGES binding');
  const binding = requiredValue(scopedTomlString(imageBuckets[0], 'binding'), 'worker.IMAGES.binding');
  if (binding !== 'IMAGES') fail('worker.IMAGES.binding', 'must declare the IMAGES binding');
  const imagesBucket = requiredValue(scopedTomlString(imageBuckets[0], 'bucket_name'), 'worker.IMAGES.bucket_name');
  return {
    serviceName,
    accountId,
    entrypoint,
    workerEnv: requiredValue(scopedTomlString(toml.vars, 'WORKER_ENV'), 'worker.WORKER_ENV'),
    allowedOrigins,
    supabaseOrigin: exactHttpsOrigin(scopedTomlString(toml.vars, 'SUPABASE_URL'), 'worker.SUPABASE_URL'),
    r2PublicOrigin: exactHttpsOrigin(scopedTomlString(toml.vars, 'R2_PUBLIC_URL'), 'worker.R2_PUBLIC_URL'),
    scanTokenEnforce: requiredValue(scopedTomlString(toml.vars, 'SCAN_TOKEN_ENFORCE'), 'worker.SCAN_TOKEN_ENFORCE'),
    imagesBinding: binding,
    imagesBucket,
    declarations: contract.map(({ name, kind, requirement, features, sensitive }) => ({ name, kind, requirement, features, sensitive })),
  };
}

function resolveDatabaseDeployConfig(root) {
  const origins = childModule(root, 'tools/supabase-target-policy.mjs', '[...m.APPROVED_PRODUCTION_ORIGINS].sort()', 'database.target-policy');
  if (!Array.isArray(origins) || !origins.length) fail('database.target-policy', 'must contain at least one approved production origin');
  origins.forEach((origin) => exactHttpsOrigin(origin, 'database.target-policy'));
  const catalog = readJson(join(root, 'database', 'catalog.json'), 'database.catalog');
  if (catalog.bootstrap?.status !== 'unresolved' || catalog.bootstrap?.productionInspectionRequired !== true) fail('database.bootstrap', 'must preserve the fail-closed unresolved pre-001 boundary');
  return { approvedProductionOrigins: origins, bootstrapStatus: catalog.bootstrap.status, productionInspectionRequired: true };
}

function resolveMetricsDeployConfig(root) {
  const expression = `(()=>{const probe=(args,env)=>{try{const value=m.resolveDigestTarget(args,env);return {ok:true,target:value.target,url:value.url}}catch{return {ok:false}}};const production={SUPABASE_PRODUCTION_URL:'https://idbrjonofqrsykqsqpwo.supabase.co',SUPABASE_PRODUCTION_SERVICE_ROLE_KEY:'test-production-key'};return {confirmations:m.DIGEST_CONFIRMATIONS,inputs:m.DIGEST_TARGET_INPUTS,behavior:{local:probe(['--target','local','--confirm','local-read'],{SUPABASE_LOCAL_SERVICE_ROLE_KEY:'test-local-key'}),production:probe(['--target','production','--confirm','production-read'],production),implicit:probe([],production),wrongConfirmation:probe(['--target','production','--confirm','local-read'],production),crossTarget:probe(['--target','production','--confirm','production-read'],{...production,SUPABASE_PRODUCTION_URL:'http://127.0.0.1:54321'}),placeholder:probe(['--target','production','--confirm','production-read'],{...production,SUPABASE_PRODUCTION_SERVICE_ROLE_KEY:'placeholder'})}}})()`;
  const value = childModule(root, 'tools/metrics-digest/target.mjs', expression, 'metrics-digest.boundary');
  const expectedConfirmations = { local: 'local-read', production: 'production-read' };
  const expectedInputs = {
    local: { url: 'SUPABASE_LOCAL_URL', key: 'SUPABASE_LOCAL_SERVICE_ROLE_KEY' },
    production: { url: 'SUPABASE_PRODUCTION_URL', key: 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY' },
  };
  const expectedBehavior = {
    local: { ok: true, target: 'local', url: 'http://127.0.0.1:54321' },
    production: { ok: true, target: 'production', url: 'https://idbrjonofqrsykqsqpwo.supabase.co' },
    implicit: { ok: false }, wrongConfirmation: { ok: false }, crossTarget: { ok: false }, placeholder: { ok: false },
  };
  if (canonicalJson(value.confirmations) !== canonicalJson(expectedConfirmations) || canonicalJson(value.inputs) !== canonicalJson(expectedInputs) || canonicalJson(value.behavior) !== canonicalJson(expectedBehavior)) fail('metrics-digest.boundary', 'must retain explicit target-specific inputs, confirmations, and fail-closed behavior');
  return value;
}

function validateContract(root, contract) {
  assertAllowedKeys(contract, ['schemaVersion', 'components'], 'contract');
  if (contract.schemaVersion !== 1) fail('contract.schemaVersion', 'must equal 1');
  assertObject(contract.components, 'contract.components');
  const expected = [...RELEASE_COMPONENTS, 'metrics-digest'];
  if (JSON.stringify(Object.keys(contract.components).sort()) !== JSON.stringify(expected.sort())) fail('contract.components', 'must enumerate pages, mobile, worker, database, and metrics-digest exactly');
  for (const [component, entry] of Object.entries(contract.components)) {
    assertAllowedKeys(entry, ['owner', 'boundary', 'compatibilitySources', 'resources'], `contract.${component}`);
    nonEmptyValue(entry.owner, `contract.${component}.owner`);
    nonEmptyValue(entry.boundary, `contract.${component}.boundary`);
    if ('compatibilitySources' in entry) {
      if (!Array.isArray(entry.compatibilitySources) || !entry.compatibilitySources.length) fail(`contract.${component}.compatibilitySources`, 'must be a non-empty array when supplied');
      entry.compatibilitySources.forEach((path) => safeRepositoryPath(root, path, `contract.${component}.compatibilitySources`));
    }
    if (!Array.isArray(entry.resources) || !entry.resources.length) fail(`contract.${component}.resources`, 'must not be empty');
    const ids = new Set();
    for (const resource of entry.resources) {
      assertAllowedKeys(resource, ['id', 'name', 'kind', 'requirement', 'condition', 'source', 'owner', 'sensitive', 'validation'], `contract.${component}.resource`);
      if (!SAFE_ID.test(resource.id ?? '') || ids.has(resource.id)) fail(`contract.${component}.resource.id`, 'must be unique and filename-safe');
      ids.add(resource.id);
      for (const key of ['name', 'kind', 'requirement', 'source', 'owner', 'validation']) nonEmptyValue(resource[key], `contract.${component}.${resource.id}.${key}`);
      if (!['public-locator', 'public-identifier', 'config-value', 'secret', 'binding'].includes(resource.kind)) fail(`contract.${component}.${resource.id}.kind`, 'is invalid');
      if (!['required', 'feature-gated', 'optional', 'required-for-production', 'optional-local', 'required-for-local', 'required-by-selected-target'].includes(resource.requirement)) fail(`contract.${component}.${resource.id}.requirement`, 'is invalid');
      if (resource.requirement === 'feature-gated') {
        if (!SAFE_ID.test(resource.condition ?? '')) fail(`contract.${component}.${resource.id}.condition`, 'must name the explicit enabling feature');
      } else if ('condition' in resource) {
        fail(`contract.${component}.${resource.id}.condition`, 'is allowed only for feature-gated resources');
      }
      if ((resource.kind === 'secret') !== (resource.sensitive === true)) fail(`contract.${component}.${resource.id}.sensitive`, 'must be true only for secrets');
      safeRepositoryPath(root, resource.source, `contract.${component}.${resource.id}.source`);
    }
  }
}

function validateSealedArtifact(root, input, expectedHash, prefix, expected, key) {
  if (typeof input !== 'string' || !input.startsWith(prefix)) fail(key, `must be under ${prefix}`);
  const path = safeRepositoryPath(root, input, key);
  if (!HASH.test(expectedHash ?? '') || fileHash(path) !== expectedHash) fail(`${key}.sha256`, 'does not match the versioned artifact');
  const record = readJson(path, key);
  const allowed = expected.kind === 'installed-client-retirement-evidence'
    ? ['schemaVersion', 'kind', 'generationId', 'evidenceKind', 'observedAt', 'summary', 'contentHash']
    : ['schemaVersion', 'kind', 'scope', 'subject', 'approvedAt', 'approvalRef', 'contentHash'];
  assertAllowedKeys(record, allowed, key);
  if (record.schemaVersion !== 1 || record.kind !== expected.kind) fail(key, 'has invalid binding fields');
  for (const [name, value] of Object.entries(expected)) if (name !== 'kind' && record[name] !== value) fail(`${key}.${name}`, 'does not match the retirement record');
  const timestamp = record.observedAt ?? record.approvedAt;
  canonicalPastTimestamp(timestamp, `${key}.timestamp`);
  if ('summary' in record) requiredValue(record.summary, `${key}.summary`);
  if ('approvalRef' in record) requiredValue(record.approvalRef, `${key}.approvalRef`);
  const content = Object.fromEntries(Object.entries(record).filter(([name]) => name !== 'contentHash'));
  if (!HASH.test(record.contentHash ?? '') || record.contentHash !== sha256(canonicalJson(content))) fail(`${key}.contentHash`, 'is invalid');
  return record;
}

function validateCompatibility(root, compatibility) {
  assertAllowedKeys(compatibility, ['schemaVersion', 'retirementPolicy', 'currentGenerations', 'generations', 'retirements'], 'compatibility');
  if (compatibility.schemaVersion !== 1) fail('compatibility.schemaVersion', 'must equal 1');
  assertAllowedKeys(compatibility.retirementPolicy, ['ownerApprovalRequired', 'allowedEvidence'], 'compatibility.retirementPolicy');
  if (compatibility.retirementPolicy.ownerApprovalRequired !== true) fail('compatibility.retirementPolicy', 'must require owner approval');
  if (canonicalJson(compatibility.retirementPolicy.allowedEvidence) !== canonicalJson(RETIREMENT_EVIDENCE)) fail('compatibility.retirementPolicy.allowedEvidence', 'must equal the approved evidence kinds');
  assertAllowedKeys(compatibility.currentGenerations, ['pages', 'mobile'], 'compatibility.currentGenerations');
  if (!Array.isArray(compatibility.generations) || !compatibility.generations.length) fail('compatibility.generations', 'must not be empty');
  const ids = new Set();
  for (const generation of compatibility.generations) {
    assertAllowedKeys(generation, ['id', 'component', 'browserOrigins', 'locators'], `compatibility.${generation?.id ?? 'unknown'}`);
    if (!SAFE_ID.test(generation.id ?? '') || ids.has(generation.id)) fail('compatibility.generation.id', 'must be unique and filename-safe');
    ids.add(generation.id);
    if (!['pages', 'mobile'].includes(generation.component)) fail(`compatibility.${generation.id}.component`, 'must be pages or mobile');
    if (!Array.isArray(generation.browserOrigins)) fail(`compatibility.${generation.id}.browserOrigins`, 'must be an array');
    generation.browserOrigins.forEach((origin) => exactHttpsOrigin(origin, `compatibility.${generation.id}.browserOrigins`));
    if (new Set(generation.browserOrigins).size !== generation.browserOrigins.length) fail(`compatibility.${generation.id}.browserOrigins`, 'must be unique');
    const locatorKeys = generation.component === 'pages'
      ? ['siteOrigin', 'workerOrigin', 'supabaseOrigin', 'clientKeySha256', 'supabaseAnonKeySha256', 'serviceWorkerCacheId']
      : ['workerOrigin', 'supabaseOrigin', 'clientKeySha256', 'supabaseAnonKeySha256', 'updatesUrl', 'easProjectId', 'versionCode', 'revenueCatSdkKeyIdentity', 'googleMapsSdkKeyIdentity'];
    assertAllowedKeys(generation.locators, locatorKeys, `compatibility.${generation.id}.locators`);
    if (Object.keys(generation.locators).length !== locatorKeys.length) fail(`compatibility.${generation.id}.locators`, 'must enumerate every locator for its component');
    exactHttpsOrigin(generation.locators.workerOrigin, `compatibility.${generation.id}.workerOrigin`);
    exactHttpsOrigin(generation.locators.supabaseOrigin, `compatibility.${generation.id}.supabaseOrigin`);
    if (!HASH.test(generation.locators.clientKeySha256 ?? '') || !HASH.test(generation.locators.supabaseAnonKeySha256 ?? '')) fail(`compatibility.${generation.id}.locators`, 'identifier hashes must be SHA-256');
    if (generation.component === 'pages') {
      exactHttpsOrigin(generation.locators.siteOrigin, `compatibility.${generation.id}.siteOrigin`);
      if (!generation.browserOrigins.includes(generation.locators.siteOrigin)) fail(`compatibility.${generation.id}.siteOrigin`, 'must be retained in browserOrigins');
      requiredValue(generation.locators.serviceWorkerCacheId, `compatibility.${generation.id}.serviceWorkerCacheId`);
    } else {
      exactHttpsUrl(generation.locators.updatesUrl, `compatibility.${generation.id}.updatesUrl`);
      if (!UUID.test(generation.locators.easProjectId ?? '')) fail(`compatibility.${generation.id}.easProjectId`, 'must be a UUID');
      if (!Number.isSafeInteger(generation.locators.versionCode) || generation.locators.versionCode <= 0) fail(`compatibility.${generation.id}.versionCode`, 'must be a positive integer');
      for (const name of ['revenueCatSdkKeyIdentity', 'googleMapsSdkKeyIdentity']) {
        if (generation.locators[name] !== 'remote-unverified' && !HASH.test(generation.locators[name] ?? '')) fail(`compatibility.${generation.id}.${name}`, 'must be remote-unverified or SHA-256');
      }
    }
  }
  if (!Array.isArray(compatibility.retirements)) fail('compatibility.retirements', 'must be an array');
  const retirementById = new Map();
  for (const retirement of compatibility.retirements) {
    assertAllowedKeys(retirement, ['generationId', 'evidenceKind', 'evidencePath', 'evidenceSha256', 'ownerApprovalPath', 'ownerApprovalSha256', 'retiredAt'], `compatibility.retirement.${retirement?.generationId ?? 'unknown'}`);
    if (!ids.has(retirement.generationId) || retirementById.has(retirement.generationId)) fail('compatibility.retirement.generationId', 'must uniquely reference an existing generation');
    if (!RETIREMENT_EVIDENCE.includes(retirement.evidenceKind)) fail(`compatibility.retirement.${retirement.generationId}.evidenceKind`, 'is not approved');
    canonicalPastTimestamp(retirement.retiredAt, `compatibility.retirement.${retirement.generationId}.retiredAt`);
    const evidence = validateSealedArtifact(root, retirement.evidencePath, retirement.evidenceSha256, 'deploy/config/retirement-evidence/', {
      kind: 'installed-client-retirement-evidence', generationId: retirement.generationId, evidenceKind: retirement.evidenceKind,
    }, `compatibility.retirement.${retirement.generationId}.evidence`);
    const approval = validateSealedArtifact(root, retirement.ownerApprovalPath, retirement.ownerApprovalSha256, 'deploy/config/owner-approvals/', {
      kind: 'deploy-config-owner-approval', scope: 'retire-installed-generation', subject: retirement.generationId,
    }, `compatibility.retirement.${retirement.generationId}.approval`);
    if (Date.parse(approval.approvedAt) < Date.parse(evidence.observedAt)) fail(`compatibility.retirement.${retirement.generationId}`, 'approval must follow the retirement evidence');
    if (Date.parse(evidence.observedAt) > Date.parse(retirement.retiredAt) || Date.parse(approval.approvedAt) > Date.parse(retirement.retiredAt)) fail(`compatibility.retirement.${retirement.generationId}`, 'retirement must follow evidence and approval');
    retirementById.set(retirement.generationId, retirement);
  }
  for (const component of ['pages', 'mobile']) {
    const id = compatibility.currentGenerations[component];
    const current = compatibility.generations.find((item) => item.id === id && item.component === component);
    if (!current || retirementById.has(id)) fail(`compatibility.currentGenerations.${component}`, 'must reference a non-retired generation of that component');
  }
  return { ids, retirementById };
}

function expectedGenerationIds(component, compatibility) {
  const retired = new Set(compatibility.retirements.map((item) => item.generationId));
  const supported = compatibility.generations.filter((item) => !retired.has(item.id));
  return supported.filter((item) => ['worker', 'database'].includes(component) || item.component === component).map((item) => item.id).sort();
}

function validateCurrentCompatibility(contract, configs, compatibility) {
  for (const component of ['pages', 'mobile']) {
    const current = compatibility.generations.find((item) => item.id === compatibility.currentGenerations[component]);
    const actual = configs[component];
    for (const key of ['workerOrigin', 'supabaseOrigin']) if (actual[key] !== current.locators[key]) fail(`${component}.${key}`, 'does not match the current compatibility generation');
    if (sha256(actual.clientKey) !== current.locators.clientKeySha256) fail(`${component}.clientKey`, 'does not match the current compatibility generation');
    if (sha256(actual.supabaseAnonKey) !== current.locators.supabaseAnonKeySha256) fail(`${component}.supabaseAnonKey`, 'does not match the current compatibility generation');
    if (component === 'pages') {
      if (actual.siteOrigin !== current.locators.siteOrigin) fail('pages.siteOrigin', 'does not match the current compatibility generation');
      if (actual.serviceWorkerCacheId !== current.locators.serviceWorkerCacheId) fail('pages.serviceWorkerCacheId', 'does not match the current compatibility generation');
    }
    if (component === 'mobile') {
      for (const key of ['updatesUrl', 'projectId', 'versionCode', 'revenueCatSdkKeyIdentity', 'googleMapsSdkKeyIdentity']) {
        const locatorKey = key === 'projectId' ? 'easProjectId' : key;
        if (actual[key] !== current.locators[locatorKey]) fail(`mobile.${key}`, 'does not match the current compatibility generation');
      }
    }
  }
  const retired = new Set(compatibility.retirements.map((item) => item.generationId));
  const supportedDatabaseOrigins = new Set([
    configs.worker.supabaseOrigin,
    ...compatibility.generations.filter((item) => !retired.has(item.id)).map((item) => item.locators.supabaseOrigin),
  ]);
  for (const origin of supportedDatabaseOrigins) if (!configs.database.approvedProductionOrigins.includes(origin)) fail('database.target-policy', 'must retain every supported generation Supabase origin');
  const requiredOrigins = [...new Set(compatibility.generations.filter((item) => !retired.has(item.id)).flatMap((item) => item.browserOrigins))].sort();
  if (JSON.stringify([...configs.worker.allowedOrigins].sort()) !== JSON.stringify(requiredOrigins)) fail('worker.ALLOWED_ORIGIN', 'must exactly retain every supported browser generation origin');
  if (configs.worker.workerEnv !== 'production') fail('worker.WORKER_ENV', 'must be production for the committed release boundary');
  if (!['true', 'false'].includes(configs.worker.scanTokenEnforce)) fail('worker.SCAN_TOKEN_ENFORCE', 'must be explicitly true or false');
  const declaredNames = configs.worker.declarations.map((item) => item.name).sort();
  const workerResources = contract.components.worker.resources.filter((item) => item.source === 'worker/config.js');
  const contractNames = workerResources.map((item) => item.name).sort();
  if (canonicalJson(declaredNames) !== canonicalJson(contractNames)) fail('worker.contract', 'runtime and deploy resource inventories must enumerate the same names');
  for (const declaration of configs.worker.declarations) {
    const resource = workerResources.find((item) => item.name === declaration.name);
    if (resource.requirement !== declaration.requirement || resource.sensitive !== declaration.sensitive) fail(`worker.contract.${declaration.name}`, 'runtime and deploy classifications disagree');
    if (declaration.requirement === 'feature-gated' && (declaration.features.length !== 1 || resource.condition !== declaration.features[0])) fail(`worker.contract.${declaration.name}`, 'runtime and deploy feature conditions disagree');
  }
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function validateCompatibilityHistory(root, current) {
  if (!existsSync(join(root, '.git'))) return;
  const commitsText = gitOutput(root, ['log', '--first-parent', '--format=%H', '--', 'deploy/config/compatibility.json']);
  if (commitsText === null) fail('compatibility.history', 'Git history is unavailable');
  const commits = commitsText.split(/\r?\n/).filter(Boolean).reverse();
  const snapshots = commits.map((commit) => {
    const text = gitOutput(root, ['show', `${commit}:deploy/config/compatibility.json`]);
    if (text === null) fail('compatibility.history', `could not read compatibility at ${commit}`);
    try { return JSON.parse(text); } catch { fail('compatibility.history', `contains invalid JSON at ${commit}`); }
  });
  if (!snapshots.length || canonicalJson(snapshots.at(-1)) !== canonicalJson(current)) snapshots.push(current);
  for (let index = 1; index < snapshots.length; index += 1) {
    const before = snapshots[index - 1];
    const after = snapshots[index];
    const afterGenerations = new Map(after.generations.map((item) => [item.id, item]));
    for (const generation of before.generations) {
      if (!afterGenerations.has(generation.id) || canonicalJson(afterGenerations.get(generation.id)) !== canonicalJson(generation)) fail('compatibility.history', `generation ${generation.id} was deleted or rewritten`);
    }
    const afterRetirements = new Map(after.retirements.map((item) => [item.generationId, item]));
    for (const retirement of before.retirements) {
      if (!afterRetirements.has(retirement.generationId) || canonicalJson(afterRetirements.get(retirement.generationId)) !== canonicalJson(retirement)) fail('compatibility.history', `retirement ${retirement.generationId} was deleted or rewritten`);
    }
  }
}

function loadModel(root) {
  const contract = readJson(join(root, 'deploy', 'config', 'contract.json'), 'contract');
  const compatibility = readJson(join(root, 'deploy', 'config', 'compatibility.json'), 'compatibility');
  validateContract(root, contract);
  validateCompatibility(root, compatibility);
  validateCompatibilityHistory(root, compatibility);
  const configs = {
    pages: resolvePagesDeployConfig(root),
    mobile: resolveMobileDeployConfig(root),
    worker: resolveWorkerDeployConfig(root),
    database: resolveDatabaseDeployConfig(root),
    'metrics-digest': resolveMetricsDeployConfig(root),
  };
  validateCurrentCompatibility(contract, configs, compatibility);
  return { contract, compatibility, configs };
}

export function calculateDeployConfigIdentity(root, component, model = loadModel(root)) {
  if (!RELEASE_COMPONENTS.includes(component)) fail('component', 'must be pages, mobile, worker, or database');
  const contractEntry = model.contract.components[component];
  const sourcePaths = [...new Set([...contractEntry.resources.map((resource) => resource.source), ...(contractEntry.compatibilitySources ?? [])])].sort();
  const coversEveryClient = component === 'worker' || component === 'database';
  const generations = model.compatibility.generations.filter((item) => coversEveryClient || item.component === component);
  const generationIds = new Set(generations.map((item) => item.id));
  const compatibility = {
    schemaVersion: model.compatibility.schemaVersion,
    retirementPolicy: model.compatibility.retirementPolicy,
    currentGenerations: coversEveryClient
      ? model.compatibility.currentGenerations
      : { [component]: model.compatibility.currentGenerations[component] },
    generations,
    retirements: model.compatibility.retirements.filter((item) => generationIds.has(item.generationId)),
  };
  const payload = {
    schemaVersion: 1,
    component,
    contract: contractEntry,
    configuration: model.configs[component],
    compatibility,
    sourceHashes: Object.fromEntries(sourcePaths.map((path) => [path, portableSourceHash(join(root, path), path)])),
  };
  return sha256(canonicalJson(payload));
}

function validateRemoteEvidence(root, attestation, model) {
  if (attestation.remotePresence === 'unverified') {
    if ('remoteEvidence' in attestation || 'remoteEvidenceSha256' in attestation) fail(`${attestation.component}.remoteEvidence`, 'must be absent while remote presence is unverified');
    return;
  }
  if (attestation.remotePresence !== 'attested') fail(`${attestation.component}.remotePresence`, 'must be unverified or attested');
  const input = requiredValue(attestation.remoteEvidence, `${attestation.component}.remoteEvidence`);
  if (!input.startsWith('deploy/config/remote/')) fail(`${attestation.component}.remoteEvidence`, 'must be under deploy/config/remote');
  const path = safeRepositoryPath(root, input, `${attestation.component}.remoteEvidence`);
  if (!HASH.test(attestation.remoteEvidenceSha256 ?? '') || fileHash(path) !== attestation.remoteEvidenceSha256) fail(`${attestation.component}.remoteEvidenceSha256`, 'does not match the versioned evidence');
  const evidence = readJson(path, `${attestation.component}.remoteEvidence`);
  assertAllowedKeys(evidence, ['schemaVersion', 'kind', 'component', 'configurationIdentity', 'sourceCommit', 'observedAt', 'enabledFeatures', 'fieldsPresent', 'approvalPath', 'approvalSha256', 'contentHash'], `${attestation.component}.remoteEvidence`);
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'deploy-config-remote-presence' || evidence.component !== attestation.component || evidence.configurationIdentity !== attestation.identity) fail(`${attestation.component}.remoteEvidence`, 'does not bind the component and configuration identity');
  if (!/^[a-f0-9]{40}$/i.test(evidence.sourceCommit ?? '')) fail(`${attestation.component}.remoteEvidence.sourceCommit`, 'must be an exact Git commit');
  if (existsSync(join(root, '.git'))) {
    const sourceAttestationText = gitOutput(root, ['show', `${evidence.sourceCommit}:deploy/config/${attestation.component}.json`]);
    if (sourceAttestationText === null) fail(`${attestation.component}.remoteEvidence.sourceCommit`, 'must reference a commit containing the reviewed component attestation');
    let sourceAttestation;
    try { sourceAttestation = JSON.parse(sourceAttestationText); } catch { fail(`${attestation.component}.remoteEvidence.sourceCommit`, 'contains an invalid component attestation'); }
    if (sourceAttestation.identity !== attestation.identity) fail(`${attestation.component}.remoteEvidence.sourceCommit`, 'does not bind the attested configuration identity');
  }
  const featureConditions = [...new Set(model.contract.components[attestation.component].resources.filter((resource) => resource.requirement === 'feature-gated').map((resource) => resource.condition))].sort();
  if (!Array.isArray(evidence.enabledFeatures) || new Set(evidence.enabledFeatures).size !== evidence.enabledFeatures.length || evidence.enabledFeatures.some((feature) => !featureConditions.includes(feature))) fail(`${attestation.component}.remoteEvidence.enabledFeatures`, 'must list only unique declared feature conditions');
  const enabled = new Set(evidence.enabledFeatures);
  const expectedFields = model.contract.components[attestation.component].resources
    .filter((resource) => !['optional', 'optional-local', 'required-for-local', 'feature-gated'].includes(resource.requirement) || (resource.requirement === 'feature-gated' && enabled.has(resource.condition)))
    .map((resource) => resource.name).sort();
  if (!Array.isArray(evidence.fieldsPresent) || new Set(evidence.fieldsPresent).size !== evidence.fieldsPresent.length || canonicalJson([...evidence.fieldsPresent].sort()) !== canonicalJson(expectedFields)) fail(`${attestation.component}.remoteEvidence.fieldsPresent`, 'must exactly enumerate required fields and enabled feature fields');
  canonicalPastTimestamp(evidence.observedAt, `${attestation.component}.remoteEvidence.observedAt`);
  const approval = validateSealedArtifact(root, evidence.approvalPath, evidence.approvalSha256, 'deploy/config/owner-approvals/', {
    kind: 'deploy-config-owner-approval', scope: 'observe-remote-presence', subject: `${attestation.component}:${attestation.identity}`,
  }, `${attestation.component}.remoteEvidence.approval`);
  if (Date.parse(approval.approvedAt) > Date.parse(evidence.observedAt)) fail(`${attestation.component}.remoteEvidence`, 'observation must follow approval');
  const expectedHash = sha256(canonicalJson(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'contentHash'))));
  if (evidence.contentHash !== expectedHash) fail(`${attestation.component}.remoteEvidence.contentHash`, 'is invalid');
}

export function buildDeployConfigAttestation(root, component, remotePresence = 'unverified') {
  const model = loadModel(root);
  return {
    schemaVersion: 1,
    kind: 'deploy-config-attestation',
    component,
    identity: calculateDeployConfigIdentity(root, component, model),
    validation: 'passed',
    remotePresence,
    compatibilityGenerationIds: expectedGenerationIds(component, model.compatibility),
  };
}

export function verifyDeployConfigAttestation(root, component, inputPath) {
  if (!RELEASE_COMPONENTS.includes(component)) fail('component', 'must be pages, mobile, worker, or database');
  const expectedRelative = `deploy/config/${component}.json`;
  const absolute = safeRepositoryPath(root, inputPath, `${component}.attestation`);
  if (relative(root, absolute).replace(/\\/g, '/') !== expectedRelative) fail(`${component}.attestation`, `must be ${expectedRelative}`);
  const attestation = readJson(absolute, `${component}.attestation`);
  assertAllowedKeys(attestation, ATTESTATION_KEYS, `${component}.attestation`);
  if (attestation.schemaVersion !== 1 || attestation.kind !== 'deploy-config-attestation' || attestation.component !== component || attestation.validation !== 'passed') fail(`${component}.attestation`, 'has invalid binding fields');
  const model = loadModel(root);
  const expectedIds = expectedGenerationIds(component, model.compatibility);
  if (!Array.isArray(attestation.compatibilityGenerationIds) || JSON.stringify([...attestation.compatibilityGenerationIds].sort()) !== JSON.stringify(expectedIds)) fail(`${component}.compatibilityGenerationIds`, 'must exactly cover supported generations');
  const identity = calculateDeployConfigIdentity(root, component, model);
  if (!HASH.test(attestation.identity ?? '') || attestation.identity !== identity) fail(`${component}.identity`, 'does not match the authoritative configuration');
  validateRemoteEvidence(root, attestation, model);
  return { component, identity, validation: 'passed', remotePresence: attestation.remotePresence };
}

export function validateDeployConfigRepository(root = DEFAULT_ROOT) {
  loadModel(root);
  return Object.fromEntries(RELEASE_COMPONENTS.map((component) => [component, verifyDeployConfigAttestation(root, component, `deploy/config/${component}.json`)]));
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) fail('arguments', `unexpected ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(args[i], 'requires a value');
    const key = args[i].slice(2);
    if (key in result) fail(args[i], 'may be supplied only once');
    result[key] = args[++i];
  }
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const parsed = options(args);
    if (command === 'validate') {
      if (Object.keys(parsed).length) fail('validate', 'does not accept options');
      validateDeployConfigRepository(DEFAULT_ROOT);
      console.log('Deploy configuration contract passed (remote presence remains explicitly attested or unverified).');
    } else if (command === 'pages-project-name') {
      if (Object.keys(parsed).length) fail('pages-project-name', 'does not accept options');
      process.stdout.write(resolvePagesDeployConfig(DEFAULT_ROOT).projectName);
    } else if (command === 'attest') {
      if (!parsed.component || Object.keys(parsed).length !== 1) fail('attest', 'requires only --component');
      process.stdout.write(canonicalJson(buildDeployConfigAttestation(DEFAULT_ROOT, parsed.component)));
    } else if (command === 'verify-attestation') {
      if (!parsed.component || !parsed.path || Object.keys(parsed).length !== 2) fail('verify-attestation', 'requires --component and --path');
      process.stdout.write(JSON.stringify(verifyDeployConfigAttestation(DEFAULT_ROOT, parsed.component, parsed.path)));
    } else {
      fail('command', 'must be validate, pages-project-name, attest, or verify-attestation');
    }
  } catch (error) {
    console.error(`Deploy configuration validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

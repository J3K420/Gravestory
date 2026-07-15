#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'database', 'catalog.json');
const SQL_SCAN_EXCLUSIONS = new Set(['.git', 'node_modules', '.wrangler', 'coverage', 'dist', 'build']);
const LOCAL_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const PRODUCTION_APPROVALS = new Set(['explicit-production-read', 'explicit-production-write']);
const ARTIFACT_VALUES = Object.freeze({
  access: new Set(['read', 'write']),
  release: new Set(['none', 'post-migration-verification', 'schema-before-dependent-release', 'historical-superseded-do-not-run']),
  approval: new Set(['explicit-production-read', 'explicit-production-write']),
  verification: new Set(['disposable-local-reset', 'operator-reviewed-results', 'superseded-by-028', 'historical-reference-only']),
  recovery: new Set(['forward-fix-only', 'not-applicable', 'self-cleaning-best-effort']),
});
const READ_FUNCTION_ALLOWLIST = new Set([
  'avg', 'coalesce', 'count', 'greatest', 'lower', 'max', 'min', 'now', 'nullif',
  'percentile_cont', 'replace', 'round', 'sum',
]);
const SQL_CALL_KEYWORDS = new Set([
  'and', 'as', 'by', 'case', 'filter', 'from', 'group', 'in', 'join', 'over', 'select', 'when', 'where',
]);
const ENTRYPOINT_VALUES = Object.freeze({
  access: new Set(['none', 'read', 'write', 'write-disposable']),
  target: new Set(['repository', 'local', 'production']),
  confirmation: new Set(['none', 'disposable-local', 'target-specific', 'production-write']),
  approval: new Set(['none', 'explicit-production-read', 'explicit-production-write']),
  release: new Set(['none', 'pre-commit', 'pre-release']),
});

function fail(message) {
  throw new Error(message);
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function listRepositoryFiles(root, predicate) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const relativePath = normalizedRelative(root, path);
      if (entry.isDirectory()) {
        if (SQL_SCAN_EXCLUSIONS.has(entry.name) || relativePath === 'supabase/migrations') continue;
        visit(path);
      } else if (entry.isFile() && predicate(path, relativePath)) files.push(relativePath);
    }
  };
  visit(root);
  return files.sort();
}

function listSqlFiles(root) {
  return listRepositoryFiles(root, (path) => path.toLowerCase().endsWith('.sql'));
}

function listOperationMarkers(root) {
  const markers = [];
  const allowedExtensions = /\.(?:js|mjs|cjs|ts|md|ps1|sh|py|ya?ml|toml)$/i;
  for (const relativePath of listRepositoryFiles(root, (path) => allowedExtensions.test(path))) {
    const absolute = resolve(root, relativePath);
    const content = readFileSync(absolute, 'utf8');
    for (const match of content.matchAll(/@database-operation\s+([a-z0-9-]+)/g)) {
      markers.push({ id: match[1], path: relativePath });
    }
  }
  return markers;
}

function artifactKind(path) {
  const file = basename(path);
  if (path.startsWith('queries/')) return 'query';
  if (!path.startsWith('supabase-migrations/')) return 'invalid';
  if (/^\d{3}_VERIFY_.+\.sql$/.test(file)) return 'verification';
  if (/^_RETRIEVE_.+\.sql$/.test(file)) return 'retrieval';
  if (/^\d{3}_(?!VERIFY_).+\.sql$/.test(file)) return 'migration';
  return 'invalid';
}

export function fingerprintSql(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sha256(path) {
  return fingerprintSql(readFileSync(path));
}

function maskSqlNonCode(content, preserveDoubleQuoted = false) {
  let masked = '';
  let state = 'code';
  let dollarTag = '';
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1] ?? '';
    if (state === 'code') {
      if (char === '-' && next === '-') { state = 'line-comment'; masked += '  '; index += 1; continue; }
      if (char === '/' && next === '*') { state = 'block-comment'; masked += '  '; index += 1; continue; }
      if (char === "'") { state = 'single-quote'; masked += ' '; continue; }
      if (char === '"') { state = 'double-quote'; masked += preserveDoubleQuoted ? char : ' '; continue; }
      if (char === '$') {
        const tag = content.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) { state = 'dollar-quote'; dollarTag = tag; masked += ' '.repeat(tag.length); index += tag.length - 1; continue; }
      }
      masked += char;
      continue;
    }
    if (state === 'line-comment' && (char === '\r' || char === '\n')) { state = 'code'; masked += char; continue; }
    if (state === 'block-comment' && char === '*' && next === '/') { state = 'code'; masked += '  '; index += 1; continue; }
    if (state === 'single-quote' && char === "'" && next === "'") { masked += '  '; index += 1; continue; }
    if (state === 'single-quote' && char === "'") { state = 'code'; masked += ' '; continue; }
    if (state === 'double-quote' && char === '"' && next === '"') { masked += preserveDoubleQuoted ? '""' : '  '; index += 1; continue; }
    if (state === 'double-quote' && char === '"') { state = 'code'; masked += preserveDoubleQuoted ? char : ' '; continue; }
    if (state === 'dollar-quote' && content.startsWith(dollarTag, index)) {
      state = 'code'; masked += ' '.repeat(dollarTag.length); index += dollarTag.length - 1; continue;
    }
    masked += state === 'double-quote' && preserveDoubleQuoted ? char : (char === '\r' || char === '\n' ? char : ' ');
  }
  return masked;
}

function containsSqlWrite(content) {
  const code = maskSqlNonCode(content)
    .replace(/\bset\s+session\s+characteristics\s+as\s+transaction\s+read\s+only\s*;/gi, ' ')
    .replace(/\bset\s+transaction\s+read\s+only\s*;/gi, ' ');
  const writeKeyword = /\b(?:alter|call|cluster|comment|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|listen|lock|merge|notify|prepare|refresh|reindex|reset|revoke|set|truncate|unlisten|update|vacuum)\b/i;
  return writeKeyword.test(code) || /\bselect\b[\s\S]*?\binto\b/i.test(code);
}

export function isSelectOnlySql(content) {
  const code = maskSqlNonCode(content, true);
  if (/[^\u0000-\u007f]/.test(code) || /"(?:""|[^"])*"\s*\(/.test(code)) return false;
  const statements = maskSqlNonCode(content).split(';').map((statement) => statement.trim()).filter(Boolean);
  if (statements.length < 3 ||
    !/^set\s+session\s+characteristics\s+as\s+transaction\s+read\s+only$/i.test(statements[0]) ||
    !/^set\s+transaction\s+read\s+only$/i.test(statements[1])) return false;
  const body = statements.slice(2);
  if (containsSqlWrite(body.join(';')) || !body.every((statement) => /^(?:select|with)\b/i.test(statement))) return false;
  return unapprovedReadFunctions(body.join(';')).length === 0;
}

export function unapprovedReadFunctions(content) {
  const calls = [...maskSqlNonCode(content).matchAll(/\b([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*)\s*\(/g)]
    .map(([, name]) => name.toLowerCase()).filter((name) => !SQL_CALL_KEYWORDS.has(name));
  return [...new Set(calls.filter((name) => !READ_FUNCTION_ALLOWLIST.has(name)))];
}

export function loadDatabaseCatalog(path = CATALOG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateDatabaseControl(root, catalog) {
  if (catalog.schemaVersion !== 1) fail('database/catalog.json must use schemaVersion 1');
  if (catalog.migrationDirectory !== 'supabase-migrations' || catalog.queryDirectory !== 'queries') {
    fail('Database catalog SQL directories must remain supabase-migrations and queries');
  }
  if (!Array.isArray(catalog.artifacts) || catalog.artifacts.length === 0) fail('Database catalog must contain artifacts');

  const catalogPaths = catalog.artifacts.map(({ path }) => path);
  const duplicatePaths = catalogPaths.filter((path, index) => catalogPaths.indexOf(path) !== index);
  if (duplicatePaths.length) fail(`Database catalog has duplicate paths: ${[...new Set(duplicatePaths)].join(', ')}`);

  const actualPaths = listSqlFiles(root);
  const uncataloged = actualPaths.filter((path) => !catalogPaths.includes(path));
  const missing = catalogPaths.filter((path) => !actualPaths.includes(path));
  if (uncataloged.length) fail(`Uncataloged SQL artifacts: ${uncataloged.join(', ')}`);
  if (missing.length) fail(`Catalog references missing SQL artifacts: ${missing.join(', ')}`);

  const requiredMetadata = ['summary', 'access', 'release', 'approval', 'verification', 'recovery'];
  const inputProfiles = catalog.environmentInputProfiles;
  if (!inputProfiles || typeof inputProfiles !== 'object') fail('Database catalog must define environmentInputProfiles');
  for (const artifact of catalog.artifacts) {
    if (isAbsolute(artifact.path) || artifact.path.includes('..')) fail(`Unsafe catalog path: ${artifact.path}`);
    const expectedKind = artifactKind(artifact.path);
    if (expectedKind === 'invalid' || artifact.kind !== expectedKind) {
      fail(`Catalog kind mismatch for ${artifact.path}: expected ${expectedKind}, found ${artifact.kind}`);
    }
    const absolutePath = resolve(root, artifact.path);
    const digest = sha256(absolutePath);
    if (artifact.sha256 !== digest) fail(`Catalog fingerprint mismatch for ${artifact.path}`);
    for (const field of requiredMetadata) {
      if (typeof artifact[field] !== 'string' || !artifact[field].trim()) fail(`${artifact.path} is missing ${field}`);
      if (ARTIFACT_VALUES[field] && !ARTIFACT_VALUES[field].has(artifact[field])) {
        fail(`${artifact.path} has unsupported ${field}: ${artifact[field]}`);
      }
    }
    const inputProfile = inputProfiles[artifact.approval];
    if (!inputProfile || !Array.isArray(inputProfile.inputs)) {
      fail(`${artifact.path} references an undefined environment input profile: ${artifact.approval}`);
    }
    if (PRODUCTION_APPROVALS.has(artifact.approval) && inputProfile.inputs.length === 0) {
      fail(`${artifact.path} production approval profile must declare environment inputs`);
    }
    const writes = containsSqlWrite(readFileSync(absolutePath, 'utf8'));
    if (writes && artifact.access !== 'write') fail(`${artifact.path} contains SQL writes but is not classified as write`);
    if (artifact.access === 'read' && !isSelectOnlySql(readFileSync(absolutePath, 'utf8'))) {
      fail(`${artifact.path} read artifact must contain only SELECT/WITH statements`);
    }
    if (artifact.access === 'write' && (
      artifact.approval !== 'explicit-production-write' || !['forward-fix-only', 'self-cleaning-best-effort'].includes(artifact.recovery)
    )) fail(`${artifact.path} write artifact must require production-write approval and write-compatible recovery`);
    if (['verification', 'retrieval'].includes(artifact.kind) && artifact.access === 'write' && artifact.release !== 'historical-superseded-do-not-run') {
      fail(`${artifact.path} legacy write helper must remain historical-superseded-do-not-run`);
    }
    if (artifact.kind === 'query' && artifact.access !== 'read') fail(`${artifact.path} query must be classified as read`);
    if (artifact.kind === 'migration' && (
      artifact.access !== 'write' || artifact.approval !== 'explicit-production-write' || artifact.recovery !== 'forward-fix-only'
    )) fail(`${artifact.path} migration must be write/explicit-production-write/forward-fix-only`);
  }

  const migrations = catalog.artifacts.filter(({ kind }) => kind === 'migration');
  const migrationIds = migrations.map(({ id }) => id);
  if (migrationIds.some((id) => !/^\d{3}$/.test(id))) fail('Primary migration IDs must be three digits');
  const duplicateIds = migrationIds.filter((id, index) => migrationIds.indexOf(id) !== index);
  if (duplicateIds.length) fail(`Duplicate primary migration IDs: ${[...new Set(duplicateIds)].join(', ')}`);
  const numericIds = migrationIds.map(Number).sort((a, b) => a - b);
  const orderedIds = numericIds.map((id) => String(id).padStart(3, '0'));
  if (migrationIds.join(',') !== orderedIds.join(',')) fail('Primary migrations must be cataloged in ascending order');
  if (numericIds[0] !== 1) fail('Primary migration sequence must begin at 001');
  const gapIds = (catalog.knownGaps ?? []).map(({ id }) => id);
  if (new Set(gapIds).size !== gapIds.length) fail('Known migration gap IDs must be unique');
  const explainedGaps = new Set(gapIds);
  for (let id = 1; id <= numericIds.at(-1); id += 1) {
    const formatted = String(id).padStart(3, '0');
    if (!numericIds.includes(id) && !explainedGaps.has(formatted)) fail(`Unexplained migration gap: ${formatted}`);
  }
  for (const gap of catalog.knownGaps ?? []) {
    if (!/^\d{3}$/.test(gap.id) || typeof gap.reason !== 'string' || !gap.reason.trim()) fail('Every known migration gap needs a three-digit ID and reason');
    if (migrationIds.includes(gap.id)) fail(`Migration ${gap.id} exists and cannot also be a gap`);
    if (Number(gap.id) < 1 || Number(gap.id) > numericIds.at(-1)) fail(`Migration gap is outside the current sequence: ${gap.id}`);
  }
  for (const migration of migrations) {
    if (!basename(migration.path).startsWith(`${migration.id}_`)) fail(`Migration ID/path mismatch: ${migration.path}`);
  }

  if (!['ready', 'unresolved'].includes(catalog.bootstrap?.status)) fail('Bootstrap status must be ready or unresolved');
  if (catalog.bootstrap.status === 'unresolved' && (!Array.isArray(catalog.bootstrap.missing) || catalog.bootstrap.missing.length === 0)) {
    fail('Unresolved bootstrap must list its missing prerequisites');
  }
  if (catalog.bootstrap.status === 'unresolved' && catalog.bootstrap.productionInspectionRequired !== true) {
    fail('Unresolved bootstrap must record whether approved production inspection is required');
  }
  if (catalog.bootstrap.status === 'ready' && (
    catalog.bootstrap.productionInspectionRequired !== false || !Array.isArray(catalog.bootstrap.missing) || catalog.bootstrap.missing.length > 0
  )) fail('Ready bootstrap must explicitly have no missing prerequisites or production-inspection requirement');
  if (catalog.bootstrap.status === 'ready' && (
    !Array.isArray(catalog.bootstrap.baselineEvidence) || catalog.bootstrap.baselineEvidence.length < 2
  )) fail('Ready bootstrap must identify reviewed baseline evidence');
  if (catalog.bootstrap.status === 'ready') {
    const requiredEvidenceKinds = new Set(['baseline', 'auth-postgrest-rls-smoke']);
    for (const evidence of catalog.bootstrap.baselineEvidence) {
      if (!evidence || !requiredEvidenceKinds.has(evidence.kind) || typeof evidence.path !== 'string' ||
        !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '') || isAbsolute(evidence.path) || evidence.path.includes('..')) {
        fail('Ready bootstrap evidence must contain safe kind/path/SHA-256 records');
      }
      const evidencePath = resolve(root, evidence.path);
      if (!existsSync(evidencePath) || !lstatSync(evidencePath).isFile() || sha256(evidencePath) !== evidence.sha256) {
        fail(`Ready bootstrap evidence is missing or changed: ${evidence.path}`);
      }
      requiredEvidenceKinds.delete(evidence.kind);
    }
    if (requiredEvidenceKinds.size) fail(`Ready bootstrap evidence is missing: ${[...requiredEvidenceKinds].join(', ')}`);
  }

  const entrypoints = catalog.operationalEntrypoints ?? [];
  const entrypointIds = entrypoints.map(({ id }) => id);
  if (new Set(entrypointIds).size !== entrypointIds.length) fail('Operational entrypoint IDs must be unique');
  for (const entrypoint of entrypoints) {
    for (const field of ['id', 'path', 'access', 'confirmation', 'approval', 'release']) {
      if (typeof entrypoint[field] !== 'string' || !entrypoint[field].trim()) fail(`Operational entrypoint is missing ${field}`);
      if (ENTRYPOINT_VALUES[field] && !ENTRYPOINT_VALUES[field].has(entrypoint[field])) fail(`${entrypoint.id} has unsupported ${field}`);
    }
    if (!Array.isArray(entrypoint.targets) || entrypoint.targets.length === 0) fail(`${entrypoint.id} must declare targets`);
    if (entrypoint.targets.some((target) => !ENTRYPOINT_VALUES.target.has(target))) fail(`${entrypoint.id} has unsupported targets`);
    if (!Array.isArray(entrypoint.environmentInputs)) fail(`${entrypoint.id} must declare environmentInputs`);
    if (entrypoint.environmentInputs.some((input) => typeof input !== 'string' || !input.trim())) fail(`${entrypoint.id} has invalid environmentInputs`);
    if (PRODUCTION_APPROVALS.has(entrypoint.approval) && entrypoint.environmentInputs.length === 0) {
      fail(`${entrypoint.id} production task must declare environment inputs`);
    }
    const production = entrypoint.targets.includes('production');
    if (production && !PRODUCTION_APPROVALS.has(entrypoint.approval)) fail(`${entrypoint.id} production task must require production approval`);
    if (entrypoint.access === 'write' && (!production || entrypoint.approval !== 'explicit-production-write' || entrypoint.confirmation !== 'production-write')) {
      fail(`${entrypoint.id} write task requires production target, write approval, and write confirmation`);
    }
    if (entrypoint.access === 'read' && production && entrypoint.approval !== 'explicit-production-read') {
      fail(`${entrypoint.id} production read task requires read approval`);
    }
    if (entrypoint.access === 'read' && production && entrypoint.confirmation !== 'target-specific') {
      fail(`${entrypoint.id} production read task requires target-specific confirmation`);
    }
    if (entrypoint.access === 'write-disposable' && (
      entrypoint.targets.join(',') !== 'local' || entrypoint.approval !== 'none' || entrypoint.confirmation !== 'disposable-local'
    )) fail(`${entrypoint.id} disposable write task must be local-only with disposable-local confirmation`);
    if (entrypoint.access === 'none' && (
      entrypoint.targets.join(',') !== 'repository' || entrypoint.approval !== 'none' || entrypoint.confirmation !== 'none'
    )) fail(`${entrypoint.id} no-access task must be repository-only without approval`);
    const sourcePath = entrypoint.path.split('#')[0];
    if (!sourcePath || isAbsolute(sourcePath) || sourcePath.split(/[\\/]/).includes('..')) fail(`Unsafe operational entrypoint path: ${sourcePath}`);
    const resolvedSource = resolve(root, sourcePath);
    const relativeSource = relative(root, resolvedSource);
    if (relativeSource.startsWith('..') || isAbsolute(relativeSource)) fail(`Unsafe operational entrypoint path: ${sourcePath}`);
    if (!existsSync(resolvedSource) || !statSync(resolvedSource).isFile()) fail(`Operational entrypoint source is missing or not a file: ${sourcePath}`);
    if (!lstatSync(resolvedSource).isFile()) fail(`Operational entrypoint source cannot be a symlink: ${sourcePath}`);
    const fragment = entrypoint.path.includes('#') ? entrypoint.path.slice(entrypoint.path.indexOf('#') + 1) : '';
    if (fragment) {
      if (!sourcePath.toLowerCase().endsWith('.md')) fail(`Operational entrypoint fragment requires Markdown: ${entrypoint.path}`);
      const anchors = [...readFileSync(resolvedSource, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) =>
        heading.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-'));
      if (!anchors.includes(fragment)) fail(`Operational entrypoint Markdown anchor is missing: ${entrypoint.path}`);
    }
  }
  const markers = listOperationMarkers(root);
  const markerIds = markers.map(({ id }) => id);
  if (new Set(markerIds).size !== markerIds.length) fail('Database operation marker IDs must be unique');
  const unclassifiedMarkers = markers.filter(({ id }) => !entrypointIds.includes(id));
  if (unclassifiedMarkers.length) fail(`Uncataloged database operations: ${unclassifiedMarkers.map(({ id, path }) => `${id} (${path})`).join(', ')}`);
  const unmarkedEntrypoints = entrypointIds.filter((id) => !markerIds.includes(id));
  if (unmarkedEntrypoints.length) fail(`Operational entrypoints are missing source markers: ${unmarkedEntrypoints.join(', ')}`);
  for (const marker of markers) {
    const entrypoint = entrypoints.find(({ id }) => id === marker.id);
    const sourcePath = entrypoint.path.split('#')[0].split('\\').join('/');
    if (sourcePath !== marker.path) fail(`Database operation ${marker.id} marker path does not match catalog path: ${marker.path}`);
  }

  return { artifactCount: catalog.artifacts.length, migrationCount: migrations.length, bootstrapStatus: catalog.bootstrap.status };
}

export function parseLocalSelection(args) {
  for (const flag of ['--target', '--confirm']) {
    if (args.filter((value) => value === flag).length !== 1) fail(`${flag} must be supplied exactly once`);
  }
  const targetAt = args.indexOf('--target');
  const confirmAt = args.indexOf('--confirm');
  const target = targetAt >= 0 ? args[targetAt + 1] : '';
  const confirmation = confirmAt >= 0 ? args[confirmAt + 1] : '';
  if (target !== 'local') fail('Local database tests require --target local');
  if (confirmation !== 'disposable-local') fail('Local database tests require --confirm disposable-local');
  return { target, confirmation };
}

export function assertLocalBootstrapReady(catalog) {
  if (catalog.bootstrap.status !== 'ready') {
    fail(`Local Supabase parity is blocked: ${catalog.bootstrap.reason} Missing: ${catalog.bootstrap.missing.join('; ')}`);
  }
}

function migrationVersion(id) {
  const ordinal = Number(id);
  const minute = Math.floor((ordinal - 1) / 60);
  const second = (ordinal - 1) % 60 + 1;
  return `2000010100${String(minute).padStart(2, '0')}${String(second).padStart(2, '0')}`;
}

export function verifyGeneratedMigrationDirectory(output) {
  const marker = join(output, '.generated-by-database-control');
  if (!existsSync(marker) || !lstatSync(marker).isFile()) fail('Generated migration directory is missing its regular manifest file');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    fail('Generated migration directory has an invalid manifest');
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) fail('Generated migration manifest must use schemaVersion 1 with files');
  const expectedNames = ['.generated-by-database-control', ...manifest.files.map(({ name }) => name)].sort();
  const actualEntries = readdirSync(output, { withFileTypes: true });
  if (actualEntries.some((entry) => !entry.isFile())) fail('Generated migration directory contains a non-file entry');
  const actualNames = actualEntries.map(({ name }) => name).sort();
  if (actualNames.join('\n') !== expectedNames.join('\n')) fail('Generated migration directory contains files outside its manifest');
  for (const file of manifest.files) {
    if (!/^\d{14}_[A-Za-z0-9_.-]+\.sql$/.test(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail('Generated migration manifest contains an invalid file record');
    }
    const path = join(output, file.name);
    if (!lstatSync(path).isFile() || sha256(path) !== file.sha256) fail(`Generated migration file changed after materialization: ${file.name}`);
  }
}

function materializeLocalMigrations(root, catalog) {
  const output = join(root, 'supabase', 'migrations');
  const marker = join(output, '.generated-by-database-control');
  if (existsSync(output)) {
    verifyGeneratedMigrationDirectory(output);
    rmSync(output, { recursive: true, force: true });
  }
  mkdirSync(output, { recursive: true });
  const files = [];
  for (const artifact of catalog.artifacts.filter(({ kind }) => kind === 'migration')) {
    const name = `${migrationVersion(artifact.id)}_${basename(artifact.path)}`;
    const target = join(output, name);
    writeFileSync(target, readFileSync(join(root, artifact.path)));
    files.push({ name, sha256: sha256(target) });
  }
  writeFileSync(marker, `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`);
}

export function localExecutionEnvironment(env) {
  const allowed = new Set([
    'APPDATA', 'CI', 'COLORTERM', 'COMSPEC', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
    'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'Path', 'PATH', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'ProgramData', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)',
    'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR',
  ]);
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => allowed.has(name))),
    DO_NOT_TRACK: '1',
    DOCKER_CONTEXT: 'default',
  };
}

export function isLocalDockerEndpoint(endpoint) {
  return /^npipe:[/]{4}\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint) ||
    /^unix:\/\//.test(endpoint) || /^tcp:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(endpoint);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: options.shell ?? false,
    stdio: 'inherit',
    timeout: options.timeout ?? LOCAL_COMMAND_TIMEOUT_MS,
  });
  if (result.signal === 'SIGTERM' && result.status === null) fail(`${command} timed out`);
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

const STALE_LOCK_MS = 15 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function acquireLocalLock(lockPath) {
  const record = { pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() };
  try {
    const descriptor = openSync(lockPath, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
      return { descriptor, record };
    } catch (error) {
      closeSync(descriptor);
      rmSync(lockPath, { force: true });
      throw error;
    }
  } catch (error) {
    if (error.code !== 'EEXIST') fail(`Local database-control lock could not be acquired (${lockPath}): ${error.message}`);
    let existingRaw;
    let existing;
    try {
      existingRaw = readFileSync(lockPath, 'utf8');
      existing = JSON.parse(existingRaw);
    } catch {
      fail(`Local database-control lock is invalid and requires manual inspection: ${lockPath}`);
    }
    const age = Date.now() - Date.parse(existing.startedAt);
    if (Number.isFinite(age) && age > STALE_LOCK_MS && !processIsAlive(existing.pid)) {
      fail(`Stale local database-control lock requires manual inspection and removal before retrying: ${lockPath}`);
    }
    fail(`Another local database-control run may be active (${lockPath})`);
  }
}

function releaseLocalLock(lockPath, lock) {
  try {
    closeSync(lock.descriptor);
  } finally {
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (current.token === lock.record.token) unlinkSync(lockPath);
    } catch {
      // Never delete a missing, invalid, or replacement lock.
    }
  }
}

function runLocalTest(root, catalog) {
  assertLocalBootstrapReady(catalog);
  const smokeEvidence = catalog.bootstrap.baselineEvidence.find(({ kind }) => kind === 'auth-postgrest-rls-smoke');
  const smokeTest = resolve(root, smokeEvidence.path);
  if (!existsSync(smokeTest) || !lstatSync(smokeTest).isFile()) fail('Local Auth/PostgREST/RLS smoke tests must be a versioned regular file before a reset can run');
  if (sha256(smokeTest) !== smokeEvidence.sha256) fail('Local Auth/PostgREST/RLS smoke test does not match reviewed bootstrap evidence');
  const cli = join(root, 'tools', 'supabase-cli', 'node_modules', 'supabase', 'dist', 'supabase.js');
  if (!existsSync(cli) || !lstatSync(cli).isFile()) fail('Pinned Supabase CLI regular file is missing; run npm ci in tools/supabase-cli');
  const localEnv = localExecutionEnvironment(process.env);
  const context = spawnSync('docker', ['context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}'], {
    encoding: 'utf8',
    env: localEnv,
    shell: false,
    timeout: 10_000,
  });
  if (context.error) fail(`Docker context inspection could not run: ${context.error.message}`);
  if (context.status !== 0 || !isLocalDockerEndpoint(context.stdout.trim())) {
    fail('Docker default context must resolve to a local npipe, unix socket, or loopback TCP endpoint');
  }
  const docker = spawnSync('docker', ['--context', 'default', 'version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    env: localEnv,
    shell: false,
    timeout: 10_000,
  });
  if (docker.error) fail(`Docker could not run: ${docker.error.message}`);
  if (docker.status !== 0) fail('A running Docker-compatible container engine is required for local Supabase');
  const lockPath = join(root, 'supabase', '.database-control.lock');
  const lock = acquireLocalLock(lockPath);
  try {
    materializeLocalMigrations(root, catalog);
    run(process.execPath, [cli, '--workdir', root, 'db', 'reset', '--local'], { env: localEnv });
    run(process.execPath, [smokeTest, '--target', 'local', '--confirm', 'local-read'], { env: localEnv });
  } finally {
    releaseLocalLock(lockPath, lock);
  }
}

// @database-operation database-catalog-validate
// @database-operation database-local-test
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const command = process.argv[2] ?? '';
    const catalog = loadDatabaseCatalog();
    const result = validateDatabaseControl(ROOT, catalog);
    if (command === 'validate') {
      console.log(`Database catalog valid: ${result.migrationCount} migrations, ${result.artifactCount} SQL artifacts; bootstrap ${result.bootstrapStatus}.`);
    } else if (command === 'local-test') {
      parseLocalSelection(process.argv.slice(3));
      runLocalTest(ROOT, catalog);
    } else {
      fail('Usage: node tools/database-control.mjs validate | local-test --target local --confirm disposable-local');
    }
  } catch (error) {
    console.error(`Database control failed: ${error.message}`);
    process.exitCode = 1;
  }
}

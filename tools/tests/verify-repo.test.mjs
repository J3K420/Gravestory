import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_PAGES_ASSETS,
  calculateWebAssetRevision,
  classifyMigration,
  extractAttributeValues,
  extractInlineScripts,
  isExecutableScriptType,
  sanitizeVerificationEnv,
  validateBrowserDependencies,
  validateMigrations,
  validatePagesManifest,
} from '../verify-repo.mjs';

const pinnedHtml = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.5"></script>
`;

test('browser dependency validation accepts exact pins and rejects a floating major', () => {
  assert.doesNotThrow(() => validateBrowserDependencies(pinnedHtml));
  assert.throws(
    () => validateBrowserDependencies(pinnedHtml.replace('@2.110.5', '@2')),
    /load exactly Supabase browser JS/,
  );
  assert.throws(
    () => validateBrowserDependencies(`<!-- ${pinnedHtml} -->${pinnedHtml.replace('@2.110.5', '@2.111.0')}`),
    /load exactly Supabase browser JS/,
  );
  assert.deepEqual(
    extractAttributeValues('<!-- <script src="fake.js"></script> --><script src="live.js"></script>', 'script', 'src'),
    ['live.js'],
  );
  assert.throws(
    () => validateBrowserDependencies(pinnedHtml.replace('<script src="https://cdn.jsdelivr.net', '<script type="application/ld+json" src="https://cdn.jsdelivr.net')),
    /load exactly Supabase browser JS/,
  );
  assert.throws(
    () => validateBrowserDependencies(pinnedHtml.replace('rel="stylesheet"', 'rel="preload"')),
    /load exactly Leaflet CSS/,
  );
});

test('migration classification separates executable, verification, and retrieval SQL', () => {
  assert.equal(classifyMigration('034_admin_metrics_v2.sql'), 'migration');
  assert.equal(classifyMigration('026_VERIFY_live.sql'), 'verification');
  assert.equal(classifyMigration('_RETRIEVE_global_public_stories.sql'), 'retrieval');
  assert.equal(classifyMigration('notes.sql'), 'invalid');
});

test('migration validation rejects duplicate primary IDs and empty files', () => {
  assert.throws(
    () => validateMigrations(
      ['001_first.sql', '001_second.sql'],
      new Map([['001_first.sql', 'select 1;'], ['001_second.sql', 'select 2;']]),
    ),
    /Duplicate primary migration IDs/,
  );
  assert.throws(
    () => validateMigrations(['001_first.sql'], new Map([['001_first.sql', '']])),
    /Empty SQL migration files/,
  );
});

test('Pages manifest validation enforces the reviewed file set and cleans its fixture', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'gravestory-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const entry of REQUIRED_PAGES_ASSETS) {
    const target = join(root, entry);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry);
  }
  const manifest = `${REQUIRED_PAGES_ASSETS.join('\n')}\n`;

  assert.deepEqual(validatePagesManifest(root, manifest), [...REQUIRED_PAGES_ASSETS]);
  assert.throws(() => validatePagesManifest(root, ''), /must not be empty/);
  assert.throws(() => validatePagesManifest(root, `${manifest}index.html\n`), /duplicate paths/);
  assert.throws(
    () => validatePagesManifest(root, manifest.replace('js/map-global.js\n', '')),
    /omits required files/,
  );
  assert.throws(() => validatePagesManifest(root, `${manifest}..\\escape.txt\n`), /unreviewed files/);

  rmSync(join(root, 'index.html'));
  mkdirSync(join(root, 'index.html'));
  assert.throws(() => validatePagesManifest(root, manifest), /not a file/);
});

test('web asset revision ignores only the cache declaration and includes service-worker logic', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'gravestory-revision-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'index.html'), 'one\nline');
  writeFileSync(join(root, 'sw.js'), "const CACHE = 'one';\nlogic one");
  const first = calculateWebAssetRevision(root, ['index.html', 'sw.js']);
  writeFileSync(join(root, 'sw.js'), "const CACHE = 'two';\nlogic one");
  assert.equal(calculateWebAssetRevision(root, ['index.html', 'sw.js']), first);
  writeFileSync(join(root, 'index.html'), 'one\r\nline');
  assert.equal(calculateWebAssetRevision(root, ['index.html', 'sw.js']), first);
  writeFileSync(join(root, 'sw.js'), "const CACHE = 'two';\nlogic two");
  assert.notEqual(calculateWebAssetRevision(root, ['index.html', 'sw.js']), first);
  writeFileSync(join(root, 'sw.js'), "const CACHE = 'one';\nlogic one");
  writeFileSync(join(root, 'index.html'), 'two');
  assert.notEqual(calculateWebAssetRevision(root, ['index.html', 'sw.js']), first);
});

test('inline script extraction preserves module type and ignores comments and external scripts', () => {
  assert.deepEqual(
    extractInlineScripts('<!-- <script>fake()</script> --><script src="app.js"></script><script type="module">export const ready = true;</script>'),
    [{ source: 'export const ready = true;', type: 'module' }],
  );
  assert.equal(isExecutableScriptType('module'), true);
  assert.equal(isExecutableScriptType('application/ld+json'), false);
  assert.equal(isExecutableScriptType('importmap'), false);
});

test('verification environment removes credentials and disables tool telemetry', () => {
  const safe = sanitizeVerificationEnv({
    PATH: 'bin',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    CLIENT_KEY: 'secret',
    GEMINI_KEY: 'secret',
    TAVILY_KEY: 'secret',
    R2_ACCESS_KEY_ID: 'secret',
    GITHUB_TOKEN: 'secret',
    NPM_CONFIG_TOKEN: 'secret',
    NODE_OPTIONS: '--require bad.js',
  });
  assert.equal(safe.PATH, 'bin');
  assert.equal(safe.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(safe.CLIENT_KEY, undefined);
  assert.equal(safe.GEMINI_KEY, undefined);
  assert.equal(safe.TAVILY_KEY, undefined);
  assert.equal(safe.R2_ACCESS_KEY_ID, undefined);
  assert.equal(safe.GITHUB_TOKEN, undefined);
  assert.equal(safe.NPM_CONFIG_TOKEN, undefined);
  assert.equal(safe.NODE_OPTIONS, undefined);
  assert.equal(safe.DO_NOT_TRACK, '1');
  assert.equal(safe.WRANGLER_SEND_METRICS, 'false');
});

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadDatabaseCatalog, validateDatabaseControl } from './database-control.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TOOLCHAIN = Object.freeze({
  node: '22.13.1',
  npm: '10.9.2',
  python: '3.12.3',
  eas: '21.0.0',
  easJson: '21.0.0',
  typescript: '5.9.3',
  wrangler: '4.110.0',
  supabaseBrowser: '2.110.5',
  supabaseCli: '2.101.0',
});

export const REQUIRED_PAGES_ASSETS = Object.freeze([
  'index.html',
  'sw.js',
  'og-image.png',
  'css/base.css',
  'css/home.css',
  'css/maps.css',
  'css/result.css',
  'js/config.js',
  'js/util-json.js',
  'js/util-html.js',
  'js/util-dom.js',
  'js/auth.js',
  'js/symbols.js',
  'js/grave-markers.js',
  'js/render-result.js',
  'js/map-global.js',
  'js/analytics.js',
  'js/api-reports.js',
  'privacy-policy/index.html',
  'terms/index.html',
  'delete-account/index.html',
  'disclaimers/index.html',
]);

const COMMAND_TIMEOUT_MS = 300_000;
const EXECUTABLE_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export function isExecutableScriptType(type) {
  return EXECUTABLE_SCRIPT_TYPES.has(type.toLowerCase());
}

export function sanitizeVerificationEnv(env) {
  const blockedName = /(^|_)(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)(?:_|$)|(?:^|_)KEY(?:_ID)?$|^(?:AWS|AZURE|CLOUDFLARE|CF|EAS|EXPO_PUBLIC|GOOGLE|REVENUECAT|SUPABASE)_|^NPM_CONFIG_|^NODE_OPTIONS$/i;
  const safe = Object.fromEntries(Object.entries(env).filter(([name]) => !blockedName.test(name)));
  return {
    ...safe,
    DO_NOT_TRACK: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_OFFLINE: '1',
    NPM_CONFIG_USERCONFIG: join(ROOT, '.npmrc.verification-none'),
    WRANGLER_SEND_METRICS: 'false',
  };
}

const SAFE_ENV = sanitizeVerificationEnv(process.env);

function fail(message) {
  throw new Error(message);
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function npmCliPath() {
  for (const entry of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidates = basename(entry) === '.bin'
      ? [join(dirname(entry), 'npm', 'bin', 'npm-cli.js')]
      : [join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  fail('Could not resolve npm-cli.js from PATH');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: options.env ?? SAFE_ENV,
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
  });

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT' ? ` timed out after ${options.timeout ?? COMMAND_TIMEOUT_MS}ms` : '';
    fail(`${command} could not complete${timedOut}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = options.capture ? [result.stderr, result.stdout].filter(Boolean).join('\n').trim() : '';
    const detail = output ? `: ${output}` : '';
    fail(`${command} ${args.join(' ')} failed with exit code ${result.status}${detail}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function runNpm(args, options = {}) {
  return process.platform === 'win32'
    ? run(process.execPath, [npmCliPath(), ...args], options)
    : run('npm', args, options);
}

function findPython() {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      env: SAFE_ENV,
      shell: false,
      timeout: 10_000,
    });
    if (result.status === 0) {
      return { command, version: `${result.stdout}${result.stderr}`.trim().replace(/^Python\s+/, '') };
    }
  }
  fail('Python is required but neither python3 nor python was found');
}

export function validatePagesManifest(root, manifestText) {
  const entries = manifestText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!entries.length) fail('Cloudflare Pages manifest must not be empty');
  const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (duplicates.length) fail(`Cloudflare Pages manifest has duplicate paths: ${[...new Set(duplicates)].join(', ')}`);

  const missingRequired = REQUIRED_PAGES_ASSETS.filter((entry) => !entries.includes(entry));
  const unexpected = entries.filter((entry) => !REQUIRED_PAGES_ASSETS.includes(entry));
  if (missingRequired.length) fail(`Cloudflare Pages manifest omits required files: ${missingRequired.join(', ')}`);
  if (unexpected.length) fail(`Cloudflare Pages manifest has unreviewed files: ${unexpected.join(', ')}`);

  for (const entry of entries) {
    const target = resolve(root, entry);
    const fromRoot = relative(resolve(root), target);
    if (isAbsolute(entry) || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      fail(`Cloudflare Pages manifest path escapes the repository: ${entry}`);
    }
    if (!existsSync(target)) fail(`Cloudflare Pages manifest references a missing file: ${entry}`);
    if (!statSync(target).isFile()) fail(`Cloudflare Pages manifest entry is not a file: ${entry}`);
  }
  return entries;
}

export function calculateWebAssetRevision(root, entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort()) {
    let content = readFileSync(join(root, entry));
    if (/\.(?:css|html|js)$/i.test(entry)) content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
    if (entry === 'sw.js') {
      content = Buffer.from(content.toString('utf8').replace(/^const CACHE = .*;$/m, "const CACHE = '<asset-revision>';"));
    }
    hash.update(entry);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

function attributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? '';
}

function extractTagAttributes(html, tagName) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  return [...withoutComments.matchAll(pattern)].map((match) => match[1]);
}

export function extractAttributeValues(html, tagName, attributeName) {
  return extractTagAttributes(html, tagName)
    .map((attributes) => attributeValue(attributes, attributeName))
    .filter(Boolean);
}

export function extractInlineScripts(html) {
  const scripts = [];
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of withoutComments.matchAll(pattern)) {
    if (!attributeValue(match[1], 'src') && match[2].trim()) {
      scripts.push({ source: match[2], type: attributeValue(match[1], 'type').toLowerCase() });
    }
  }
  return scripts;
}

export function classifyMigration(filename) {
  if (/^\d{3}_VERIFY_.+\.sql$/.test(filename)) return 'verification';
  if (/^\d{3}_(?!VERIFY_).+\.sql$/.test(filename)) return 'migration';
  if (/^_RETRIEVE_.+\.sql$/.test(filename)) return 'retrieval';
  return 'invalid';
}

export function validateMigrations(files, contents = new Map()) {
  const invalid = files.filter((file) => classifyMigration(file) === 'invalid');
  if (invalid.length) fail(`Unexpected SQL migration filenames: ${invalid.join(', ')}`);

  const ids = files
    .filter((file) => classifyMigration(file) === 'migration')
    .map((file) => file.slice(0, 3));
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) fail(`Duplicate primary migration IDs: ${[...new Set(duplicateIds)].join(', ')}`);

  const empty = files.filter((file) => !String(contents.get(file) ?? '').trim());
  if (empty.length) fail(`Empty SQL migration files: ${empty.join(', ')}`);
}

export function validateBrowserDependencies(html) {
  const expectedSupabase = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${TOOLCHAIN.supabaseBrowser}`;
  const scriptSources = extractTagAttributes(html, 'script')
    .filter((attributes) => isExecutableScriptType(attributeValue(attributes, 'type')))
    .map((attributes) => attributeValue(attributes, 'src'))
    .filter(Boolean);
  const stylesheetUrls = extractTagAttributes(html, 'link')
    .filter((attributes) => attributeValue(attributes, 'rel').toLowerCase().split(/\s+/).includes('stylesheet'))
    .map((attributes) => attributeValue(attributes, 'href'))
    .filter(Boolean);
  const supabaseSources = scriptSources.filter((value) => value.includes('@supabase/supabase-js@'));
  const leafletSources = scriptSources.filter((value) => value.includes('unpkg.com/leaflet@'));
  const leafletStyles = stylesheetUrls.filter((value) => value.includes('unpkg.com/leaflet@'));
  if (supabaseSources.length !== 1 || supabaseSources[0] !== expectedSupabase) {
    fail(`index.html must load exactly Supabase browser JS ${TOOLCHAIN.supabaseBrowser}`);
  }
  if (leafletSources.length !== 1 || leafletSources[0] !== 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js') {
    fail('index.html must load exactly Leaflet JS 1.9.4');
  }
  if (leafletStyles.length !== 1 || leafletStyles[0] !== 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css') {
    fail('index.html must load exactly Leaflet CSS 1.9.4');
  }
}

function validatePackage(path, extra = () => {}) {
  const pkg = readJson(path);
  if (pkg.engines?.node !== TOOLCHAIN.node) fail(`${relative(ROOT, path)} must pin Node ${TOOLCHAIN.node}`);
  if (pkg.packageManager !== `npm@${TOOLCHAIN.npm}`) fail(`${relative(ROOT, path)} must pin npm ${TOOLCHAIN.npm}`);
  extra(pkg);
}

function listFiles(path, predicate) {
  const result = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.wrangler') continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath, predicate));
    else if (predicate(fullPath)) result.push(fullPath);
  }
  return result;
}

function withCleanup(path, operation) {
  let originalError;
  try {
    return operation();
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (cleanupError) {
      if (!originalError) throw cleanupError;
      console.error(`Cleanup also failed for ${path}: ${cleanupError.message}`);
    }
  }
}

function validateContracts() {
  if (readText(join(ROOT, '.nvmrc')).trim() !== TOOLCHAIN.node) fail('.nvmrc does not match the supported Node version');
  if (readText(join(ROOT, '.python-version')).trim() !== TOOLCHAIN.python) fail('.python-version does not match the supported Python version');

  validatePackage(join(ROOT, 'mobile', 'package.json'));
  validatePackage(join(ROOT, 'worker', 'package.json'), (pkg) => {
    if (pkg.devDependencies?.wrangler !== TOOLCHAIN.wrangler) fail(`worker must pin Wrangler ${TOOLCHAIN.wrangler}`);
  });
  validatePackage(join(ROOT, 'tools', 'metrics-digest', 'package.json'));
  validatePackage(join(ROOT, 'tools', 'eas-cli', 'package.json'), (pkg) => {
    if (pkg.devDependencies?.['eas-cli'] !== TOOLCHAIN.eas) fail(`tools/eas-cli must pin eas-cli ${TOOLCHAIN.eas}`);
    if (pkg.devDependencies?.['@expo/eas-json'] !== TOOLCHAIN.easJson) fail(`tools/eas-cli must pin @expo/eas-json ${TOOLCHAIN.easJson}`);
    if (pkg.devDependencies?.typescript !== TOOLCHAIN.typescript) fail(`tools/eas-cli must pin TypeScript ${TOOLCHAIN.typescript}`);
  });
  validatePackage(join(ROOT, 'tools', 'supabase-cli', 'package.json'), (pkg) => {
    if (pkg.devDependencies?.supabase !== TOOLCHAIN.supabaseCli) fail(`tools/supabase-cli must pin Supabase CLI ${TOOLCHAIN.supabaseCli}`);
  });

  const eas = readJson(join(ROOT, 'mobile', 'eas.json'));
  if (eas.cli?.version !== TOOLCHAIN.eas) fail(`mobile/eas.json must require eas-cli ${TOOLCHAIN.eas}`);

  validateBrowserDependencies(readText(join(ROOT, 'index.html')));
  const pagesAssets = validatePagesManifest(ROOT, readText(join(ROOT, 'docs', 'cloudflare-pages-manifest.txt')));
  const assetRevision = calculateWebAssetRevision(ROOT, pagesAssets);
  const cacheMatch = readText(join(ROOT, 'sw.js')).match(/^const CACHE = 'gravestory-v(\d+)-([a-f0-9]{12})';/m);
  if (!cacheMatch || Number(cacheMatch[1]) < 70 || cacheMatch[2] !== assetRevision) {
    fail(`sw.js CACHE must be gravestory-v70-or-newer-${assetRevision} for the current deployed asset graph`);
  }

  const migrationDir = join(ROOT, 'supabase-migrations');
  const migrationPaths = listFiles(migrationDir, (path) => /\.sql$/i.test(path));
  const migrationFiles = migrationPaths.map((path) => relative(migrationDir, path));
  validateMigrations(migrationFiles, new Map(migrationPaths.map((path) => [relative(migrationDir, path), readText(path)])));

  const allSql = [
    ...listFiles(migrationDir, (path) => /\.sql$/i.test(path)),
    ...listFiles(join(ROOT, 'queries'), (path) => /\.sql$/i.test(path)),
  ];
  const emptySql = allSql.filter((path) => !readText(path).trim());
  if (emptySql.length) fail(`Empty SQL files: ${emptySql.map((path) => relative(ROOT, path)).join(', ')}`);
  validateDatabaseControl(ROOT, loadDatabaseCatalog(join(ROOT, 'database', 'catalog.json')));
  return pagesAssets;
}

function validateRuntimeVersions() {
  const node = process.versions.node;
  const npm = runNpm(['--version'], { capture: true });
  const python = findPython();
  if (node !== TOOLCHAIN.node) fail(`Expected Node ${TOOLCHAIN.node}; found ${node}`);
  if (npm !== TOOLCHAIN.npm) fail(`Expected npm ${TOOLCHAIN.npm}; found ${npm}`);
  if (python.version !== TOOLCHAIN.python) fail(`Expected Python ${TOOLCHAIN.python}; found ${python.version}`);
  return python.command;
}

function runVerification(install) {
  const python = validateRuntimeVersions();
  const pagesAssets = validateContracts();

  const syntaxFiles = [
    join(ROOT, 'sw.js'),
    join(ROOT, 'worker', 'worker.js'),
    ...listFiles(join(ROOT, 'js'), (path) => path.endsWith('.js')),
    ...listFiles(join(ROOT, 'tools'), (path) => /\.(?:js|mjs)$/.test(path)),
  ];
  for (const file of syntaxFiles) run(process.execPath, ['--check', file]);

  const inlineTemp = mkdtempSync(join(tmpdir(), 'gravestory-inline-'));
  withCleanup(inlineTemp, () => {
    for (const entry of pagesAssets.filter((item) => item.endsWith('.html'))) {
      const scripts = extractInlineScripts(readText(join(ROOT, entry)));
      scripts.forEach(({ source, type }, index) => {
        if (!isExecutableScriptType(type)) return;
        const extension = type === 'module' ? 'mjs' : 'js';
        const scriptPath = join(inlineTemp, `${entry.replace(/[\\/]/g, '-')}-${index}.${extension}`);
        writeFileSync(scriptPath, source);
        run(process.execPath, ['--check', scriptPath]);
      });
    }
  });

  run(process.execPath, ['--test',
    join(ROOT, 'tools', 'tests', 'verify-repo.test.mjs'),
    join(ROOT, 'tools', 'tests', 'database-control.test.mjs'),
    join(ROOT, 'tools', 'tests', 'tester-access.test.mjs'),
  ]);
  run(python, ['-m', 'unittest', 'discover', '-s', '_bmad/scripts/tests', '-p', 'test_*.py', '-v']);

  if (install) {
    for (const directory of ['mobile', 'worker', 'tools/metrics-digest', 'tools/eas-cli', 'tools/supabase-cli']) {
      runNpm(['ci'], { cwd: join(ROOT, directory) });
    }
    const mobileEnv = {
      ...SAFE_ENV,
      GOOGLE_MAPS_ANDROID_API_KEY: '',
      REVENUECAT_API_KEY: '',
    };
    const mobileOutput = join(ROOT, 'mobile', '.expo-verification');
    rmSync(mobileOutput, { recursive: true, force: true });
    withCleanup(mobileOutput, () => {
      runNpm(['run', 'verify:config'], { cwd: join(ROOT, 'mobile'), capture: true, env: mobileEnv });
      runNpm(['run', 'verify:bundle'], { cwd: join(ROOT, 'mobile'), capture: true, env: mobileEnv });
    });
    runNpm(['run', 'verify'], {
      cwd: join(ROOT, 'worker'),
      capture: true,
    });
    runNpm(['run', 'verify'], { cwd: join(ROOT, 'tools', 'metrics-digest'), capture: true });
    runNpm(['run', 'verify'], { cwd: join(ROOT, 'tools', 'eas-cli'), capture: true });
    runNpm(['run', 'verify'], { cwd: join(ROOT, 'tools', 'supabase-cli'), capture: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    runVerification(process.argv.includes('--install'));
    console.log(`\nRepository verification passed${process.argv.includes('--install') ? ' with clean installs' : ''}.`);
  } catch (error) {
    console.error(`\nRepository verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

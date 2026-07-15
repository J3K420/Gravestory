import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import worker from '../worker.js';
import {
  WORKER_CONFIG_CONTRACT,
  featureForPath,
  parseAllowedOrigins,
  validateWorkerConfig,
  validateWorkerFeature,
} from '../config.js';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function productionEnv(overrides = {}) {
  return {
    WORKER_ENV: 'production',
    ALLOWED_ORIGIN: 'https://gravestory.pages.dev,https://j3k420.github.io',
    CLIENT_KEY: 'public-client-key',
    SCAN_TOKEN_ENFORCE: 'false',
    SCAN_TOKEN_SECRET: 'test-scan-secret-at-least-32-bytes',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-service-key',
    ...overrides,
  };
}

test('contract classifies every env binding consumed by worker.js', () => {
  const source = [readFileSync(resolve(workerDir, 'worker.js'), 'utf8'), readFileSync(resolve(workerDir, 'config.js'), 'utf8')].join('\n');
  const consumed = [...new Set([...source.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]))].sort();
  const contracted = WORKER_CONFIG_CONTRACT.map(({ name }) => name).sort();
  assert.deepEqual(contracted, consumed);
  for (const entry of WORKER_CONFIG_CONTRACT) {
    assert.ok(['var', 'secret', 'binding'].includes(entry.kind));
    assert.ok(['required', 'optional', 'feature-gated'].includes(entry.requirement));
    assert.ok(entry.features.length > 0);
  }
});

test('production config accepts explicit transition mode and safe exact origins', () => {
  const result = validateWorkerConfig(productionEnv());
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowedOrigins, ['https://gravestory.pages.dev', 'https://j3k420.github.io']);
});

test('missing security config fails closed without returning values', async () => {
  const env = productionEnv({ ALLOWED_ORIGIN: undefined, CLIENT_KEY: 'do-not-print-this' });
  const result = validateWorkerConfig(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(({ key }) => key === 'ALLOWED_ORIGIN'));
  assert.equal(JSON.stringify(result).includes('do-not-print-this'), false);

  const response = await worker.fetch(new Request('https://worker.test/wikitree'), env, {});
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('do-not-print-this'), false);
});

test('wildcard origins require the explicit local/test harness', () => {
  assert.equal(parseAllowedOrigins('*').ok, false);
  assert.equal(validateWorkerConfig({
    WORKER_ENV: 'local',
    ALLOWED_ORIGIN: '*',
    SCAN_TOKEN_ENFORCE: 'false',
  }).ok, false);
  const local = validateWorkerConfig({
    WORKER_ENV: 'local',
    ALLOWED_ORIGIN: '*',
    SCAN_TOKEN_ENFORCE: 'false',
  }, { allowLocal: true });
  assert.equal(local.ok, true);
  assert.equal(local.allowedOrigins, '*');
});

test('malformed origins and implicit scan-token mode are rejected', () => {
  for (const value of ['', '*', 'http://localhost:8787', 'https://example.com/path', 'https://example.com,']) {
    assert.equal(validateWorkerConfig(productionEnv({ ALLOWED_ORIGIN: value })).ok, false, value);
  }
  for (const value of [undefined, '', 'TRUE', 'yes', false]) {
    assert.equal(validateWorkerConfig(productionEnv({ SCAN_TOKEN_ENFORCE: value })).ok, false, String(value));
  }
  assert.equal(validateWorkerConfig(productionEnv({ SUPABASE_URL: 'https://example.supabase.co/' })).ok, false);
  assert.equal(validateWorkerConfig(productionEnv({ SCAN_TOKEN_SECRET: 'too-short' })).ok, false);
  assert.equal(validateWorkerConfig(productionEnv({ SCAN_TOKEN_SECRET: `short${' '.repeat(32)}` })).ok, false);
  assert.equal(validateWorkerConfig(productionEnv({ SCAN_TOKEN_SECRET: {} })).ok, false);
});

test('feature requirements fail only the route-owned capability', () => {
  assert.equal(validateWorkerFeature({}, 'gemini').ok, false);
  assert.equal(validateWorkerFeature({ GEMINI_KEY: 'test' }, 'gemini').ok, true);
  assert.equal(validateWorkerFeature({ IMAGES: {} }, 'image-storage').ok, false);
  assert.equal(validateWorkerFeature({ IMAGES: { put() {} }, R2_PUBLIC_URL: 'https://images.example.com' }, 'image-storage').ok, true);
  assert.equal(validateWorkerFeature({ IMAGES: { put() {} }, R2_PUBLIC_URL: 'https://images.example.com/' }, 'image-storage').ok, false);
  assert.equal(validateWorkerFeature({ ADMIN_KEY: 'weak' }, 'admin-metrics').ok, false);
  assert.equal(validateWorkerFeature({ ADMIN_KEY: `weak${' '.repeat(32)}` }, 'admin-metrics').ok, false);
  assert.equal(validateWorkerFeature({ REVENUECAT_WEBHOOK_SECRET: 'weak' }, 'revenuecat-webhook').ok, false);
  assert.equal(validateWorkerFeature({ REVENUECAT_WEBHOOK_SECRET: 'webhook-secret-at-least-32-bytes' }, 'revenuecat-webhook').ok, true);
  assert.equal(featureForPath('/gemini/gemini-2.5-flash'), 'gemini');
  assert.equal(featureForPath('/tavily-extract'), 'tavily');
  assert.equal(featureForPath('/wikitree'), '');
});

test('partial optional admin enrichment fails only the admin route', async () => {
  const env = productionEnv({ GCP_SA_EMAIL: 'service@example.test' });
  assert.equal(validateWorkerConfig(env).ok, true);
  const partial = validateWorkerFeature({ ...env, ADMIN_KEY: 'admin-secret-at-least-32-bytes-long' }, 'admin-metrics');
  assert.equal(partial.ok, false);
  assert.deepEqual(
    partial.errors.filter(({ rule }) => rule.includes('admin-gcloud')).map(({ key }) => key).sort(),
    ['GCP_BILLING_TABLE', 'GCP_PROJECT_ID', 'GCP_SA_PRIVATE_KEY'],
  );
  assert.equal(validateWorkerFeature({ ...env, ADMIN_KEY: 'admin-secret-at-least-32-bytes-long', GCLOUD_MONTHLY_BUDGET: '-1' }, 'admin-metrics').ok, false);
  assert.equal(validateWorkerFeature({
    ...env,
    ADMIN_KEY: 'admin-secret-at-least-32-bytes-long',
    GCP_SA_EMAIL: {},
    GCP_SA_PRIVATE_KEY: 'private-key',
    GCP_PROJECT_ID: 'project',
    GCP_BILLING_TABLE: 'project.dataset.table',
  }, 'admin-metrics').ok, false);
  assert.equal(validateWorkerFeature({ ...env, ADMIN_KEY: 'admin-secret-at-least-32-bytes-long', REVENUECAT_SECRET_KEY: {} }, 'admin-metrics').ok, false);

  const unrelated = await worker.fetch(new Request('https://worker.test/wikitree', {
    headers: { 'X-Client-Key': env.CLIENT_KEY },
  }), env, {});
  assert.notEqual(unrelated.status, 503);
});

test('feature configuration failures retain CORS headers without leaking values', async () => {
  const env = productionEnv({ GEMINI_KEY: undefined });
  const response = await worker.fetch(new Request('https://worker.test/gemini/model', {
    method: 'OPTIONS',
    headers: { Origin: 'https://gravestory.pages.dev' },
  }), env, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://gravestory.pages.dev');
  assert.equal((await response.text()).includes(env.SCAN_TOKEN_SECRET), false);

  const adminResponse = await worker.fetch(new Request('https://worker.test/admin/metrics', {
    method: 'OPTIONS',
    headers: { Origin: 'https://local-admin.example' },
  }), env, {});
  assert.equal(adminResponse.status, 503);
  assert.equal(adminResponse.headers.get('Access-Control-Allow-Origin'), 'https://local-admin.example');

  const localFileAdminResponse = await worker.fetch(new Request('https://worker.test/admin/metrics', {
    headers: { Origin: 'null' },
  }), env, {});
  assert.equal(localFileAdminResponse.status, 503);
  assert.equal(localFileAdminResponse.headers.get('Access-Control-Allow-Origin'), 'null');
});

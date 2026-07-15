import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTesterAccess, resolveTesterAccessRequest } from '../tester-access.mjs';

const url = 'https://idbrjonofqrsykqsqpwo.supabase.co';
const key = 'test-production-service-role-key';
const userId = '123e4567-e89b-42d3-a456-426614174000';
const args = [
  '--target', 'production', '--confirm', 'production-write', '--approval', 'approval-123',
  '--user-id', userId, '--unlimited', 'true',
];

test('tester access requires explicit production target, approval, user, value, and approved credentials', () => {
  assert.throws(() => resolveTesterAccessRequest([], {}), /documented tester-access flags/);
  assert.throws(() => resolveTesterAccessRequest([...args.slice(0, -2), '--execute', 'yes'], {}), /documented tester-access flags/);
  assert.throws(() => resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: 'https://attacker.example',
  }), /allowlist/);
  assert.throws(() => resolveTesterAccessRequest([...args, '--user-id', userId], {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  }), /documented tester-access flags/);
  assert.equal(resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  }).unlimited, true);
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('tester access is idempotent and performs no write when the value already matches', async () => {
  const calls = [];
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  const result = await applyTesterAccess(request, async (endpoint, options) => {
    calls.push({ endpoint, options });
    return jsonResponse({ id: userId, app_metadata: { is_unlimited: true } });
  });
  assert.equal(result.changed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('tester access preserves other app metadata and verifies the write response', async () => {
  const calls = [];
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  const result = await applyTesterAccess(request, async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (options.method === 'PUT') return jsonResponse({});
    if (calls.filter(({ options: call }) => call.method === 'GET').length === 1) {
      return jsonResponse({ id: userId, app_metadata: { provider: 'google' } });
    }
    return jsonResponse({ id: userId, app_metadata: { provider: 'google', is_unlimited: true } });
  });
  assert.equal(result.changed, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1].options.body), { app_metadata: { is_unlimited: true } });
  assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
});

test('tester access refuses an empty or mismatched successful lookup', async () => {
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  await assert.rejects(() => applyTesterAccess(request, async () => jsonResponse({})), /requested user/);
});

test('tester access reconciles a committed write after a lost update response', async () => {
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  let call = 0;
  const result = await applyTesterAccess(request, async (endpoint, options) => {
    call += 1;
    if (options.method === 'PUT') throw new Error('request timed out');
    return jsonResponse({ id: userId, app_metadata: { is_unlimited: call > 1 } });
  });
  assert.equal(result.changed, true);
  assert.equal(result.reconciledAfterError, true);
});

test('tester access reports an unknown outcome when post-write reconciliation is unavailable', async () => {
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  let call = 0;
  await assert.rejects(() => applyTesterAccess(request, async () => {
    call += 1;
    if (call === 1) return jsonResponse({ id: userId, app_metadata: {} });
    throw new Error('network unavailable');
  }), /outcome unknown/);
});

test('tester access reports unknown when a timed-out write may commit after stale readbacks', async () => {
  const request = resolveTesterAccessRequest(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: key,
    SUPABASE_PRODUCTION_URL: url,
  });
  let call = 0;
  await assert.rejects(() => applyTesterAccess(request, async (endpoint, options) => {
    call += 1;
    if (options.method === 'PUT') throw new Error('request timed out');
    return jsonResponse({ id: userId, app_metadata: { is_unlimited: false } });
  }), /outcome unknown/);
  assert.equal(call, 4);
});

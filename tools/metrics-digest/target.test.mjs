import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_WINDOW_HOURS, resolveDigestTarget, resolveDigestWindow } from './target.mjs';

const localKey = 'test-local-service-role-key';
const productionKey = 'test-production-service-role-key';
const productionUrl = 'https://idbrjonofqrsykqsqpwo.supabase.co';

test('target selection and confirmation are mandatory and unique', () => {
  assert.throws(() => resolveDigestTarget([], {}), /--target/);
  assert.throws(
    () => resolveDigestTarget(['--target', 'local', '--target', 'production', '--confirm', 'production-read'], {}),
    /--target may be supplied only once/,
  );
  assert.throws(
    () => resolveDigestTarget(['--target', 'local', '--confirm', 'local-read', '--confirm', 'production-read'], {}),
    /--confirm may be supplied only once/,
  );
  assert.throws(
    () => resolveDigestTarget(['--target', 'production'], {
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey,
      SUPABASE_PRODUCTION_URL: productionUrl,
    }),
    /--confirm production-read/,
  );
});

test('local target accepts only local-named credentials and a loopback service', () => {
  const args = ['--target', 'local', '--confirm', 'local-read'];
  const local = resolveDigestTarget(args, { SUPABASE_LOCAL_SERVICE_ROLE_KEY: localKey });
  assert.equal(local.url, 'http://127.0.0.1:54321');
  assert.throws(
    () => resolveDigestTarget(args, {
      SUPABASE_LOCAL_SERVICE_ROLE_KEY: localKey,
      SUPABASE_LOCAL_URL: 'https://project.example',
    }),
    /loopback/,
  );
  assert.throws(
    () => resolveDigestTarget(args, { SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey }),
    /SUPABASE_LOCAL_SERVICE_ROLE_KEY/,
  );
});

test('production target accepts only production-named inputs with an exact HTTPS origin', () => {
  const args = ['--target', 'production', '--confirm', 'production-read'];
  assert.throws(() => resolveDigestTarget(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey,
  }), /explicit exact HTTPS/);
  assert.throws(
    () => resolveDigestTarget(args, {
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey,
      SUPABASE_PRODUCTION_URL: 'https://project.example/path',
    }),
    /explicit exact HTTPS/,
  );
  assert.throws(
    () => resolveDigestTarget(args, {
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey,
      SUPABASE_PRODUCTION_URL: 'https://attacker.example',
    }),
    /allowlist/,
  );
  assert.throws(
    () => resolveDigestTarget(args, {
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: 'paste-the-service-role-key-here',
      SUPABASE_PRODUCTION_URL: productionUrl,
    }),
    /SUPABASE_PRODUCTION_SERVICE_ROLE_KEY/,
  );
  assert.equal(resolveDigestTarget(args, {
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: productionKey,
    SUPABASE_PRODUCTION_URL: productionUrl,
  }).target, 'production');
});

test('digest window is unique, integral, and bounded', () => {
  assert.equal(resolveDigestWindow([]), 24);
  assert.equal(resolveDigestWindow(['--hours', '168']), 168);
  assert.throws(() => resolveDigestWindow(['--hours', '1.5']), /whole number/);
  assert.throws(() => resolveDigestWindow(['--hours']), /requires a value/);
  assert.throws(() => resolveDigestWindow(['--hours', String(MAX_WINDOW_HOURS + 1)]), /whole number/);
  assert.throws(() => resolveDigestWindow(['--hours', '24', '--hours', '48']), /only once/);
});

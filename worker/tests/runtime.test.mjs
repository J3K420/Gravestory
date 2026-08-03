import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import worker from '../worker.js';
import {
  WORKER_DEADLINES_MS,
  WORKER_LOG_CONTRACT,
  WORKER_MAX_UPSTREAM_RESPONSE_BYTES,
  WORKER_ROUTE_OPERATIONS,
  canonicalWorkerRoute,
  emitWorkerLog,
  fetchWithDeadline,
  isDeadlineError,
  isUpstreamBodyLimitError,
  runBestEffortBatchWithinDeadline,
  withDeadline,
} from '../runtime.js';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(workerDir, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

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

function stripJs(source, preserveStrings = false) {
  let output = '';
  let state = 'code';
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line') {
      if (char === '\n') { state = 'code'; output += '\n'; } else output += ' ';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { output += '  '; index++; state = 'code'; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state !== 'code') {
      if (preserveStrings) output += char;
      else output += char === '\n' ? '\n' : ' ';
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if ((state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === String.fromCharCode(96))) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') { output += '  '; index++; state = 'line'; continue; }
    if (char === '/' && next === '*') { output += '  '; index++; state = 'block'; continue; }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === String.fromCharCode(96)) state = 'template';
    output += preserveStrings || state === 'code' ? char : ' ';
  }
  return output;
}

function workerBypasses(source) {
  const allowed = source
    .replace('async fetch(request, env, ctx)', 'async requestHandler(request, env, ctx)')
    .replace('fetchImpl = globalThis.fetch', 'fetchImpl = approvedNetworkPrimitive')
    .replace('sink = console', 'sink = approvedEventSink');
  const code = stripJs(allowed);
  const strings = stripJs(allowed, true);
  return {
    fetch: /\bfetch\b/.test(code) || /\b(?:globalThis|self|window)\s*\[\s*(['"])fetch\1\s*\]/.test(strings),
    console: /\bconsole\b/.test(code) || /\bconsole\s*\[\s*(['"])(?:log|warn|error|info|debug)\1\s*\]/.test(strings),
  };
}

function callRanges(code, callee) {
  const ranges = [];
  const pattern = new RegExp('\\b' + callee + '\\s*\\(', 'g');
  for (const match of code.matchAll(pattern)) {
    const open = code.indexOf('(', match.index);
    let depth = 0;
    for (let index = open; index < code.length; index++) {
      if (code[index] === '(') depth++;
      else if (code[index] === ')' && --depth === 0) {
        ranges.push([open, index]);
        break;
      }
    }
  }
  return ranges;
}

function unboundedBindingCalls(source) {
  const code = stripJs(source);
  const bounded = [
    ...callRanges(code, 'withDeadline'),
    ...callRanges(code, 'runBestEffortBatchWithinDeadline'),
  ];
  return [...code.matchAll(/\benv\.(?:IMAGES|REMEMBRANCE_IMAGES)\.[A-Za-z_$][\w$]*\s*\(/g)]
    .filter((match) => !bounded.some(([start, end]) => start < match.index && match.index < end))
    .map((match) => match[0]);
}

function workerRuntimeSources(directory = workerDir) {
  const sources = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name === '.wrangler') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) sources.push(...workerRuntimeSources(path));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) sources.push(path);
  }
  return sources;
}

test('every Worker upstream deadline is explicit, finite, and bounded', () => {
  assert.deepEqual(Object.keys(WORKER_DEADLINES_MS).sort(), [
    'adminProvider', 'generativeAi', 'overpassMirror', 'r2Binding', 'searchProvider', 'supabase',
  ]);
  for (const deadline of Object.values(WORKER_DEADLINES_MS)) {
    assert.equal(Number.isInteger(deadline), true);
    assert.ok(deadline > 0 && deadline <= 60_000);
  }
  assert.equal(WORKER_MAX_UPSTREAM_RESPONSE_BYTES, 16 * 1024 * 1024);

  let deadlineCalls = 0;
  let bindingCalls = 0;
  for (const path of workerRuntimeSources()) {
    const source = readFileSync(path, 'utf8');
    assert.deepEqual(workerBypasses(source), { fetch: false, console: false }, 'runtime bypass in ' + path);
    assert.deepEqual(unboundedBindingCalls(source), [], 'binding bypass in ' + path);
    deadlineCalls += (source.match(/fetchWithDeadline\s*\(/g) || []).length;
    bindingCalls += (source.match(/\benv\.(?:IMAGES|REMEMBRANCE_IMAGES)\.[A-Za-z_$][\w$]*\s*\(/g) || []).length;
  }
  assert.ok(deadlineCalls >= 19);
  assert.ok(bindingCalls >= 2);
  assert.deepEqual(
    workerBypasses("const f = globalThis['fetch']; console['info']('unsafe')"),
    { fetch: true, console: true },
  );
  assert.deepEqual(unboundedBindingCalls("env.IMAGES.get('key')"), ["env.IMAGES.get("]);
  assert.deepEqual(unboundedBindingCalls("withDeadline(() => env.IMAGES.get('key'), 50)"), []);
  assert.deepEqual(
    unboundedBindingCalls("runBestEffortBatchWithinDeadline(['key'], key => env.IMAGES.get(key), 50, () => {})"),
    [],
  );
});

test('fetch and binding helpers reject work that exceeds its deadline', async () => {
  let observedSignal;
  const hangingFetch = (_input, init) => new Promise((_, reject) => {
    observedSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(
    fetchWithDeadline('https://provider.test', {}, 5, hangingFetch),
    (error) => isDeadlineError(error),
  );
  assert.equal(observedSignal.aborted, true);
  let bodySignal;
  await assert.rejects(
    fetchWithDeadline('https://provider.test', {}, 5, async (_input, init) => {
      bodySignal = init.signal;
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }));
    }),
    (error) => isDeadlineError(error),
  );
  assert.equal(bodySignal.aborted, true);
  const noContent = await fetchWithDeadline(
    'https://provider.test',
    {},
    50,
    async () => new Response(null, { status: 204, headers: { 'X-Test': 'preserved' } }),
  );
  assert.equal(noContent.status, 204);
  assert.equal(noContent.headers.get('X-Test'), 'preserved');
  assert.equal(await noContent.text(), '');
  let limitSignal;
  const limitStarted = Date.now();
  await assert.rejects(
    fetchWithDeadline(
      'https://provider.test',
      {},
      50,
      async (_input, init) => {
        limitSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); },
          cancel: () => new Promise(() => {}),
        }));
      },
      4,
    ),
    (error) => isUpstreamBodyLimitError(error),
  );
  assert.equal(limitSignal.aborted, true);
  assert.ok(Date.now() - limitStarted < 1_000, 'a hanging stream cancel must not delay rejection');
  const attempted = [];
  const batchFailures = [];
  const batchStarted = Date.now();
  await runBestEffortBatchWithinDeadline(
    ['stalled', 'must-not-start'],
    (item) => {
      attempted.push(item);
      return new Promise(() => {});
    },
    5,
    (error, item) => batchFailures.push({ error, item }),
    'binding batch',
  );
  assert.deepEqual(attempted, ['stalled']);
  assert.equal(batchFailures[0].item, 'stalled');
  assert.equal(isDeadlineError(batchFailures[0].error), true);
  assert.ok(Date.now() - batchStarted < 1_000);
  await assert.rejects(withDeadline(() => new Promise(() => {}), 5, 'binding'), (error) => isDeadlineError(error));
  await assert.rejects(fetchWithDeadline('https://provider.test', {}, 0, hangingFetch), /whole number/);
});

test('an inherited abort reaches the deadline-controlled fetch', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(new Error('caller already cancelled'));
  let preAbortedSignal;
  await assert.rejects(
    fetchWithDeadline('https://provider.test', { signal: alreadyAborted.signal }, 1_000, (_input, init) => {
      preAbortedSignal = init.signal;
      return new Promise(() => {});
    }),
    /caller already cancelled/,
  );
  assert.equal(preAbortedSignal.aborted, true);

  const parent = new AbortController();
  const waiting = fetchWithDeadline('https://provider.test', { signal: parent.signal }, 1_000, (_input, init) => (
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  ));
  parent.abort(new Error('caller cancelled'));
  await assert.rejects(waiting, /caller cancelled/);
});

test('a provider deadline becomes a redacted 504 event at the Worker boundary', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const lines = [];
  try {
    globalThis.fetch = async () => {
      const error = new Error('provider response contained sensitive detail');
      error.name = 'TimeoutError';
      error.code = 'WORKER_UPSTREAM_DEADLINE';
      throw error;
    };
    console.error = (line) => lines.push(line);
    const response = await worker.fetch(new Request('https://worker.test/wikitree', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        'Origin': 'https://gravestory.pages.dev',
      },
      body: '{}',
    }), {
      WORKER_ENV: 'production',
      ALLOWED_ORIGIN: 'https://gravestory.pages.dev,https://j3k420.github.io',
      CLIENT_KEY: 'public-client-key',
      SCAN_TOKEN_ENFORCE: 'false',
      SCAN_TOKEN_SECRET: 'test-scan-secret-at-least-32-bytes',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key',
    }, {});
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: 'Upstream timeout' });
    assert.deepEqual(JSON.parse(lines[0]), {
      event: 'worker_request_failed', route: '/wikitree', failure: 'deadline',
    });
    assert.equal(lines.join('\n').includes('sensitive detail'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test('structured Worker events have exact schemas and redact unsafe values', () => {
  assert.equal(new Set(WORKER_LOG_CONTRACT.map(({ event }) => event)).size, WORKER_LOG_CONTRACT.length);
  const lines = [];
  const sink = { warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  emitWorkerLog('worker_request_failed', { route: '/gemini/:model', failure: 'deadline' }, sink);
  const event = JSON.parse(lines[0]);
  assert.deepEqual(event, { event: 'worker_request_failed', route: '/gemini/:model', failure: 'deadline' });

  emitWorkerLog('worker_request_failed', { route: '/path?token=secret-value', failure: 'Bearer secret-value' }, sink);
  assert.equal(lines[1].includes('secret-value'), false);
  assert.deepEqual(JSON.parse(lines[1]), { event: 'worker_request_failed', route: 'redacted', failure: 'redacted' });
  emitWorkerLog('scan_reservation_failed', { status: 999 }, sink);
  assert.equal(JSON.parse(lines[2]).status, 'redacted');
  emitWorkerLog('webhook_record_failed', { failure: 'response', correlation: '0123456789abcdef' }, sink);
  assert.deepEqual(JSON.parse(lines[3]), {
    event: 'webhook_record_failed', failure: 'response', correlation: '0123456789abcdef',
  });
  emitWorkerLog('webhook_record_failed', { failure: 'response', correlation: 'raw-user-id' }, sink);
  assert.equal(JSON.parse(lines[4]).correlation, 'redacted');
  assert.throws(() => emitWorkerLog('worker_request_failed', { route: '/', failure: 'exception', detail: 'no' }, sink), /requires exactly/);
  assert.throws(() => emitWorkerLog('unknown', {}, sink), /Unknown Worker log event/);
});

test('every Worker route has a duplicate-delivery disposition', () => {
  const expected = [
    '/admin/metrics', '/admin/remembrance-photo', '/begin-scan', '/commit-scan', '/create-remembrance', '/delete-account', '/delete-story-photos', '/discard-story-photo',
    '/gemini-jwt/:model', '/gemini/:model', '/moderate-remembrance', '/overpass', '/revenuecat-webhook', '/set-remembrance-visibility', '/story-photo', '/tavily', '/tavily-extract',
    '/upload-image', '/upload-story-photo', '/wikitree',
  ].sort();
  assert.deepEqual(WORKER_ROUTE_OPERATIONS.map(({ route }) => route).sort(), expected);
  const source = read('worker/worker.js');
  const exactRoutes = [...source.matchAll(/url\.pathname === '([^']+)'/g)].map((match) => match[1]);
  const prefixRoutes = [...source.matchAll(/url\.pathname\.startsWith\('([^']+)'\)/g)].map((match) => `${match[1]}:model`);
  assert.deepEqual([...new Set([...exactRoutes, ...prefixRoutes])].sort(), expected);
  for (const operation of WORKER_ROUTE_OPERATIONS) {
    assert.ok(operation.evidence.length >= 40);
    assert.ok(['GET', 'POST'].includes(operation.method));
    assert.ok(operation.duplicateHandling.length > 0);
  }
  const upload = WORKER_ROUTE_OPERATIONS.find(({ route }) => route === '/upload-image');
  assert.equal(upload.stateChange, true);
  assert.equal(upload.duplicateHandling, 'explicit-exception');
  assert.match(upload.evidence, /non-retrying upload/);
  assert.equal(WORKER_ROUTE_OPERATIONS.find(({ route }) => route === '/begin-scan').duplicateHandling, 'explicit-exception');
  assert.equal(WORKER_ROUTE_OPERATIONS.find(({ route }) => route === '/commit-scan').duplicateHandling, 'side-effect-idempotent');
  assert.equal(WORKER_ROUTE_OPERATIONS.find(({ route }) => route === '/gemini-jwt/:model').duplicateHandling, 'explicit-exception');
  for (const route of ['/gemini/:model', '/tavily', '/tavily-extract']) {
    const operation = WORKER_ROUTE_OPERATIONS.find((candidate) => candidate.route === route);
    assert.equal(operation.duplicateHandling, 'transition-exception');
    assert.match(operation.evidence, /SCAN_TOKEN_ENFORCE=true/);
  }
  assert.equal(canonicalWorkerRoute('/gemini/model-name'), '/gemini/:model');
  assert.equal(canonicalWorkerRoute('/unknown'), 'unmatched');
});

test('remembrance creation validates canonical graves and replays unique conflicts', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '11111111-1111-4111-8111-111111111111';
  const graveId = '22222222-2222-4222-8222-222222222222';
  const storyId = '33333333-3333-4333-8333-333333333333';
  const requests = [];
  let lookupCount = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (url.endsWith('/rest/v1/rpc/find_grave')) {
        assert.deepEqual(JSON.parse(init.body), {
          p_name: 'Ada Lovelace', p_lat: 40.123, p_lng: -74.456,
        });
        return Response.json(graveId);
      }
      if (url.includes('/rest/v1/stories?user_id=eq.')) {
        lookupCount++;
        return Response.json(lookupCount === 1 ? [] : [{ id: storyId, story_type: 'remembrance' }]);
      }
      if (url.endsWith('/rest/v1/stories')) {
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Prefer, 'return=representation');
        return Response.json({ code: '23505' }, { status: 409 });
      }
      throw new Error('unexpected remembrance creation fetch: ' + url);
    };

    const response = await worker.fetch(new Request('https://worker.test/create-remembrance', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-jwt',
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
      body: JSON.stringify({
        clientTimestamp: 1_722_000_000_000,
        name: 'Ada Lovelace',
        remembrance: 'A thoughtful remembrance.',
        termsAcceptedAt: new Date().toISOString(),
        requestedVisibility: 'private',
        graveId,
        latitude: 40.123,
        longitude: -74.456,
      }),
    }), productionEnv({
      R2_PUBLIC_URL: 'https://images.example.test',
      IMAGES: { put() {} },
      REMEMBRANCE_IMAGES: { put() {} },
    }), {});

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      story: { id: storyId, story_type: 'remembrance' }, duplicate: true,
    });
    const insert = requests.find(({ url }) => url.endsWith('/rest/v1/stories'));
    assert.ok(insert);
    assert.equal(insert.url.includes('on_conflict'), false);
    assert.equal(lookupCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('story-photo upload keeps the story id in scope and removes stale-race objects', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '77777777-7777-4777-8777-777777777777';
  const storyId = '88888888-8888-4888-8888-888888888888';
  const expiredUploadId = '99999999-9999-4999-8999-999999999999';
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const cancelledUploadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const expiredKey = `stories/${userId}/${storyId}/${expiredUploadId}.jpg`;
  let claimCalls = 0;
  let confirmationAllowed = true;
  let reservationDisposition = 'write';
  let active = true;
  let puts = 0;
  const deletedKeys = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (url.includes('/rest/v1/stories?') && url.includes('select=id,content_revision')) {
        assert.match(url, /moderation_status=neq\.removed/);
        assert.match(url, /publication_status=neq\.removed/);
        return Response.json([{ id: storyId, content_revision: 3 }]);
      }
      if (url.includes('/rest/v1/stories?') && url.includes('select=id&limit=1')) {
        assert.match(url, /content_revision=eq\.3/);
        return Response.json(active ? [{ id: storyId }] : []);
      }
      if (url.endsWith('/rest/v1/rpc/claim_expired_remembrance_photo_uploads')) {
        claimCalls += 1;
        return Response.json(claimCalls === 1
          ? [{ upload_id: expiredUploadId, object_key: expiredKey }]
          : []);
      }
      if (url.endsWith('/rest/v1/rpc/reserve_remembrance_photo_upload')) {
        return Response.json({ slot: 0, disposition: reservationDisposition });
      }
      if (url.endsWith('/rest/v1/rpc/confirm_remembrance_photo_upload')) {
        return Response.json(confirmationAllowed);
      }
      if (url.endsWith('/rest/v1/rpc/release_remembrance_photo_upload')) {
        return Response.json(true);
      }
      throw new Error('unexpected story-photo upload fetch: ' + url);
    };
    const remembranceImages = {
      put: async (key) => { puts++; assert.match(key, new RegExp(`^stories/${userId}/${storyId}/`)); },
      list: async () => ({ objects: [], truncated: false }),
      delete: async (key) => { deletedKeys.push(key); },
    };
    const env = productionEnv({
      R2_PUBLIC_URL: 'https://images.example.test',
      IMAGES: { put() {} },
      REMEMBRANCE_IMAGES: remembranceImages,
    });
    const request = (requestUploadId = uploadId) => new Request('https://worker.test/upload-story-photo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-jwt',
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
      body: JSON.stringify({
        storyId,
        uploadId: requestUploadId,
        data: btoa('photo-bytes'),
        contentType: 'image/jpeg',
      }),
    });

    const uploaded = await worker.fetch(request(), env, {});
    assert.equal(uploaded.status, 200);
    const uploadedBody = await uploaded.json();
    assert.match(uploadedBody.objectKey, new RegExp(`^stories/${userId}/${storyId}/`));
    assert.equal(uploadedBody.slot, 0);
    assert.deepEqual(deletedKeys, [expiredKey]);

    reservationDisposition = 'linked';
    const replay = await worker.fetch(request(), env, {});
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).objectKey, uploadedBody.objectKey);
    assert.equal(puts, 1, 'an already-linked retry must not overwrite its R2 object');
    assert.deepEqual(deletedKeys, [expiredKey]);

    reservationDisposition = 'busy';
    const busy = await worker.fetch(request(), env, {});
    assert.equal(busy.status, 409);
    assert.deepEqual(await busy.json(), { error: 'This photo upload is already in progress' });
    assert.equal(puts, 1, 'a second writer must not reach R2');
    assert.deepEqual(deletedKeys, [expiredKey]);

    reservationDisposition = 'write';
    confirmationAllowed = false;
    const stale = await worker.fetch(request(cancelledUploadId), env, {});
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: 'Photo upload was cancelled' });
    assert.equal(puts, 2);
    assert.equal(deletedKeys.length, 2);
    assert.equal(deletedKeys[0], expiredKey);
    assert.match(deletedKeys[1], new RegExp(`^stories/${userId}/${storyId}/`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('remembrance deletion is type-scoped, revision-correct, and retry-idempotent', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '44444444-4444-4444-8444-444444444444';
  const storyId = '55555555-5555-4555-8555-555555555555';
  const requests = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (url.includes('/rest/v1/stories?') && init.method !== 'PATCH') {
        assert.match(url, /story_type=eq\.remembrance/);
        assert.match(url, /select=id,content_revision,deleted_at/);
        return Response.json([{ id: storyId, content_revision: 5, deleted_at: null }]);
      }
      if (url.includes('/rest/v1/stories?') && init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        assert.match(url, /story_type=eq\.remembrance/);
        if (body.deleted_at) {
          assert.match(url, /content_revision=eq\.6/);
          assert.equal(body.content_revision, 7);
          return Response.json([{ id: storyId, content_revision: 7, deleted_at: body.deleted_at }]);
        }
        assert.match(url, /content_revision=eq\.5/);
        assert.equal(body.content_revision, 6);
        return Response.json([{ id: storyId, content_revision: 6, deleted_at: null }]);
      }
      if (url.includes('/rest/v1/story_photos?') && init.method !== 'PATCH') {
        assert.match(url, /deleted_at=is\.null/);
        return Response.json([]);
      }
      if (url.includes('/rest/v1/story_photos?') && init.method === 'PATCH') {
        assert.equal(url.includes('content_revision'), false);
        return Response.json([]);
      }
      if (url.includes('/rest/v1/grave_photos?') && init.method === 'PATCH') {
        assert.equal(url.includes('content_revision'), false);
        return Response.json([]);
      }
      throw new Error('unexpected remembrance deletion fetch: ' + url);
    };

    const response = await worker.fetch(new Request('https://worker.test/delete-story-photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-jwt',
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
      body: JSON.stringify({ storyId }),
    }), productionEnv({
      R2_PUBLIC_URL: 'https://images.example.test',
      IMAGES: { put() {} },
      REMEMBRANCE_IMAGES: {
        put() {},
        list: async () => ({ objects: [], truncated: false }),
        delete: async () => {},
      },
    }), {});

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, duplicate: false });
    assert.equal(requests.filter(({ url }) => url.includes('/rest/v1/stories?')).length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a deleted-remembrance retry still removes late R2 objects', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '99999999-9999-4999-8999-999999999999';
  const storyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const lateKey = `stories/${userId}/${storyId}/late-object.jpg`;
  const deletedKeys = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (url.includes('/rest/v1/stories?') && init.method !== 'PATCH') {
        return Response.json([{ id: storyId, content_revision: 7, deleted_at: '2026-08-02T00:00:00.000Z' }]);
      }
      if (url.includes('/rest/v1/story_photos?') && init.method !== 'PATCH') return Response.json([]);
      if (url.includes('/rest/v1/story_photos?') && init.method === 'PATCH') return Response.json([]);
      if (url.includes('/rest/v1/grave_photos?') && init.method === 'PATCH') return Response.json([]);
      if (url.includes('/rest/v1/stories?') && init.method === 'PATCH') {
        throw new Error('an already-deleted retry must not patch the story again');
      }
      throw new Error('unexpected deleted-remembrance retry fetch: ' + url);
    };
    const response = await worker.fetch(new Request('https://worker.test/delete-story-photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-jwt',
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
      body: JSON.stringify({ storyId }),
    }), productionEnv({
      R2_PUBLIC_URL: 'https://images.example.test',
      IMAGES: { put() {} },
      REMEMBRANCE_IMAGES: {
        put() {},
        list: async () => ({ objects: [{ key: lateKey }], truncated: false }),
        delete: async (key) => { deletedKeys.push(key); },
      },
    }), {});

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, duplicate: true });
    assert.deepEqual(deletedKeys, [lateKey]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('operator remembrance moderation is service-role-only and exact-state guarded', () => {
  const migration = read('supabase-migrations/037_remembrance_operator_moderation.sql');
  const runbook = read('docs/remembrance-moderation-runbook.md');
  const workerSource = read('worker/worker.js');
  const mobileApi = read('mobile/src/lib/api-remembrances.js');

  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /DROP INDEX IF EXISTS public\.stories_remembrance_idempotency/);
  assert.match(migration, /stories_remembrance_idempotency[\s\S]*deleted_at IS NULL/);
  assert.match(migration, /story_photos_block_remembrance_deletion/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /confirm_remembrance_photo_upload/);
  assert.match(migration, /writer_token uuid/);
  assert.match(migration, /'disposition', 'linked'/);
  assert.match(migration, /claim_remembrance_photo_upload_discard/);
  assert.match(migration, /r\.writer_token = p_writer_token/);
  assert.match(migration, /uploaded_at IS NOT NULL/);
  assert.match(workerSource, /rpc\/confirm_remembrance_photo_upload/);
  assert.match(
    workerSource,
    /catch \(err\) \{[\s\S]*?if \(isDeadlineError\(err\)\) throw err;[\s\S]*?if \(storyPhoto\)/,
  );
  assert.match(migration, /stories_block_remembrance_reactivation/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.remembrance_photo_uploads/);
  assert.match(migration, /reserve_remembrance_photo_upload[\s\S]*FOR UPDATE/);
  assert.match(migration, /generate_series\(0, 3\)/);
  assert.match(migration, /claim_expired_remembrance_photo_uploads/);
  assert.match(migration, /cleanup_claimed_at IS NULL/);
  assert.match(migration, /cleanup cutoff must be at least 15 minutes old/);
  assert.match(migration, /story_photos_link_remembrance_upload/);
  assert.match(migration, /release_remembrance_photo_upload/);
  assert.match(migration, /REVOKE ALL ON public\.remembrance_photo_uploads FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /session_user NOT IN \('postgres', 'supabase_admin'\)/);
  assert.match(migration, /v_revision IS DISTINCT FROM p_expected_revision/);
  assert.match(migration, /v_current_ids IS DISTINCT FROM v_expected_ids/);
  assert.match(migration, /v_current_keys IS DISTINCT FROM v_expected_keys/);
  assert.match(migration, /p_worker_origin !~ '\^https:/);
  assert.match(migration, /SET image_url = p_worker_origin \|\| '\/story-photo\?key='/);
  assert.match(migration, /replace\(sp\.object_key, '\/', '%2F'\)/);
  assert.match(migration, /v_primary_image_url := p_worker_origin/);
  assert.match(migration, /s\.content_revision = p_expected_revision/);
  assert.match(migration, /s\.moderation_status = 'pending'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.match(runbook, /moderate_remembrance_operator[\s\S]*p_worker_origin/);
  assert.match(runbook, /migration 036 is already applied[\s\S]*do not re-run it/i);
  assert.doesNotMatch(runbook, /update public\.stories\s+set moderation_status/);
  assert.match(workerSource, /rpc\/moderate_remembrance_operator/);
  assert.match(workerSource, /rpc\/reserve_remembrance_photo_upload/);
  assert.match(workerSource, /moderation_status=neq\.removed&publication_status=neq\.removed/);
  assert.match(workerSource, /p_expected_photo_ids: reviewedPhotoIds/);
  assert.match(read('mobile/src/lib/api-r2.js'), /const uploadId = Crypto\.randomUUID\(\)[\s\S]*for \(let attempt = 0; attempt < 2/);
  assert.match(read('mobile/src/lib/api-r2.js'), /await discardStoryPhoto\(storyId, objectKey\)/);
  assert.match(workerSource, /const alreadyDeleted = Boolean\(ownedRows\[0\]\.deleted_at\)/);
  assert.match(mobileApi, /await discardStoryPhoto\(saved\.id, result\.objectKey\)/);
});

test('reservation exceptions and commit replay semantics match the authoritative migration', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const requests = [];
  let commitCalls = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/auth/v1/user')) {
        return Response.json({ id: userId, app_metadata: { is_unlimited: true } });
      }
      if (url.endsWith('/rpc/reserve_scan')) {
        return Response.json({
          allowed: true,
          reservation_id: reservationId,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          used: 99,
          allowance: -1,
        });
      }
      if (url.endsWith('/rpc/commit_reservation')) {
        commitCalls++;
        return Response.json(commitCalls === 1
          ? { committed: true }
          : { committed: false, reason: 'not_pending' });
      }
      throw new Error('unexpected test fetch: ' + url);
    };
    const headers = {
      Authorization: 'Bearer user-jwt',
      'X-Client-Key': 'public-client-key',
      Origin: 'https://gravestory.pages.dev',
    };
    const begin = await worker.fetch(
      new Request('https://worker.test/begin-scan', { method: 'POST', headers }),
      productionEnv(),
      {},
    );
    assert.equal(begin.status, 200);
    const token = (await begin.json()).token;
    const reserveRequest = requests.find(({ url }) => url.endsWith('/rpc/reserve_scan'));
    assert.equal(JSON.parse(reserveRequest.init.body).p_is_unlimited, true);

    const commitHeaders = { ...headers, 'X-Scan-Token': token };
    const first = await worker.fetch(
      new Request('https://worker.test/commit-scan', { method: 'POST', headers: commitHeaders }),
      productionEnv(),
      {},
    );
    const replay = await worker.fetch(
      new Request('https://worker.test/commit-scan', { method: 'POST', headers: commitHeaders }),
      productionEnv(),
      {},
    );
    assert.deepEqual(await first.json(), { committed: true });
    assert.deepEqual(await replay.json(), { committed: false });
    assert.equal(commitCalls, 2);

    const migration = read('supabase-migrations/029_scan_reservations_budget.sql');
    assert.match(migration, /IF NOT p_is_unlimited AND v_used >= v_allowance/);
    assert.match(migration, /AND status\s*=\s*'pending'[\s\S]*IF NOT FOUND[\s\S]*'not_pending'/);
    assert.equal((migration.match(/INSERT INTO public\.scan_events/g) || []).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('paid-route transition mode is an explicit unmetered exception', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  let upstreamCalls = 0;
  try {
    console.warn = (line) => logs.push(JSON.parse(line));
    globalThis.fetch = async (input) => {
      assert.match(String(input), /generativelanguage\.googleapis\.com/);
      upstreamCalls++;
      return Response.json({ candidates: [] });
    };
    const request = () => new Request('https://worker.test/gemini/gemini-2.5-flash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
      body: JSON.stringify({ contents: [] }),
    });
    const transition = await worker.fetch(request(), productionEnv({ GEMINI_KEY: 'test-key' }), {});
    assert.equal(transition.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.ok(logs.some(({ event, reason }) => event === 'scan_token_transition' && reason === 'missing'));

    const enforced = await worker.fetch(
      request(),
      productionEnv({ GEMINI_KEY: 'test-key', SCAN_TOKEN_ENFORCE: 'true' }),
      {},
    );
    assert.equal(enforced.status, 403);
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('unmapped paid webhook events retry until their durable record succeeds', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const eventId = 'revenuecat-event-sensitive-value';
  const logs = [];
  const errors = [];
  try {
    console.warn = (line) => logs.push(line);
    console.error = (line) => errors.push(line);
    globalThis.fetch = async () => new Response('provider detail must stay redacted', { status: 503 });
    const secret = 'webhook-secret-at-least-32-bytes';
    const response = await worker.fetch(new Request('https://worker.test/revenuecat-webhook', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          id: eventId,
          app_user_id: '33333333-3333-4333-8333-333333333333',
          product_id: 'new-paid-sku',
          type: 'NON_SUBSCRIPTION_PURCHASE',
        },
      }),
    }), productionEnv({ REVENUECAT_WEBHOOK_SECRET: secret }), {});
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Could not record unmapped purchase' });
    const recordFailure = logs.map((line) => JSON.parse(line)).find(({ event }) => event === 'webhook_record_failed');
    assert.equal(recordFailure.failure, 'response');
    assert.match(recordFailure.correlation, /^[a-f0-9]{16}$/);
    assert.equal(logs.join('\n').includes(eventId), false);
    assert.equal(logs.join('\n').includes('provider detail'), false);

    globalThis.fetch = async () => {
      const error = new Error('sensitive timeout detail');
      error.name = 'TimeoutError';
      error.code = 'WORKER_UPSTREAM_DEADLINE';
      throw error;
    };
    const timedOut = await worker.fetch(new Request('https://worker.test/revenuecat-webhook', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          id: eventId,
          app_user_id: '33333333-3333-4333-8333-333333333333',
          product_id: 'new-paid-sku',
          type: 'NON_SUBSCRIPTION_PURCHASE',
        },
      }),
    }), productionEnv({ REVENUECAT_WEBHOOK_SECRET: secret }), {});
    assert.equal(timedOut.status, 504);
    assert.deepEqual(await timedOut.json(), { error: 'Upstream timeout' });
    assert.ok(errors.map((line) => JSON.parse(line)).some(
      ({ event, route, failure }) =>
        event === 'worker_request_failed' && route === '/revenuecat-webhook' && failure === 'deadline',
    ));
    assert.equal(errors.join('\n').includes('sensitive timeout detail'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('RevenueCat grant redelivery is idempotent by stable event id', async () => {
  const originalFetch = globalThis.fetch;
  const eventId = 'stable-revenuecat-event-id';
  const rpcBodies = [];
  try {
    globalThis.fetch = async (_input, init = {}) => {
      rpcBodies.push(JSON.parse(init.body));
      return Response.json(rpcBodies.length === 1);
    };
    const secret = 'webhook-secret-at-least-32-bytes';
    const request = () => new Request('https://worker.test/revenuecat-webhook', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          id: eventId,
          app_user_id: '44444444-4444-4444-8444-444444444444',
          product_id: 'gravestory_5_scans',
          type: 'NON_SUBSCRIPTION_PURCHASE',
        },
      }),
    });
    const env = productionEnv({ REVENUECAT_WEBHOOK_SECRET: secret });
    const first = await worker.fetch(request(), env, {});
    const replay = await worker.fetch(request(), env, {});
    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal((await first.json()).credits_added, 5);
    assert.deepEqual(await replay.json(), {
      ok: true,
      action: 'duplicate',
      user_id: '44444444-4444-4444-8444-444444444444',
      event_id: eventId,
    });
    assert.equal(rpcBodies.length, 2);
    assert.equal(rpcBodies[0].p_event_id, eventId);
    assert.equal(rpcBodies[1].p_event_id, eventId);

    const migration = read('supabase-migrations/017_revenuecat_idempotency.sql');
    assert.match(migration, /event_id\s+text PRIMARY KEY/);
    assert.match(migration, /ON CONFLICT \(event_id\) DO NOTHING/);
    assert.match(migration, /GET DIAGNOSTICS v_inserted = ROW_COUNT;[\s\S]*IF v_inserted = 0 THEN[\s\S]*RETURN FALSE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RevenueCat retries ambiguous success bodies and non-FK conflicts', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  const responses = [
    new Response('', { status: 200 }),
    Response.json({}),
    Response.json({ code: '23505', message: 'foreign key relationship cache conflict detail' }, { status: 409 }),
    Response.json({ code: '23503', message: 'foreign key violation detail' }, { status: 409 }),
  ];
  try {
    console.warn = (line) => logs.push(line);
    globalThis.fetch = async () => responses.shift();
    const secret = 'webhook-secret-at-least-32-bytes';
    let sequence = 0;
    const request = () => new Request('https://worker.test/revenuecat-webhook', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          id: 'webhook-negative-' + sequence++,
          app_user_id: '66666666-6666-4666-8666-666666666666',
          product_id: 'gravestory_5_scans',
          type: 'NON_SUBSCRIPTION_PURCHASE',
        },
      }),
    });
    const env = productionEnv({ REVENUECAT_WEBHOOK_SECRET: secret });
    for (let index = 0; index < 2; index++) {
      const ambiguous = await worker.fetch(request(), env, {});
      assert.equal(ambiguous.status, 500);
      assert.deepEqual(await ambiguous.json(), { error: 'Unexpected Supabase RPC response' });
    }
    const nonFkConflict = await worker.fetch(request(), env, {});
    assert.equal(nonFkConflict.status, 500);
    assert.deepEqual(await nonFkConflict.json(), { error: 'Supabase RPC failed', status: 409 });

    const fkConflict = await worker.fetch(request(), env, {});
    assert.equal(fkConflict.status, 200);
    assert.equal((await fkConflict.json()).action, 'dropped');

    const parsedLogs = logs.map((line) => JSON.parse(line));
    assert.equal(parsedLogs.filter(
      ({ event, failure }) => event === 'webhook_transient_failure' || failure === 'response',
    ).length >= 3, true);
    assert.ok(parsedLogs.some(({ event }) => event === 'webhook_permanent_failure'));
    assert.equal(logs.join('\n').includes('relationship cache conflict detail'), false);
    assert.equal(logs.join('\n').includes('foreign key violation detail'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('human review reads only an exact pending private photo and emits an audit event', async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const adminKey = 'admin-secret-at-least-32-bytes-long';
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const storyId = '22222222-2222-4222-8222-222222222222';
  const uploadId = '33333333-3333-4333-8333-333333333333';
  const key = `stories/${ownerId}/${storyId}/${uploadId}.jpg`;
  const logs = [];
  try {
    console.info = (line) => logs.push(line);
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/rest/v1/story_photos?')) {
        assert.match(url, /moderation_status/);
        return Response.json([{ story_id: storyId, user_id: ownerId, moderation_status: 'pending' }]);
      }
      if (url.includes('/rest/v1/stories?')) {
        assert.match(url, /publication_status=eq\.pending/);
        assert.match(url, /moderation_status=eq\.pending/);
        return Response.json([{ id: storyId }]);
      }
      throw new Error('unexpected remembrance review fetch: ' + url);
    };
    const env = productionEnv({
      ADMIN_KEY: adminKey,
      REMEMBRANCE_IMAGES: {
        put() {},
        get: async (requestedKey) => {
          assert.equal(requestedKey, key);
          return {
            body: new TextEncoder().encode('private-photo'),
            httpMetadata: { contentType: 'image/jpeg' },
          };
        },
      },
    });
    const unauthorized = await worker.fetch(new Request(
      `https://worker.test/admin/remembrance-photo?key=${encodeURIComponent(key)}`,
    ), env, {});
    assert.equal(unauthorized.status, 401);

    const response = await worker.fetch(new Request(
      `https://worker.test/admin/remembrance-photo?key=${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${adminKey}`, Origin: 'https://local-admin.example' } },
    ), env, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await response.text(), 'private-photo');
    const audit = logs.map((line) => JSON.parse(line)).find(
      ({ event }) => event === 'remembrance_review_photo_access',
    );
    assert.equal(audit.status, 200);
    assert.match(audit.correlation, /^[a-f0-9]{16}$/);
    assert.equal(logs.join('\n').includes(key), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test('admin fan-out failures stay useful, redacted, and observable', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  try {
    console.warn = (line) => logs.push(line);
    globalThis.fetch = async () => new Response('sensitive provider response detail', { status: 503 });
    const adminKey = 'admin-secret-at-least-32-bytes-long';
    const response = await worker.fetch(new Request('https://worker.test/admin/metrics', {
      headers: {
        Authorization: 'Bearer ' + adminKey,
        Origin: 'https://local-admin.example',
      },
    }), productionEnv({
      ADMIN_KEY: adminKey,
      REVENUECAT_SECRET_KEY: 'test-revenuecat-secret',
      REVENUECAT_PROJECT_ID: 'test-project',
    }), {});
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('sensitive provider response detail'), false);
    const payload = JSON.parse(text);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.summary, { status: 'error', error: 'provider failure' });
    assert.match(payload.revenuecat.reason, /status 503/);
    assert.ok(logs.map((line) => JSON.parse(line)).some(
      ({ event, source, failure }) =>
        event === 'admin_source_failed' && source === 'revenuecat' && failure === 'response',
    ));
    assert.equal(logs.join('\n').includes('sensitive provider response detail'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('account deletion warns on failed R2 URL collection and still completes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const userId = '55555555-5555-4555-8555-555555555555';
  const logs = [];
  let r2Deletes = 0;
  let remembrancesClosed = false;
  try {
    console.warn = (line) => logs.push(line);
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
      if (url.includes('/rest/v1/stories?')
        && url.includes('story_type=eq.remembrance')
        && init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        assert.equal(body.publication_status, 'removed');
        assert.equal(body.moderation_status, 'removed');
        assert.equal(body.is_public, false);
        remembrancesClosed = true;
        return new Response(null, { status: 204 });
      }
      if (url.includes('/rest/v1/stories?') && url.includes('select=image_url')) {
        return new Response('sensitive collection failure', { status: 503 });
      }
      if (url.includes('/rest/v1/grave_photos?') && url.includes('select=image_url')) {
        return Response.json([]);
      }
      if (url.includes('/rest/v1/')) return new Response(null, { status: 204 });
      if (url.includes('/auth/v1/admin/users/')) return new Response(null, { status: 204 });
      throw new Error('unexpected account-deletion fetch: ' + url);
    };
    const response = await worker.fetch(new Request('https://worker.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-jwt',
        'X-Client-Key': 'public-client-key',
        Origin: 'https://gravestory.pages.dev',
      },
    }), productionEnv({
      IMAGES: {
        put() {},
        list() { return { objects: [] }; },
        delete() { r2Deletes++; },
      },
      REMEMBRANCE_IMAGES: {
        put() {},
        list() {
          assert.equal(remembrancesClosed, true);
          return { objects: [] };
        },
        delete() {},
      },
      R2_PUBLIC_URL: 'https://images.example.test',
    }), {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, true);
    assert.equal(r2Deletes, 0);
    const warning = logs.map((line) => JSON.parse(line)).find(
      ({ event, step, failure, status }) =>
        event === 'account_cleanup_failed' &&
        step === 'r2_collect' &&
        failure === 'response' &&
        status === 503,
    );
    assert.match(warning.correlation, /^[a-f0-9]{16}$/);
    assert.equal(logs.join('\n').includes(userId), false);
    assert.equal(logs.join('\n').includes('sensitive collection failure'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('mobile interruption, retry, expiry, and notification boundaries stay explicit', () => {
  const pending = read('mobile/src/lib/pending.js');
  const sync = read('mobile/src/lib/sync.js');
  const notify = read('mobile/src/lib/notify.js');
  const camera = read('mobile/src/screens/CameraScreen.js');

  assert.match(pending, /documentDirectory \+ 'pending\/'/);
  assert.match(pending, /deleteAsync\(uri, \{ idempotent: true \}\)/);
  assert.match(sync, /!s\._pending/);
  assert.match(sync, /_needsCloudSync/);
  assert.match(sync, /deleted_at/);
  assert.match(camera, /const RESEARCH_TIMEOUT_MS = 30000/);
  assert.match(camera, /deletePendingPhoto\(pending\.photoUri\)/);
  assert.match(camera, /AppState\.currentState === 'background'/);
  assert.match(notify, /let _lastReadyStory = null/);
  assert.match(notify, /trigger: null/);
  assert.match(notify, /takeReadyStoryFor\(data\.storyTimestamp\)/);
});

test('runtime documentation covers every EAS profile and terminal factor disposition', () => {
  const operations = read('docs/runtime-operations.md');
  const audit = read('docs/twelve-factor-audit.md');
  for (const profile of ['development', 'preview', 'phase9', 'production']) {
    assert.match(operations, new RegExp(`\\| ${profile} \\|`));
  }
  for (const attachment of [
    'Supabase', 'Cloudflare R2', 'Gemini', 'Tavily search/extract', 'WikiTree',
    'Overpass', 'RevenueCat webhook', 'RevenueCat management API',
    'Google Maps native SDK', 'Google BigQuery billing + OAuth', 'Wikidata SPARQL',
    'Chronicling America', 'Wikipedia / Wikimedia', 'Internet Archive',
    'Nominatim', 'Photon', 'OpenStreetMap tiles',
    'Leaflet / Turf / Supabase browser CDN',
  ]) {
    const escaped = [...attachment]
      .map((char) => '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char)
      .join('');
    assert.match(operations, new RegExp('\\| ' + escaped + ' \\|'));
  }
  for (const factor of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']) {
    assert.match(audit, new RegExp(`\\| ${factor}\\. `));
  }
  for (const disposition of ['implemented', 'compliant', 'platform-managed', 'approval-blocked']) {
    assert.match(audit, new RegExp(`\\| ${disposition} \\|`));
  }
  assert.match(operations, /complete remote staging graph is optional/i);
  assert.match(operations, /pre-001 `public\.stories`/);
  assert.doesNotMatch(audit, /plus the final runtime-operations branch/);
  assert.match(audit, /git log -1 --format=%H -- docs\/twelve-factor-audit\.md/);
});

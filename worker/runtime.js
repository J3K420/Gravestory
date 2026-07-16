export const WORKER_DEADLINES_MS = Object.freeze({
  supabase: 15_000,
  generativeAi: 35_000,
  searchProvider: 20_000,
  overpassMirror: 12_000,
  adminProvider: 20_000,
  r2Binding: 15_000,
});

export const WORKER_MAX_UPSTREAM_RESPONSE_BYTES = 16 * 1024 * 1024;

export const WORKER_ROUTE_OPERATIONS = Object.freeze([
  { route: '/admin/metrics', method: 'GET', stateChange: false, duplicateHandling: 'replayable-read', evidence: 'Fan-out is read-only; the Supabase RPCs are cataloged reporting operations.' },
  { route: '/begin-scan', method: 'POST', stateChange: true, duplicateHandling: 'explicit-exception', evidence: 'Ordinary accounts are bounded by live expiring holds; approval-gated is_unlimited tester accounts deliberately bypass that allowance, and callers must not automatically replay.' },
  { route: '/commit-scan', method: 'POST', stateChange: true, duplicateHandling: 'side-effect-idempotent', evidence: 'commit_reservation changes a pending reservation and inserts one scan event only once; a replay returns committed:false/not_pending rather than repeating either side effect.' },
  { route: '/gemini-jwt/:model', method: 'POST', stateChange: true, duplicateHandling: 'explicit-exception', evidence: 'A verified, ban-capable account is required, but provider generation is unmetered by reservation and currently has no per-user rate limit; clients must not automatically replay.' },
  { route: '/gemini/:model', method: 'POST', stateChange: true, duplicateHandling: 'transition-exception', evidence: 'SCAN_TOKEN_ENFORCE=true atomically spends finite Gemini budget; the explicit false transition mode permits observed legacy calls without a valid token and clients must not automatically replay.' },
  { route: '/tavily', method: 'POST', stateChange: true, duplicateHandling: 'transition-exception', evidence: 'SCAN_TOKEN_ENFORCE=true atomically spends finite Tavily budget; the explicit false transition mode permits observed legacy calls without a valid token and clients must not automatically replay.' },
  { route: '/tavily-extract', method: 'POST', stateChange: true, duplicateHandling: 'transition-exception', evidence: 'SCAN_TOKEN_ENFORCE=true spends the shared finite Tavily budget; the explicit false transition mode permits observed legacy calls without a valid token and clients must not automatically replay.' },
  { route: '/wikitree', method: 'POST', stateChange: false, duplicateHandling: 'replayable-read', evidence: 'The route performs a provider search and does not write GraveStory state.' },
  { route: '/overpass', method: 'POST', stateChange: false, duplicateHandling: 'replayable-read', evidence: 'The route performs a map query and does not write GraveStory state.' },
  { route: '/upload-image', method: 'POST', stateChange: true, duplicateHandling: 'explicit-exception', evidence: 'Current installed clients issue one non-retrying upload after Save; a lost response can leave a random-key orphan, so automatic retry remains prohibited until a versioned idempotency key crosses the installed-client compatibility window.' },
  { route: '/revenuecat-webhook', method: 'POST', stateChange: true, duplicateHandling: 'idempotent', evidence: 'RevenueCat event.id is enforced by the immutable event ledger and grant/clawback RPCs.' },
  { route: '/delete-account', method: 'POST', stateChange: true, duplicateHandling: 'monotonic-exception', evidence: 'Scoped deletes are monotonic, but a completed retry cannot reauthenticate after the auth user is removed; the caller must treat a lost final response as unknown and reconcile by sign-in state.' },
]);

const LOG_EVENTS = Object.freeze({
  worker_request_failed: { level: 'error', fields: ['route', 'failure'] },
  scan_reservation_failed: { level: 'warn', fields: ['status'] },
  scan_commit_failed: { level: 'warn', fields: ['status'] },
  scan_metering_inert: { level: 'error', fields: ['route', 'enforce'] },
  scan_token_transition: { level: 'warn', fields: ['route', 'reason'] },
  scan_budget_transport_failed: { level: 'warn', fields: ['route', 'bucket', 'status'] },
  scan_budget_would_block: { level: 'warn', fields: ['route', 'bucket'] },
  webhook_identifiers_missing: { level: 'warn', fields: ['identityPresent', 'eventReferencePresent', 'productPresent'] },
  webhook_product_unmapped: { level: 'warn', fields: ['operation'] },
  webhook_record_failed: { level: 'warn', fields: ['failure', 'correlation'] },
  webhook_permanent_failure: { level: 'warn', fields: ['operation', 'status', 'correlation'] },
  webhook_transient_failure: { level: 'warn', fields: ['operation', 'status'] },
  account_cleanup_failed: { level: 'warn', fields: ['step', 'status', 'failure', 'correlation'] },
  admin_source_failed: { level: 'warn', fields: ['source', 'failure'] },
});

export const WORKER_LOG_CONTRACT = Object.freeze(Object.entries(LOG_EVENTS).map(([event, value]) => Object.freeze({
  event,
  level: value.level,
  fields: Object.freeze([...value.fields]),
})));

function deadlineError(label) {
  const error = new Error(`${label} deadline exceeded`);
  error.name = 'TimeoutError';
  error.code = 'WORKER_UPSTREAM_DEADLINE';
  return error;
}

function upstreamBodyLimitError() {
  const error = new Error('upstream response body limit exceeded');
  error.name = 'RangeError';
  error.code = 'WORKER_UPSTREAM_BODY_LIMIT';
  return error;
}

function requireDeadline(deadlineMs) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) {
    throw new TypeError('Worker deadline must be a whole number from 1 through 60000 milliseconds');
  }
}

export async function fetchWithDeadline(
  input,
  init = {},
  deadlineMs,
  fetchImpl = globalThis.fetch,
  maxResponseBytes = WORKER_MAX_UPSTREAM_RESPONSE_BYTES,
) {
  requireDeadline(deadlineMs);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError('Worker response limit must be a positive whole number');
  }

  const controller = new AbortController();
  const inherited = init?.signal;
  const inheritAbort = () => controller.abort(inherited.reason);
  let timer;
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(
      controller.signal.reason || deadlineError('upstream fetch'),
    ), { once: true });
  });
  if (inherited?.aborted) inheritAbort();
  else inherited?.addEventListener('abort', inheritAbort, { once: true });
  timer = setTimeout(() => controller.abort(deadlineError('upstream fetch')), deadlineMs);

  try {
    const response = await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      aborted,
    ]);
    // A fetch resolves when headers arrive, not when the response body finishes.
    // Buffer under the same deadline so text/json/stream consumers cannot hang
    // after the timer has already been cleared.
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      const error = upstreamBodyLimitError();
      controller.abort(error);
      throw error;
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
          total += chunk.byteLength;
          if (total > maxResponseBytes) {
            const error = upstreamBodyLimitError();
            controller.abort(error);
            throw error;
          }
          chunks.push(chunk);
        }
      } catch (error) {
        // Cancellation is advisory; never let a provider's cancel hook outlive
        // the deadline or size-limit failure we are already returning.
        void reader.cancel(error).catch(() => {});
        throw error;
      }
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Fetch forbids a body on these statuses even when arrayBuffer() is empty.
    const responseBody = [204, 205, 304].includes(response.status) ? null : body;
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
    inherited?.removeEventListener('abort', inheritAbort);
  }
}

export async function withDeadline(operation, deadlineMs, label = 'upstream operation') {
  requireDeadline(deadlineMs);
  if (typeof operation !== 'function') throw new TypeError('A deadline operation must be a function');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(deadlineError(label)), deadlineMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runBestEffortBatchWithinDeadline(
  items,
  operation,
  deadlineMs,
  onFailure,
  label = 'upstream batch',
) {
  requireDeadline(deadlineMs);
  if (typeof operation !== 'function' || typeof onFailure !== 'function') {
    throw new TypeError('A batch operation and failure handler are required');
  }
  const deadlineAt = Date.now() + deadlineMs;
  for (const item of items) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1) {
      onFailure(deadlineError(label), item);
      break;
    }
    try {
      await withDeadline(() => operation(item), remaining, label);
    } catch (error) {
      onFailure(error, item);
      if (isDeadlineError(error)) break;
    }
  }
}

export function isDeadlineError(error) {
  return error?.code === 'WORKER_UPSTREAM_DEADLINE' || error?.name === 'TimeoutError';
}

export function isUpstreamBodyLimitError(error) {
  return error?.code === 'WORKER_UPSTREAM_BODY_LIMIT';
}

export async function correlationFor(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalWorkerRoute(pathname) {
  if (pathname.startsWith('/gemini-jwt/')) return '/gemini-jwt/:model';
  if (pathname.startsWith('/gemini/')) return '/gemini/:model';
  return WORKER_ROUTE_OPERATIONS.some(({ route }) => route === pathname) ? pathname : 'unmatched';
}

const LOG_ENUMS = Object.freeze({
  route: new Set([...WORKER_ROUTE_OPERATIONS.map(({ route }) => route), 'unmatched']),
  failure: new Set(['deadline', 'exception', 'response']),
  reason: new Set(['missing', 'invalid_or_expired']),
  bucket: new Set(['gemini', 'tavily']),
  operation: new Set(['grant', 'clawback']),
  source: new Set(['supabase_summary', 'supabase_funnel', 'daily_series', 'revenuecat', 'google_cloud']),
  step: new Set([
    'analytics_events_delete', 'content_reports_anonymize', 'grave_photos_delete',
    'graves_corrected_by', 'graves_marker_set_by', 'r2_collect', 'r2_delete',
    'scan_credits_delete', 'scan_events_delete', 'stories_delete',
    'tributes_delete', 'user_prefs_delete',
  ]),
});

function safeLogValue(field, value) {
  if (field === 'correlation') {
    return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value) ? value : 'redacted';
  }
  if (field === 'status') {
    return value == null || (Number.isInteger(value) && value >= 100 && value <= 599) ? value : 'redacted';
  }
  if (['enforce', 'identityPresent', 'eventReferencePresent', 'productPresent'].includes(field)) {
    return typeof value === 'boolean' ? value : 'redacted';
  }
  const values = LOG_ENUMS[field];
  return values?.has(value) ? value : 'redacted';
}

export function emitWorkerLog(event, fields, sink = console) {
  const contract = LOG_EVENTS[event];
  if (!contract) throw new TypeError(`Unknown Worker log event: ${event}`);
  const supplied = Object.keys(fields || {}).sort();
  const expected = [...contract.fields].sort();
  if (supplied.length !== expected.length || supplied.some((field, index) => field !== expected[index])) {
    throw new TypeError(`Worker log event ${event} requires exactly: ${expected.join(', ')}`);
  }
  const record = { event };
  for (const field of contract.fields) record[field] = safeLogValue(field, fields[field]);
  sink[contract.level](JSON.stringify(record));
}

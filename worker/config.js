export const WORKER_CONFIG_CONTRACT = Object.freeze([
  { name: 'WORKER_ENV', kind: 'var', requirement: 'required', features: ['all'], sensitive: false },
  { name: 'ALLOWED_ORIGIN', kind: 'var', requirement: 'required', features: ['cors'], sensitive: false },
  { name: 'CLIENT_KEY', kind: 'secret', requirement: 'required', features: ['client-auth'], sensitive: false },
  { name: 'SCAN_TOKEN_ENFORCE', kind: 'var', requirement: 'required', features: ['scan-metering'], sensitive: false },
  { name: 'SCAN_TOKEN_SECRET', kind: 'secret', requirement: 'required', features: ['scan-metering'], sensitive: true },
  { name: 'SUPABASE_URL', kind: 'var', requirement: 'required', features: ['auth', 'scan-metering', 'account', 'webhook'], sensitive: false },
  { name: 'SUPABASE_SERVICE_KEY', kind: 'secret', requirement: 'required', features: ['auth', 'scan-metering', 'account', 'webhook'], sensitive: true },
  { name: 'GEMINI_KEY', kind: 'secret', requirement: 'feature-gated', features: ['gemini'], sensitive: true },
  { name: 'TAVILY_KEY', kind: 'secret', requirement: 'feature-gated', features: ['tavily'], sensitive: true },
  { name: 'IMAGES', kind: 'binding', requirement: 'feature-gated', features: ['image-storage'], sensitive: false },
  { name: 'R2_PUBLIC_URL', kind: 'var', requirement: 'feature-gated', features: ['image-storage'], sensitive: false },
  { name: 'ADMIN_KEY', kind: 'secret', requirement: 'feature-gated', features: ['admin-metrics'], sensitive: true },
  { name: 'REVENUECAT_WEBHOOK_SECRET', kind: 'secret', requirement: 'feature-gated', features: ['revenuecat-webhook'], sensitive: true },
  { name: 'REVENUECAT_SECRET_KEY', kind: 'secret', requirement: 'feature-gated', features: ['admin-revenuecat'], sensitive: true },
  { name: 'REVENUECAT_PROJECT_ID', kind: 'var', requirement: 'optional', features: ['admin-revenuecat'], sensitive: false },
  { name: 'GCP_SA_EMAIL', kind: 'secret', requirement: 'feature-gated', features: ['admin-gcloud'], sensitive: true },
  { name: 'GCP_SA_PRIVATE_KEY', kind: 'secret', requirement: 'feature-gated', features: ['admin-gcloud'], sensitive: true },
  { name: 'GCP_PROJECT_ID', kind: 'var', requirement: 'feature-gated', features: ['admin-gcloud'], sensitive: false },
  { name: 'GCP_BILLING_TABLE', kind: 'var', requirement: 'feature-gated', features: ['admin-gcloud'], sensitive: false },
  { name: 'GCLOUD_MONTHLY_BUDGET', kind: 'var', requirement: 'optional', features: ['admin-gcloud'], sensitive: false },
  { name: 'GCLOUD_LAST_SPEND', kind: 'var', requirement: 'optional', features: ['admin-gcloud'], sensitive: false },
]);

export const WORKER_REQUIRED_PRODUCTION = Object.freeze([
  'WORKER_ENV',
  'ALLOWED_ORIGIN',
  'CLIENT_KEY',
  'SCAN_TOKEN_ENFORCE',
  'SCAN_TOKEN_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
]);

export const WORKER_FEATURE_REQUIREMENTS = Object.freeze({
  gemini: ['GEMINI_KEY'],
  tavily: ['TAVILY_KEY'],
  'image-storage': ['IMAGES', 'R2_PUBLIC_URL'],
  'admin-metrics': ['ADMIN_KEY'],
  'revenuecat-webhook': ['REVENUECAT_WEBHOOK_SECRET'],
  'admin-revenuecat': ['REVENUECAT_SECRET_KEY'],
  'admin-gcloud': ['GCP_SA_EMAIL', 'GCP_SA_PRIVATE_KEY', 'GCP_PROJECT_ID', 'GCP_BILLING_TABLE'],
});

const MIN_INDEPENDENT_SECRET_BYTES = 32;

function issue(key, rule) {
  return { key, rule };
}

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function hasStringValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseHttpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseAllowedOrigins(raw, { allowWildcard = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, origins: [], rule: 'required' };
  if (raw.trim() === '*') {
    return allowWildcard
      ? { ok: true, origins: '*', rule: '' }
      : { ok: false, origins: [], rule: 'wildcard is local/test only' };
  }
  const parts = raw.split(',');
  if (parts.some((part) => !part.trim())) return { ok: false, origins: [], rule: 'empty origin entry' };
  const origins = parts.map((part) => parseHttpsOrigin(part.trim()));
  if (origins.some((origin) => !origin)) return { ok: false, origins: [], rule: 'origins must be exact https origins' };
  if (new Set(origins).size !== origins.length) return { ok: false, origins: [], rule: 'origins must be unique' };
  return { ok: true, origins, rule: '' };
}

export function validateWorkerConfig(env, { allowLocal = false } = {}) {
  const errors = [];
  const mode = typeof env.WORKER_ENV === 'string' ? env.WORKER_ENV.trim().toLowerCase() : '';
  const localMode = mode === 'local' || mode === 'test';
  if (!['production', 'local', 'test'].includes(mode)) errors.push(issue('WORKER_ENV', 'must be production, local, or test'));
  if (localMode && !allowLocal) errors.push(issue('WORKER_ENV', 'local/test mode requires the explicit harness'));

  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGIN, { allowWildcard: localMode && allowLocal });
  if (!allowed.ok) errors.push(issue('ALLOWED_ORIGIN', allowed.rule));

  if (!['true', 'false'].includes(env.SCAN_TOKEN_ENFORCE)) {
    errors.push(issue('SCAN_TOKEN_ENFORCE', 'must be explicitly true or false'));
  }

  if (!localMode) {
    for (const key of WORKER_REQUIRED_PRODUCTION) {
      if (!hasStringValue(env[key])) errors.push(issue(key, 'must be a non-empty string in production'));
    }
    if (hasStringValue(env.SCAN_TOKEN_SECRET) && env.SCAN_TOKEN_SECRET.trim() !== env.SCAN_TOKEN_SECRET) {
      errors.push(issue('SCAN_TOKEN_SECRET', 'must not contain surrounding whitespace'));
    }
    if (hasStringValue(env.SCAN_TOKEN_SECRET) && new TextEncoder().encode(env.SCAN_TOKEN_SECRET.trim()).byteLength < 32) {
      errors.push(issue('SCAN_TOKEN_SECRET', 'must be at least 32 bytes in production'));
    }
    if (hasValue(env.SUPABASE_URL) && !parseHttpsOrigin(String(env.SUPABASE_URL))) {
      errors.push(issue('SUPABASE_URL', 'must be an exact https origin'));
    }
  }

  return { ok: errors.length === 0, errors, mode, allowedOrigins: allowed.ok ? allowed.origins : [] };
}

export function validateWorkerFeature(env, feature) {
  const required = WORKER_FEATURE_REQUIREMENTS[feature] ?? [];
  const errors = required
    .filter((key) => key !== 'IMAGES' && !hasStringValue(env[key]))
    .map((key) => issue(key, `must be a non-empty string for ${feature}`));
  const independentSecret = feature === 'admin-metrics'
    ? 'ADMIN_KEY'
    : feature === 'revenuecat-webhook' ? 'REVENUECAT_WEBHOOK_SECRET' : '';
  if (independentSecret && hasStringValue(env[independentSecret])) {
    const secret = env[independentSecret];
    if (secret.trim() !== secret) errors.push(issue(independentSecret, `must not contain surrounding whitespace for ${feature}`));
    if (new TextEncoder().encode(secret.trim()).byteLength < MIN_INDEPENDENT_SECRET_BYTES) {
      errors.push(issue(independentSecret, `must be at least ${MIN_INDEPENDENT_SECRET_BYTES} bytes for ${feature}`));
    }
  }
  if (feature === 'image-storage') {
    if (!env.IMAGES || typeof env.IMAGES.put !== 'function') errors.push(issue('IMAGES', 'must be an R2 binding for image-storage'));
    if (hasValue(env.R2_PUBLIC_URL) && !parseHttpsOrigin(String(env.R2_PUBLIC_URL))) {
      errors.push(issue('R2_PUBLIC_URL', 'must be an exact https origin'));
    }
  }
  if (feature === 'admin-metrics') {
    const gcpKeys = ['GCP_SA_EMAIL', 'GCP_SA_PRIVATE_KEY', 'GCP_PROJECT_ID', 'GCP_BILLING_TABLE'];
    const malformedGcp = gcpKeys.filter((key) => hasValue(env[key]) && !hasStringValue(env[key]));
    for (const key of malformedGcp) errors.push(issue(key, 'must be a non-empty string when admin-gcloud is configured'));
    const suppliedGcp = gcpKeys.filter((key) => hasStringValue(env[key]));
    if (suppliedGcp.length > 0 && suppliedGcp.length !== gcpKeys.length) {
      for (const key of gcpKeys.filter((item) => !suppliedGcp.includes(item))) errors.push(issue(key, 'required when admin-gcloud is configured'));
    }
    for (const key of ['REVENUECAT_SECRET_KEY', 'REVENUECAT_PROJECT_ID']) {
      if (hasValue(env[key]) && !hasStringValue(env[key])) errors.push(issue(key, 'must be a non-empty string when admin-revenuecat is configured'));
    }
    for (const key of ['GCLOUD_MONTHLY_BUDGET', 'GCLOUD_LAST_SPEND']) {
      if (hasValue(env[key]) && (!Number.isFinite(Number(env[key])) || Number(env[key]) < 0)) {
        errors.push(issue(key, 'must be a non-negative number'));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function featureForPath(pathname) {
  if (pathname.startsWith('/gemini/')) return 'gemini';
  if (pathname.startsWith('/gemini-jwt/')) return 'gemini';
  if (pathname === '/tavily' || pathname === '/tavily-extract') return 'tavily';
  if (pathname === '/upload-image') return 'image-storage';
  if (pathname === '/admin/metrics') return 'admin-metrics';
  if (pathname === '/revenuecat-webhook') return 'revenuecat-webhook';
  return '';
}

const CONFIRMATIONS = Object.freeze({
  local: 'local-read',
  production: 'production-read',
});

const TARGET_INPUTS = Object.freeze({
  local: {
    url: 'SUPABASE_LOCAL_URL',
    key: 'SUPABASE_LOCAL_SERVICE_ROLE_KEY',
  },
  production: {
    url: 'SUPABASE_PRODUCTION_URL',
    key: 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY',
  },
});

export const MAX_WINDOW_HOURS = 24 * 365;

function valueAfter(args, flag) {
  const indexes = args.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} may be supplied only once`);
  if (indexes.length === 0) return undefined;
  const value = args[indexes[0] + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function exactOrigin(raw, protocol) {
  try {
    const url = new URL(raw);
    return url.protocol === protocol && url.origin === raw && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function requireCredential(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim() || value.startsWith('paste-')) {
    throw new Error(`Missing ${name} for the selected target`);
  }
  return value;
}

export function resolveDigestTarget(args, env) {
  const target = valueAfter(args, '--target');
  if (!Object.hasOwn(CONFIRMATIONS, target)) {
    throw new Error('--target must be explicitly set to local or production');
  }
  const confirmation = valueAfter(args, '--confirm');
  if (confirmation !== CONFIRMATIONS[target]) {
    throw new Error(`--target ${target} requires --confirm ${CONFIRMATIONS[target]}`);
  }

  const inputs = TARGET_INPUTS[target];
  let url;
  if (target === 'local') {
    url = env[inputs.url] || 'http://127.0.0.1:54321';
    const parsed = exactOrigin(url, 'http:');
    if (!parsed || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      throw new Error(`Local target requires an exact loopback HTTP ${inputs.url}`);
    }
  } else {
    url = requireApprovedProductionOrigin(env[inputs.url] || '', inputs.url);
  }

  return { target, url, serviceKey: requireCredential(env, inputs.key) };
}

export function resolveDigestWindow(args) {
  const raw = valueAfter(args, '--hours');
  const hours = raw === undefined ? 24 : Number(raw);
  if (!Number.isInteger(hours) || hours <= 0 || hours > MAX_WINDOW_HOURS) {
    throw new Error(`--hours must be a whole number from 1 through ${MAX_WINDOW_HOURS}`);
  }
  return hours;
}
import { requireApprovedProductionOrigin } from '../supabase-target-policy.mjs';

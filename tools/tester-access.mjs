#!/usr/bin/env node
// @database-operation tester-unlimited-toggle

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireApprovedProductionOrigin } from './supabase-target-policy.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 15_000;

function valueAfter(args, flag) {
  const indexes = args.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length !== 1) throw new Error(`${flag} must be supplied exactly once`);
  const value = args[indexes[0] + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function requireCredential(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim() || value.startsWith('paste-')) throw new Error(`Missing ${name}`);
  return value;
}

export function resolveTesterAccessRequest(args, env) {
  const allowedFlags = new Set(['--target', '--confirm', '--approval', '--user-id', '--unlimited']);
  if (args.length !== allowedFlags.size * 2 || args.some((value, index) => index % 2 === 0 && !allowedFlags.has(value))) {
    throw new Error('Only the documented tester-access flags are accepted');
  }
  if (valueAfter(args, '--target') !== 'production') throw new Error('--target must be production');
  if (valueAfter(args, '--confirm') !== 'production-write') throw new Error('--confirm must be production-write');
  const approval = valueAfter(args, '--approval');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(approval)) throw new Error('--approval must be a recorded approval reference');
  const userId = valueAfter(args, '--user-id');
  if (!UUID.test(userId)) throw new Error('--user-id must be an explicit UUID');
  const unlimitedRaw = valueAfter(args, '--unlimited');
  if (!['true', 'false'].includes(unlimitedRaw)) throw new Error('--unlimited must be true or false');
  const url = requireApprovedProductionOrigin(env.SUPABASE_PRODUCTION_URL ?? '', 'SUPABASE_PRODUCTION_URL');
  const serviceKey = requireCredential(env, 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY');
  return { approval, serviceKey, unlimited: unlimitedRaw === 'true', url, userId };
}

async function responseJson(response, operation) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${operation} failed (${response.status}): ${body.message ?? body.error ?? 'unknown error'}`);
  return body;
}

export async function applyTesterAccess(request, fetchImpl = fetch) {
  const endpoint = `${request.url}/auth/v1/admin/users/${encodeURIComponent(request.userId)}`;
  const headers = {
    apikey: request.serviceKey,
    Authorization: `Bearer ${request.serviceKey}`,
    'Content-Type': 'application/json',
  };
  const readUser = async (operation) => {
    const user = await responseJson(await fetchImpl(endpoint, {
      headers,
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }), operation);
    if (user.id !== request.userId) throw new Error(`${operation} did not return the requested user`);
    return user;
  };
  const beforeUser = await readUser('Tester lookup');
  const before = beforeUser.app_metadata?.is_unlimited === true;
  if (before === request.unlimited) return { approval: request.approval, before, after: before, changed: false, userId: request.userId };
  let updateError;
  try {
    await responseJson(await fetchImpl(endpoint, {
      body: JSON.stringify({ app_metadata: { is_unlimited: request.unlimited } }),
      headers,
      method: 'PUT',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }), 'Tester update');
  } catch (error) {
    updateError = error;
  }
  let afterUser;
  let verificationError;
  for (const operation of ['Tester verification', 'Tester reconciliation']) {
    try {
      const candidate = await readUser(operation);
      if (!Object.hasOwn(candidate.app_metadata ?? {}, 'is_unlimited')) throw new Error(`${operation} returned no explicit is_unlimited value`);
      if ((candidate.app_metadata.is_unlimited === true) !== request.unlimited && operation === 'Tester verification') {
        verificationError = new Error('Tester verification still showed the previous value');
        continue;
      }
      afterUser = candidate;
      break;
    } catch (error) {
      verificationError = error;
    }
  }
  if (!afterUser) {
    throw new Error(`Tester update outcome unknown; ${updateError?.message ?? 'update response received'}, reconciliation failed: ${verificationError.message}`);
  }
  const after = afterUser.app_metadata?.is_unlimited === true;
  if (after !== request.unlimited) {
    throw new Error(`Tester update outcome unknown; observed is_unlimited=${after} after reconciliation. ${updateError?.message ?? 'update response was received'}`);
  }
  return { approval: request.approval, before, after, changed: true, reconciledAfterError: Boolean(updateError), userId: request.userId };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const request = resolveTesterAccessRequest(process.argv.slice(2), process.env);
    const result = await applyTesterAccess(request);
    console.log(JSON.stringify({ ...result, completedAt: new Date().toISOString(), target: new URL(request.url).origin }, null, 2));
  } catch (error) {
    console.error(`Tester access failed: ${error.message}`);
    process.exitCode = 1;
  }
}

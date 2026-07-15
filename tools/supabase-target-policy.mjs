export const APPROVED_PRODUCTION_ORIGINS = new Set([
  'https://idbrjonofqrsykqsqpwo.supabase.co',
]);

export function requireApprovedProductionOrigin(raw, inputName) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Production target requires an explicit exact HTTPS ${inputName}`);
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== raw || parsed.username || parsed.password) {
    throw new Error(`Production target requires an explicit exact HTTPS ${inputName}`);
  }
  if (!APPROVED_PRODUCTION_ORIGINS.has(raw)) {
    throw new Error(`${inputName} is not in the reviewed production-origin allowlist`);
  }
  return raw;
}

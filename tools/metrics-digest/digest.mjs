#!/usr/bin/env node
// GraveStory — local metrics digest
// ----------------------------------
// Reads the funnel telemetry (analytics_events) + scan_events + scan_credits +
// stories from Supabase and prints a "what changed" report for the last N hours.
//
// WHY LOCAL (not a /schedule cloud routine): the analytics_events / scan_events /
// scan_credits tables have NO SELECT policy by design — reads require the SERVICE
// ROLE key, which must never live in the git repo a cloud agent checks out. So this
// runs from YOUR machine where the key sits safely in a gitignored .env.
//
// Design principle (from the launch to-do): LEAD with what changed. Say "quiet day"
// loudly when nothing moved. Most days should be a glanceable block; the day a number
// jumps, you notice. No wallpaper.
//
// Usage:
//   node tools/metrics-digest/digest.mjs --target local --confirm local-read
//   node tools/metrics-digest/digest.mjs --target production --confirm production-read --hours 168
//   node tools/metrics-digest/digest.mjs --target production --confirm production-read --json
//
// Setup: copy .env.example -> .env, paste the selected target's inputs. See README.md.
// @database-operation metrics-digest

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveDigestTarget, resolveDigestWindow } from './target.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tiny .env loader (no dependency) ───────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    // No .env file — rely on real environment variables.
  }
}
loadEnv();

const args = process.argv.slice(2);
let selectedTarget;
let windowHours;
try {
  selectedTarget = resolveDigestTarget(args, process.env);
  windowHours = resolveDigestWindow(args);
} catch (error) {
  console.error(`\n  ✗ ${error.message}`);
  console.error('    Local:      node digest.mjs --target local --confirm local-read');
  console.error('    Production: node digest.mjs --target production --confirm production-read');
  process.exit(1);
}
const { target: TARGET, url: SUPABASE_URL, serviceKey: SERVICE_KEY } = selectedTarget;

// ── Args ───────────────────────────────────────────────────────────
const asJson = args.includes('--json');
const WINDOW_HOURS = windowHours;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = Date.now();
const winMs = WINDOW_HOURS * 3600 * 1000;
const curStart = new Date(now - winMs).toISOString();        // window: [curStart, now]
const prevStart = new Date(now - 2 * winMs).toISOString();   // prior:  [prevStart, curStart]

// ── Helpers ────────────────────────────────────────────────────────
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// Arrow + delta vs the prior identical window. Quiet when flat.
function delta(cur, prev) {
  const d = cur - prev;
  if (d === 0) return '·  (flat)';
  const arrow = d > 0 ? '▲' : '▼';
  const sign = d > 0 ? '+' : '';
  return `${arrow} ${sign}${d} vs prior ${WINDOW_HOURS}h`;
}

// Count rows matching a filter without pulling the data (head + count: 'exact').
async function count(table, build) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count: c, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return c ?? 0;
}

// Pull analytics_events in a window (we aggregate client-side — small volume).
async function fetchEvents(sinceIso, untilIso) {
  let q = supabase
    .from('analytics_events')
    .select('event, props, platform, user_id, created_at')
    .gte('created_at', sinceIso)
    // DESC so the 50k cap drops the OLDEST events, not the newest (a window over
    // 50k would otherwise hide the most recent activity).
    .order('created_at', { ascending: false })
    .limit(50000);
  if (untilIso) q = q.lt('created_at', untilIso);
  const { data, error } = await q;
  if (error) throw new Error(`analytics_events: ${error.message}`);
  return data ?? [];
}

function tally(events) {
  const byEvent = {};
  for (const e of events) byEvent[e.event] = (byEvent[e.event] || 0) + 1;
  return byEvent;
}

// ── Gather ─────────────────────────────────────────────────────────
async function main() {
  const [curEvents, prevEvents] = await Promise.all([
    fetchEvents(curStart, null),
    fetchEvents(prevStart, curStart),
  ]);

  const cur = tally(curEvents);
  const prev = tally(prevEvents);
  const ev = (name) => cur[name] || 0;
  const evPrev = (name) => prev[name] || 0;

  // Scan + revenue tables (totals + windowed where the schema allows).
  const [scansWindow, scansTotal, publicTotal, storiesWindow] = await Promise.all([
    // scan_events' timestamp column is `scanned_at` (migration 004), NOT
    // created_at — filtering on created_at silently returned 0/garbage.
    count('scan_events', (q) => q.gte('scanned_at', curStart)).catch(() => null),
    count('scan_events').catch(() => null),
    count('stories', (q) => q.eq('is_public', true).is('deleted_at', null)).catch(() => null),
    count('stories', (q) => q.gte('created_at', curStart).is('deleted_at', null)).catch(() => null),
  ]);

  // scan_credits: recent purchase bumps (the fragile webhook link).
  let recentCredits = [];
  try {
    const { data } = await supabase
      .from('scan_credits')
      .select('user_id, purchased, updated_at')
      .gte('updated_at', curStart)
      .order('updated_at', { ascending: false })
      .limit(20);
    recentCredits = data ?? [];
  } catch { /* table may be locked — non-fatal */ }

  // ── Derived funnel ───────────────────────────────────────────────
  const started = ev('scan_started');
  const ocr = ev('ocr_done');
  const bio = ev('bio_shown');
  const saved = ev('story_saved');
  const madePublic = ev('made_public');
  const limitHit = ev('scan_limit_hit');
  const errors = ev('pipeline_error');
  const cacheHit = ev('bio_cache_hit');

  // Cemetery-resolution rate (#1b hypothesis test).
  const cemResolvedEvents = curEvents.filter((e) => e.event === 'cemetery_resolved');
  const cemResolved = cemResolvedEvents.filter((e) => e.props?.resolved === true).length;
  const cemTotal = cemResolvedEvents.length;

  // Research yield averages (Tavily cost justification).
  const yields = curEvents.filter((e) => e.event === 'research_yield').map((e) => e.props || {});
  const avgYield = (key) =>
    yields.length ? (yields.reduce((s, y) => s + (Number(y[key]) || 0), 0) / yields.length) : 0;
  const dryScans = yields.filter(
    (y) => !y.tavily && !y.wikitree && !y.wikidata && !y.chronicling && !y.archive && !y.wikipedia
  ).length;

  // Guest vs signed-in scans (conversion pressure).
  const guestStarts = curEvents.filter((e) => e.event === 'scan_started' && !e.user_id).length;
  const signedStarts = started - guestStarts;

  const report = {
    target: TARGET,
    window_hours: WINDOW_HOURS,
    generated_at: new Date(now).toISOString(),
    funnel: { started, ocr, bio, saved, madePublic, limitHit, errors, cacheHit },
    engagement: {
      map_opened: ev('map_opened'),
      tribute_left: ev('tribute_left'),
      story_shared: ev('story_shared'),
      sample_viewed: ev('sample_viewed'),
    },
    monetization: {
      paywall_shown: ev('paywall_shown'),
      purchase_completed: ev('purchase_completed'),
      purchase_failed: ev('purchase_failed'),
      recent_credit_rows: recentCredits.length,
    },
    cemetery_resolution: { resolved: cemResolved, total: cemTotal, rate_pct: pct(cemResolved, cemTotal) },
    research_yield: {
      scans: yields.length,
      dry_scans: dryScans,
      avg: {
        tavily: +avgYield('tavily').toFixed(2),
        wikitree: +avgYield('wikitree').toFixed(2),
        wikidata: +avgYield('wikidata').toFixed(2),
        chronicling: +avgYield('chronicling').toFixed(2),
        archive: +avgYield('archive').toFixed(2),
        wikipedia: +avgYield('wikipedia').toFixed(2),
      },
    },
    totals: { scans_all_time: scansTotal, scans_window: scansWindow, public_stories: publicTotal, new_stories_window: storiesWindow },
    raw_event_counts: cur,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Human report ─────────────────────────────────────────────────
  const L = [];
  const win = WINDOW_HOURS === 24 ? 'last 24h' : `last ${WINDOW_HOURS}h`;
  L.push('');
  L.push(`  GRAVESTORY — metrics digest (${win}; target=${TARGET})`);
  L.push(`  ${new Date(now).toLocaleString()}`);
  L.push('  ' + '─'.repeat(54));

  // Headline: did anything happen?
  const totalEvents = curEvents.length;
  if (totalEvents === 0) {
    L.push('');
    L.push('  ▁ QUIET — no product events in this window.');
    L.push('    (No scans, opens, or shares logged. Normal overnight or pre-traffic.)');
    L.push('');
    console.log(L.join('\n'));
    return;
  }

  // What changed — the lead. Biggest movers first.
  L.push('');
  L.push('  WHAT CHANGED');
  const movers = [
    ['scans started', started, evPrev('scan_started')],
    ['bios shown', bio, evPrev('bio_shown')],
    ['stories saved', saved, evPrev('story_saved')],
    ['made public', madePublic, evPrev('made_public')],
    ['paywall shown', ev('paywall_shown'), evPrev('paywall_shown')],
    ['purchases', ev('purchase_completed'), evPrev('purchase_completed')],
    ['pipeline errors', errors, evPrev('pipeline_error')],
  ];
  // Sort by absolute change, surface the top movers; "flat" lines collapse.
  const changed = movers.filter(([, c, p]) => c !== p);
  if (changed.length === 0) {
    L.push('    ·  All headline metrics flat vs the prior window.');
  } else {
    changed
      .sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2]))
      .forEach(([label, c, p]) => L.push(`    ${label.padEnd(16)} ${String(c).padStart(4)}   ${delta(c, p)}`));
  }

  // Scan funnel — where they fall off.
  L.push('');
  L.push('  SCAN FUNNEL');
  L.push(`    started            ${String(started).padStart(4)}`);
  L.push(`    → ocr_done         ${String(ocr).padStart(4)}   (${pct(ocr, started)}% of started)`);
  L.push(`    → bio_shown        ${String(bio).padStart(4)}   (${pct(bio, started)}% of started)`);
  L.push(`    → saved            ${String(saved).padStart(4)}   (${pct(saved, bio)}% of bios)`);
  L.push(`    → made public      ${String(madePublic).padStart(4)}   (${pct(madePublic, saved)}% of saved)`);
  if (cacheHit) L.push(`    bio cache hits     ${String(cacheHit).padStart(4)}   (skipped full research)`);
  if (limitHit) L.push(`    ⚠ scan-limit hits  ${String(limitHit).padStart(4)}   (paywall wall)`);
  if (errors) L.push(`    ✗ pipeline errors  ${String(errors).padStart(4)}`);
  L.push(`    guests / signed-in ${guestStarts} / ${signedStarts}`);

  // Cemetery resolution — the #1b accuracy hypothesis as a number.
  L.push('');
  L.push('  CEMETERY RESOLUTION  (GPS → cemetery name → Tavily disambiguator)');
  if (cemTotal === 0) {
    L.push('    no GPS scans in window');
  } else {
    const flag = report.cemetery_resolution.rate_pct >= 80 ? '✓' : report.cemetery_resolution.rate_pct >= 50 ? '~' : '⚠';
    L.push(`    ${flag} ${report.cemetery_resolution.rate_pct}% resolved  (${cemResolved}/${cemTotal} GPS scans got a name)`);
    if (report.cemetery_resolution.rate_pct < 50) {
      L.push('      ⚠ < 50% — the disambiguator is missing on the scans that need it most.');
      L.push('        Highest-leverage accuracy fix (Overpass nearest-named fallback).');
    }
  }

  // Research yield — Tavily cost justification.
  if (yields.length) {
    L.push('');
    L.push('  RESEARCH YIELD  (avg hits per researched scan)');
    const a = report.research_yield.avg;
    L.push(`    tavily ${a.tavily}  wikitree ${a.wikitree}  wikidata ${a.wikidata}  CA ${a.chronicling}  archive ${a.archive}  wiki ${a.wikipedia}`);
    L.push(`    dry scans (no source hit any): ${dryScans}/${yields.length}`);
  }

  // Engagement.
  L.push('');
  L.push('  ENGAGEMENT');
  L.push(`    maps opened ${report.engagement.map_opened}   tributes ${report.engagement.tribute_left}   shares ${report.engagement.story_shared}   sample views ${report.engagement.sample_viewed}`);

  // Monetization — the fragile webhook link.
  L.push('');
  L.push('  MONETIZATION');
  L.push(`    paywall shown ${report.monetization.paywall_shown}   purchases ✓${ev('purchase_completed')} ✗${ev('purchase_failed')}`);
  if (ev('purchase_completed') > 0 || recentCredits.length > 0) {
    L.push(`    scan_credits rows bumped this window: ${recentCredits.length}` +
      (ev('purchase_completed') > recentCredits.length
        ? '   ⚠ fewer credit bumps than purchases — CHECK THE WEBHOOK'
        : ''));
  }

  // Totals (slow-moving context, last).
  L.push('');
  L.push('  TOTALS');
  L.push(`    all-time scans ${report.totals.scans_all_time ?? '—'}   public stories ${report.totals.public_stories ?? '—'}   new stories this window ${report.totals.new_stories_window ?? '—'}`);
  L.push('');

  console.log(L.join('\n'));
}

main().catch((e) => {
  console.error('\n  ✗ Digest failed:', e.message, '\n');
  process.exit(1);
});

#!/usr/bin/env node
/*
 * token-cost-report.js — Claude Code usage + notional-cost report.
 *
 * Walks every .jsonl transcript under ~/.claude/projects, sums the token
 * counts that Claude Code records on each assistant message, and applies
 * per-model API pricing to produce a *notional* dollar figure.
 *
 * IMPORTANT on a Pro/Max subscription: the dollar number below is NOT money
 * you paid. It is "what this would have cost on pay-as-you-go API billing" —
 * useful for ROI thinking and for deciding whether API would be cheaper, but
 * your real cost is the flat subscription fee. The number that maps to your
 * actual limits is TOKEN VOLUME vs your rolling 5h/7d quota (claude-hud shows
 * that live). Treat the $ column as a cost-model, not an invoice.
 *
 * Usage:
 *   node tools/token-cost-report.js                 # all projects, summary
 *   node tools/token-cost-report.js --days 30       # only last 30 days
 *   node tools/token-cost-report.js --project Grave  # filter project dir by substring
 *   node tools/token-cost-report.js --by day|session|project|model   # detail table
 *   node tools/token-cost-report.js --json          # machine-readable dump
 *
 * Pricing source: claude-api skill (per-MTok base rates). Cache multipliers
 * are the documented prefix-caching economics: write-5m 1.25x, write-1h 2x,
 * read 0.1x. Unknown models fall back to the opus rate and are flagged.
 */

// All token/cost aggregation lives in the shared lib so this report and
// fourthought.js can never disagree on a number. (Was duplicated here; the
// duplicate diverged on undated-row handling — code review caught it.)
const usage = require('./lib/token-usage');
const { priceFor, costOf, emptyTokens, addTokens, totalTokens } = usage;

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
}
const opt = {
  days: flag('days') ? Number(flag('days')) : null,
  project: typeof flag('project') === 'string' ? flag('project') : null,
  by: typeof flag('by') === 'string' ? flag('by') : null,
  json: !!flag('json'),
};
const cutoff = opt.days ? Date.now() - opt.days * 86400_000 : null;

// ---- walk transcripts (delegated to the shared aggregator) ---------------
const scanned = usage.scan({ projectFilter: opt.project, since: cutoff });
const byModel = scanned.byModel;
const byDay = scanned.byDay;
const bySession = scanned.bySession;
const byProject = scanned.byProject;
const assistantMsgs = scanned.msgs;
const parseErrors = scanned.parseErrors;
const unknownModels = scanned.unknownModels;

// ---- aggregate totals ----------------------------------------------------
const grandTokens = scanned.totals;
const grandCost = scanned.cost;

// ---- formatting ----------------------------------------------------------
function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function fmtUsd(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function padL(s, w) {
  s = String(s);
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

if (opt.json) {
  console.log(
    JSON.stringify(
      { grandTokens, grandCost, byModel, byProject: serializeProjects(), assistantMsgs, parseErrors },
      null,
      2
    )
  );
  process.exit(0);
}
function serializeProjects() {
  const out = {};
  for (const p of Object.keys(byProject))
    out[p] = { tokens: byProject[p].tokens, cost: byProject[p].cost, sessions: byProject[p].sessions.size };
  return out;
}

const scope = [
  opt.days ? `last ${opt.days} days` : 'all time',
  opt.project ? `project~"${opt.project}"` : 'all projects',
].join(', ');

console.log('');
console.log('  Claude Code usage report — ' + scope);
console.log('  ' + '='.repeat(64));
console.log('  assistant messages: ' + assistantMsgs.toLocaleString() +
            (parseErrors ? `   (${parseErrors} unparseable lines skipped)` : ''));
console.log('  total tokens:       ' + fmtTok(totalTokens(grandTokens)) +
            `   (in ${fmtTok(grandTokens.input)} / out ${fmtTok(grandTokens.output)} / ` +
            `cache-write ${fmtTok(grandTokens.cacheWrite5m + grandTokens.cacheWrite1h)} / ` +
            `cache-read ${fmtTok(grandTokens.cacheRead)})`);
console.log('  notional API cost:  ' + fmtUsd(grandCost) + '   (NOT money paid on a subscription — see header)');
if (unknownModels.size)
  console.log('  ⚠ unknown models priced at opus rate: ' + [...unknownModels].join(', '));
console.log('');

// per-model table (always shown)
console.log('  By model');
console.log('  ' + pad('model', 22) + padL('tokens', 10) + padL('cost', 12));
console.log('  ' + '-'.repeat(44));
for (const m of Object.keys(byModel).sort(
  (a, b) => costOf(priceFor(b).rate, byModel[b]) - costOf(priceFor(a).rate, byModel[a])
)) {
  const c = costOf(priceFor(m).rate, byModel[m]);
  console.log('  ' + pad(m, 22) + padL(fmtTok(totalTokens(byModel[m])), 10) + padL(fmtUsd(c), 12));
}
console.log('');

// detail table on request
if (opt.by === 'project' || !opt.by) {
  console.log('  By project');
  console.log('  ' + pad('project dir', 40) + padL('sess', 6) + padL('tokens', 10) + padL('cost', 12));
  console.log('  ' + '-'.repeat(68));
  for (const p of Object.keys(byProject).sort((a, b) => byProject[b].cost - byProject[a].cost)) {
    const r = byProject[p];
    console.log(
      '  ' + pad(p.length > 39 ? '…' + p.slice(-38) : p, 40) +
      padL(r.sessions.size, 6) + padL(fmtTok(totalTokens(r.tokens)), 10) + padL(fmtUsd(r.cost), 12)
    );
  }
  console.log('');
}
if (opt.by === 'day') {
  console.log('  By day');
  console.log('  ' + pad('date', 14) + padL('tokens', 10) + padL('cost', 12));
  console.log('  ' + '-'.repeat(36));
  for (const d of Object.keys(byDay).sort()) {
    console.log('  ' + pad(d, 14) + padL(fmtTok(totalTokens(byDay[d].tokens)), 10) + padL(fmtUsd(byDay[d].cost), 12));
  }
  console.log('');
}
if (opt.by === 'session') {
  console.log('  Top 25 sessions by cost');
  console.log('  ' + pad('session', 16) + pad('last day', 12) + padL('tokens', 10) + padL('cost', 12));
  console.log('  ' + '-'.repeat(50));
  const sids = Object.keys(bySession).sort((a, b) => bySession[b].cost - bySession[a].cost).slice(0, 25);
  for (const s of sids) {
    const r = bySession[s];
    console.log('  ' + pad(s.slice(0, 14), 16) + pad(r.lastDay, 12) +
                padL(fmtTok(totalTokens(r.tokens)), 10) + padL(fmtUsd(r.cost), 12));
  }
  console.log('');
}

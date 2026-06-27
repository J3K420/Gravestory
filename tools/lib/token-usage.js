/*
 * token-usage.js — shared aggregator over Claude Code transcripts.
 *
 * Single source of truth for token/notional-cost numbers. Both
 * token-cost-report.js and fourthought.js import this so the figures
 * never drift between tools.
 *
 * The notional dollar figure is "what this would cost on pay-as-you-go API
 * billing" — NOT money paid on a Pro/Max subscription. See token-cost-report.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const WRITE_5M_MULT = 1.25;
const WRITE_1H_MULT = 2.0;
const READ_MULT = 0.1;

// USD per 1,000,000 tokens (base rates from the claude-api skill).
const PRICING = {
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-opus-4-5': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-fable-5': { input: 10.0, output: 50.0 },
};
const FALLBACK = { input: 5.0, output: 25.0 };

function priceFor(model) {
  if (!model) return { rate: FALLBACK, key: '(unknown)', fellBack: true };
  if (PRICING[model]) return { rate: PRICING[model], key: model, fellBack: false };
  const stripped = model.replace(/\[[^\]]*\]/g, '').replace(/-\d{8}$/, '');
  if (PRICING[stripped]) return { rate: PRICING[stripped], key: stripped, fellBack: false };
  let best = null;
  for (const k of Object.keys(PRICING)) {
    if (stripped.startsWith(k) && (!best || k.length > best.length)) best = k;
  }
  if (best) return { rate: PRICING[best], key: best, fellBack: false };
  return { rate: FALLBACK, key: model, fellBack: true };
}

function emptyTokens() {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}
function addTokens(into, t) {
  into.input += t.input;
  into.output += t.output;
  into.cacheWrite5m += t.cacheWrite5m;
  into.cacheWrite1h += t.cacheWrite1h;
  into.cacheRead += t.cacheRead;
}
function totalTokens(t) {
  return t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
}
function costOf(rate, t) {
  return (
    (t.input * rate.input +
      t.output * rate.output +
      t.cacheWrite5m * rate.input * WRITE_5M_MULT +
      t.cacheWrite1h * rate.input * WRITE_1H_MULT +
      t.cacheRead * rate.input * READ_MULT) /
    1_000_000
  );
}

/*
 * Scan transcripts and return per-record aggregates. Options:
 *   projectFilter : substring match on project dir name (case-insensitive)
 *   since / until : ms epoch bounds on message timestamp (inclusive/exclusive)
 *   root          : override projects root (defaults to ~/.claude/projects)
 *
 * Returns { byModel, byDay, bySession, byProject, totals, cost, msgs,
 *           parseErrors, unknownModels }.
 * Each tokens bucket is an emptyTokens()-shaped object; cost is summed USD.
 */
function scan(opts = {}) {
  const root = opts.root || path.join(os.homedir(), '.claude', 'projects');
  const since = opts.since != null ? opts.since : null;
  const until = opts.until != null ? opts.until : null;
  const projectFilter = opts.projectFilter
    ? String(opts.projectFilter).toLowerCase()
    : null;

  const out = {
    byModel: {},
    byDay: {},
    bySession: {},
    byProject: {},
    totals: emptyTokens(),
    cost: 0,
    msgs: 0,
    parseErrors: 0,
    unknownModels: new Set(),
  };
  if (!fs.existsSync(root)) return out;

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => !projectFilter || d.name.toLowerCase().includes(projectFilter));

  for (const dir of dirs) {
    const dirPath = path.join(root, dir.name);
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionId = file.replace(/\.jsonl$/, '');
      const lines = fs.readFileSync(path.join(dirPath, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          out.parseErrors++;
          continue;
        }
        const usage = o && o.message && o.message.usage;
        if (!usage) continue;
        const ts = o.timestamp ? Date.parse(o.timestamp) : null;
        if (since != null && (ts == null || ts < since)) continue;
        if (until != null && (ts == null || ts >= until)) continue;

        const cc = usage.cache_creation || {};
        const t = {
          input: usage.input_tokens || 0,
          output: usage.output_tokens || 0,
          cacheWrite5m:
            cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null
              ? cc.ephemeral_5m_input_tokens || 0
              : usage.cache_creation_input_tokens || 0,
          cacheWrite1h: cc.ephemeral_1h_input_tokens || 0,
          cacheRead: usage.cache_read_input_tokens || 0,
        };
        if (totalTokens(t) === 0) continue;

        out.msgs++;
        const model = o.message.model || '(none)';
        const { rate, fellBack } = priceFor(model);
        if (fellBack) out.unknownModels.add(model);
        const cost = costOf(rate, t);
        const day = o.timestamp ? o.timestamp.slice(0, 10) : '(undated)';

        addTokens(out.totals, t);
        out.cost += cost;

        out.byModel[model] = out.byModel[model] || emptyTokens();
        addTokens(out.byModel[model], t);

        out.byDay[day] = out.byDay[day] || { tokens: emptyTokens(), cost: 0 };
        addTokens(out.byDay[day].tokens, t);
        out.byDay[day].cost += cost;

        out.bySession[sessionId] = out.bySession[sessionId] || {
          project: dir.name,
          tokens: emptyTokens(),
          cost: 0,
          lastDay: day,
        };
        addTokens(out.bySession[sessionId].tokens, t);
        out.bySession[sessionId].cost += cost;
        if (day > out.bySession[sessionId].lastDay) out.bySession[sessionId].lastDay = day;

        out.byProject[dir.name] = out.byProject[dir.name] || {
          tokens: emptyTokens(),
          cost: 0,
          sessions: new Set(),
        };
        addTokens(out.byProject[dir.name].tokens, t);
        out.byProject[dir.name].cost += cost;
        out.byProject[dir.name].sessions.add(sessionId);
      }
    }
  }
  return out;
}

module.exports = {
  scan,
  priceFor,
  costOf,
  emptyTokens,
  addTokens,
  totalTokens,
  WRITE_5M_MULT,
  WRITE_1H_MULT,
  READ_MULT,
};

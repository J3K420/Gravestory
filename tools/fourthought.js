#!/usr/bin/env node
/*
 * fourthought.js — a single-author FourThought ledger for tracking the ROI
 * of Claude Code work.
 *
 * Based on the FourThought dialectic by Speaker John Ash (part of the
 * "Cognicism" framework). FourThought logs four kinds of timestamped,
 * staked claims — PREDICTIONS, STATEMENTS, REFLECTIONS, QUESTIONS — and
 * grades predictions against reality after the fact. Each claim carries a
 * VALENCE (how much it aligns with what you value, 1–10) and an UNCERTAINTY
 * (how unsure you are it's true / will happen, 0–1).
 *
 * This is a faithful SINGLE-AUTHOR SUBSET: the social machinery of the full
 * protocol (Ŧrust, community valence voting, Deep Democracy consensus) is
 * intentionally dropped — there's one voter, you. The retrospective ROI math
 * (realized_value / Mtokens, calibration_error, outcome-accuracy) is an
 * EXPLICIT DESIGN CHOICE layered on top, not part of the published glossary,
 * and is tunable below.
 *
 * The ledger is APPEND-ONLY (tools/fourthought/ledger.jsonl). A reflection
 * never edits the prediction it grades — it is a new claim that references it.
 * This preserves the immutable-timestamped-claim spirit of FourThought and
 * means your calibration history can't be silently rewritten.
 *
 * The objective half of each ROI record (tokens spent, commits, lines) is
 * pulled automatically — token spend from the shared transcript aggregator
 * (lib/token-usage.js, same numbers as token-cost-report.js), and git
 * activity from the linked branch since the prediction's timestamp.
 *
 * Commands:
 *   predict   "<text>" --valence N --uncertainty F [--branch B] [--cost-estimate T] [--tag X]
 *   statement "<text>" [--tag X]
 *   question  "<text>" [--tag X]
 *   reflect   <id> --outcome shipped|partial|failed|abandoned --worth N [--note "..."]
 *   list      [--type predict|statement|reflection|question] [--open] [--tag X]
 *   report    calibration | roi | forecast | levers
 *   show      <id>
 *
 * IDs are short hashes printed on creation; use them to reflect/show.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const usage = require('./lib/token-usage');

const LEDGER_DIR = path.join(__dirname, 'fourthought');
const LEDGER = path.join(LEDGER_DIR, 'ledger.jsonl');
const REPO_ROOT = path.resolve(__dirname, '..');

// ---- tiny arg parser -----------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---- ledger io -----------------------------------------------------------
function nowIso() {
  // Date.now()/new Date() are fine in this standalone CLI (not a workflow).
  return new Date().toISOString();
}
function ensureLedger() {
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, '');
}
function appendThought(obj) {
  ensureLedger();
  obj.id = crypto
    .createHash('sha256')
    .update(JSON.stringify(obj) + nowIso() + Math.random())
    .digest('hex')
    .slice(0, 8);
  obj.ts = nowIso();
  fs.appendFileSync(LEDGER, JSON.stringify(obj) + '\n');
  return obj;
}
function readLedger() {
  ensureLedger();
  return fs
    .readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
function findById(rows, prefix) {
  const hits = rows.filter((r) => r.id === prefix || r.id.startsWith(prefix));
  if (hits.length === 0) return { err: `no thought matches id "${prefix}"` };
  if (hits.length > 1) return { err: `ambiguous id "${prefix}" (${hits.length} matches)` };
  return { row: hits[0] };
}

// ---- objective data joins ------------------------------------------------
function num(v, dflt) {
  // Reject anything that isn't a real numeric value. Critically, a valueless
  // flag arrives as boolean `true` (e.g. `--valence` with no number) and
  // Number(true) === 1 — that silently passed validation and wrote a fake
  // value into the immutable ledger. Only accept numbers and numeric strings.
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }
  return dflt; // boolean true (valueless flag), empty string, undefined, etc.
}

// Token spend in a [since, until) window, optionally filtered to a project.
function tokenSpend(sinceIso, untilIso, projectFilter) {
  const r = usage.scan({
    projectFilter: projectFilter || 'Grave', // this repo by default
    since: sinceIso ? Date.parse(sinceIso) : null,
    until: untilIso ? Date.parse(untilIso) : null,
  });
  return {
    tokens: usage.totalTokens(r.totals),
    notionalCost: r.cost,
    sessions: Object.keys(r.bySession).length,
  };
}

// Git commits + lines changed on a branch since an ISO timestamp.
function gitActivity(branch, sinceIso) {
  try {
    const args = ['-C', REPO_ROOT, 'log', '--since', sinceIso, '--pretty=%H', '--numstat'];
    // Branch (if any) is a positional revision — it must come AFTER the option
    // block, not spliced into the middle (a mid-array splice made the branch
    // the value of --since and broke git entirely; code review caught it).
    // Use `--` so a branch name can never be mistaken for a path.
    if (branch && branch !== true) args.push(branch, '--');
    const out = execFileSync('git', args, { encoding: 'utf8' });
    let commits = 0;
    let added = 0;
    let removed = 0;
    for (const line of out.split('\n')) {
      if (/^[0-9a-f]{40}$/.test(line.trim())) {
        commits++;
      } else {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
        if (m) {
          added += m[1] === '-' ? 0 : Number(m[1]);
          removed += m[2] === '-' ? 0 : Number(m[2]);
        }
      }
    }
    return { commits, added, removed };
  } catch (e) {
    return { commits: 0, added: 0, removed: 0, error: e.message.split('\n')[0] };
  }
}

// ---- formatting ----------------------------------------------------------
function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}
function padL(s, w) {
  s = String(s);
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}
const TYPE_GLYPH = { prediction: '◆ pred', statement: '▸ stmt', reflection: '↺ refl', question: '? ques' };

// ---- commands ------------------------------------------------------------
function cmdPredict(p, f) {
  const text = p.join(' ').trim();
  if (!text) return fail('predict needs text: fourthought predict "..." --valence N --uncertainty F');
  const valence = num(f.valence, null);
  const uncertainty = num(f.uncertainty, null);
  if (valence === null || valence < 1 || valence > 10)
    return fail('--valence must be 1–10 (how much you would value this landing)');
  if (uncertainty === null || uncertainty < 0 || uncertainty > 1)
    return fail('--uncertainty must be 0–1 (how unsure you are it will happen)');
  const t = appendThought({
    type: 'prediction',
    text,
    valence,
    uncertainty,
    branch: typeof f.branch === 'string' ? f.branch : null,
    costEstimate: f['cost-estimate'] ? num(f['cost-estimate'], null) : null,
    tag: typeof f.tag === 'string' ? f.tag : null,
    resolved: false,
  });
  console.log(`◆ prediction staked  id=${t.id}  valence=${valence}/10  uncertainty=${uncertainty}`);
  console.log(`  "${text}"`);
  if (t.branch) console.log(`  branch: ${t.branch}`);
  console.log(`  reflect later with:  node tools/fourthought.js reflect ${t.id} --outcome shipped --worth N`);
}

function cmdSimple(type, p, f) {
  const text = p.join(' ').trim();
  if (!text) return fail(`${type} needs text`);
  const t = appendThought({ type, text, tag: typeof f.tag === 'string' ? f.tag : null });
  console.log(`${TYPE_GLYPH[type]} logged  id=${t.id}`);
  console.log(`  "${text}"`);
}

function cmdReflect(p, f) {
  const rows = readLedger();
  const idArg = p[0];
  if (!idArg) return fail('reflect needs a prediction id: fourthought reflect <id> --outcome ... --worth N');
  const { row, err } = findById(rows, idArg);
  if (err) return fail(err);
  if (row.type !== 'prediction')
    return fail(`id ${row.id} is a ${row.type}, not a prediction — only predictions get reflected`);
  // The append-only model never writes `resolved` back onto the prediction, so
  // the old `row.resolved` check was dead. Detect prior reflections directly.
  const priorReflections = rows.filter((r) => r.type === 'reflection' && r.refersTo === row.id).length;
  if (priorReflections > 0)
    console.log(
      `  (note: ${row.id} already reflected ${priorReflections}x; this supersedes — reports use the latest only)`
    );

  const outcome = typeof f.outcome === 'string' ? f.outcome : null;
  const valid = ['shipped', 'partial', 'failed', 'abandoned'];
  if (!valid.includes(outcome)) return fail(`--outcome must be one of: ${valid.join(', ')}`);
  const worth = num(f.worth, null);
  if (worth === null || worth < 0 || worth > 10)
    return fail('--worth must be 0–10 (realized value, your honest post-hoc judgment)');

  // objective join: spend + git since the prediction was staked
  const spend = tokenSpend(row.ts, nowIso(), null);
  const git = gitActivity(row.branch, row.ts);

  // ROI math (explicit design choice — see header):
  //   roi             = realized value per million tokens spent
  //   calibrationErr  = worth - predicted valence  (+ = undervalued, − = overvalued)
  //   outcomeHit      = did it land? (shipped/partial = yes-ish)  vs predicted uncertainty
  const mtok = spend.tokens / 1e6;
  const roi = mtok > 0 ? worth / mtok : null;
  const calibrationErr = worth - row.valence;
  const landed = outcome === 'shipped' ? 1 : outcome === 'partial' ? 0.5 : 0;
  // Brier-style: predicted P(land) = 1 - uncertainty; penalty = (P - landed)^2
  const brier = Math.pow(1 - row.uncertainty - landed, 2);

  const refl = appendThought({
    type: 'reflection',
    refersTo: row.id,
    predictionText: row.text,
    outcome,
    worth,
    note: typeof f.note === 'string' ? f.note : null,
    tag: row.tag,
    objective: {
      tokens: spend.tokens,
      notionalCost: Number(spend.notionalCost.toFixed(2)),
      sessions: spend.sessions,
      commits: git.commits,
      linesAdded: git.added,
      linesRemoved: git.removed,
      gitError: git.error || null,
    },
    derived: {
      roiPerMtok: roi !== null ? Number(roi.toFixed(3)) : null,
      calibrationError: calibrationErr,
      brier: Number(brier.toFixed(3)),
      predictedValence: row.valence,
      predictedUncertainty: row.uncertainty,
    },
  });

  // mark the prediction resolved by appending a resolution marker thought
  appendThought({ type: 'resolution', refersTo: row.id, byReflection: refl.id });

  console.log(`↺ reflection logged  id=${refl.id}  (on prediction ${row.id})`);
  console.log(`  "${row.text}"`);
  console.log(`  outcome=${outcome}  worth=${worth}/10  (predicted valence ${row.valence}/10)`);
  console.log(
    `  objective: ${fmtTok(spend.tokens)} tokens · ~$${spend.notionalCost.toFixed(2)} · ` +
      `${spend.sessions} sessions · ${git.commits} commits · +${git.added}/-${git.removed} lines` +
      (git.error ? `  (git: ${git.error})` : '')
  );
  console.log(
    `  derived:   ROI ${roi !== null ? roi.toFixed(2) : 'n/a'} value/Mtok · ` +
      `calibration ${calibrationErr >= 0 ? '+' : ''}${calibrationErr} ` +
      `(${calibrationErr > 0 ? 'undervalued' : calibrationErr < 0 ? 'OVERvalued' : 'on target'}) · ` +
      `brier ${brier.toFixed(2)}`
  );
}

function cmdList(p, f) {
  let rows = readLedger().filter((r) => r.type !== 'resolution');
  if (typeof f.type === 'string') {
    const want = f.type === 'predict' ? 'prediction' : f.type === 'reflect' ? 'reflection' : f.type;
    rows = rows.filter((r) => r.type === want);
  }
  if (typeof f.tag === 'string') rows = rows.filter((r) => r.tag === f.tag);
  if (f.open) {
    const resolved = new Set(readLedger().filter((r) => r.type === 'resolution').map((r) => r.refersTo));
    rows = rows.filter(
      (r) => (r.type === 'prediction' && !resolved.has(r.id)) || r.type === 'question'
    );
  }
  if (rows.length === 0) return console.log('  (no matching thoughts)');
  console.log('');
  for (const r of rows) {
    const glyph = TYPE_GLYPH[r.type] || r.type;
    const date = (r.ts || '').slice(0, 10);
    let meta = '';
    if (r.type === 'prediction') meta = ` v=${r.valence} u=${r.uncertainty}`;
    if (r.type === 'reflection') meta = ` ${r.outcome} worth=${r.worth} roi=${r.derived ? r.derived.roiPerMtok : '?'}`;
    const tag = r.tag ? `  #${r.tag}` : '';
    console.log(`  ${pad(r.id, 9)} ${glyph} ${date}${meta}${tag}`);
    console.log(`            ${pad(r.text || r.predictionText || '', 76)}`);
  }
  console.log('');
}

function cmdShow(p) {
  const rows = readLedger();
  if (!p[0]) return fail('show needs an id: fourthought show <id>');
  const { row, err } = findById(rows, p[0]);
  if (err) return fail(err);
  console.log(JSON.stringify(row, null, 2));
  if (row.type === 'prediction') {
    const refl = rows.filter((r) => r.type === 'reflection' && r.refersTo === row.id);
    for (const r of refl) console.log('\n  reflection ' + r.id + ':\n' + JSON.stringify(r, null, 2));
  }
}

// ---- reports -------------------------------------------------------------
// Return only the LATEST reflection per prediction. The ledger is append-only,
// so re-reflecting a prediction leaves multiple reflection rows; reports must
// treat the newest as superseding, not sum them all (code review caught the
// double-count). Reflections are appended in time order, so last-wins. Also
// drop any reflection missing its `derived` block (hand-edited / legacy row)
// so a single bad line can't crash a report.
function reflections(rows) {
  const latestByPred = new Map();
  for (const r of rows) {
    if (r.type !== 'reflection' || !r.derived) continue;
    latestByPred.set(r.refersTo, r); // later rows overwrite earlier ones
  }
  return [...latestByPred.values()];
}

function reportCalibration(rows) {
  const refl = reflections(rows);
  console.log('\n  Calibration — are you predicting value & likelihood accurately?');
  console.log('  ' + '='.repeat(64));
  if (refl.length === 0) return console.log('  (no reflections yet — stake predictions, then reflect)\n');
  let sumErr = 0;
  let sumAbsErr = 0;
  let sumBrier = 0;
  for (const r of refl) {
    sumErr += r.derived.calibrationError;
    sumAbsErr += Math.abs(r.derived.calibrationError);
    sumBrier += r.derived.brier;
  }
  const n = refl.length;
  const meanErr = sumErr / n;
  console.log(`  reflections: ${n}`);
  console.log(
    `  value bias:  ${meanErr >= 0 ? '+' : ''}${meanErr.toFixed(2)}  ` +
      `(${meanErr > 0.5 ? 'you UNDER-value your work' : meanErr < -0.5 ? 'you OVER-value your work' : 'well calibrated'})`
  );
  console.log(`  mean |error|: ${(sumAbsErr / n).toFixed(2)} valence points`);
  console.log(
    `  outcome Brier: ${(sumBrier / n).toFixed(3)}  ` +
      `(0=perfect, 0.25=coin-flip; lower = your confidence matched reality)`
  );
  // Only items actually overvalued (worth fell short of predicted valence,
  // i.e. negative error). Without the filter this listed undervalued items
  // under an "OVERvalued" header whenever there were <3 overvalued ones.
  const overvalued = refl
    .filter((r) => r.derived.calibrationError < 0)
    .sort((a, b) => a.derived.calibrationError - b.derived.calibrationError)
    .slice(0, 3);
  console.log('\n  most OVERvalued (predicted high, delivered low):');
  if (overvalued.length === 0) {
    console.log('    (none — you have not overvalued any work yet)');
  } else {
    overvalued.forEach((r) =>
      console.log(`    ${r.derived.calibrationError}  ${pad(r.predictionText, 60)}`)
    );
  }
  console.log('');
}

function reportRoi(rows) {
  const refl = reflections(rows).filter((r) => r.derived && r.derived.roiPerMtok !== null);
  console.log('\n  ROI ranking — realized value per million tokens');
  console.log('  ' + '='.repeat(64));
  if (refl.length === 0) return console.log('  (no scored reflections yet)\n');
  console.log('  ' + pad('roi', 8) + pad('worth', 7) + pad('tokens', 9) + pad('cost', 9) + 'what');
  console.log('  ' + '-'.repeat(70));
  refl
    .slice()
    .sort((a, b) => b.derived.roiPerMtok - a.derived.roiPerMtok)
    .forEach((r) => {
      console.log(
        '  ' +
          pad(r.derived.roiPerMtok.toFixed(2), 8) +
          pad(r.worth + '/10', 7) +
          pad(fmtTok(r.objective.tokens), 9) +
          pad('$' + r.objective.notionalCost.toFixed(0), 9) +
          pad(r.predictionText, 40)
      );
    });
  console.log('');
}

function reportForecast(rows) {
  const refl = reflections(rows).filter((r) => r.objective && r.objective.tokens > 0);
  console.log('\n  Forecast — what past work actually cost (to size future work)');
  console.log('  ' + '='.repeat(64));
  if (refl.length === 0) return console.log('  (no reflections with spend yet)\n');
  // group by tag, else by outcome
  const groups = {};
  for (const r of refl) {
    const key = r.tag || r.outcome;
    groups[key] = groups[key] || { tokens: [], cost: [] };
    groups[key].tokens.push(r.objective.tokens);
    groups[key].cost.push(r.objective.notionalCost);
  }
  const median = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  console.log('  ' + pad('group', 22) + pad('n', 4) + pad('median tok', 12) + pad('median $', 10));
  console.log('  ' + '-'.repeat(48));
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    console.log(
      '  ' + pad(k, 22) + pad(g.tokens.length, 4) + pad(fmtTok(median(g.tokens)), 12) + pad('$' + median(g.cost).toFixed(0), 10)
    );
  }
  // also surface any open predictions that carried a cost estimate
  const resolved = new Set(rows.filter((r) => r.type === 'resolution').map((r) => r.refersTo));
  const openEst = rows.filter((r) => r.type === 'prediction' && !resolved.has(r.id) && r.costEstimate);
  if (openEst.length) {
    console.log('\n  open predictions with a cost estimate (not yet reflected):');
    openEst.forEach((r) => console.log(`    ~${fmtTok(r.costEstimate)} tok  ${pad(r.text, 50)}  [${r.id}]`));
  }
  console.log('');
}

function reportLevers(rows) {
  console.log('\n  Levers — open questions & the evidence accruing toward them');
  console.log('  ' + '='.repeat(64));
  const questions = rows.filter((r) => r.type === 'question');
  const refl = reflections(rows);
  if (questions.length === 0) return console.log('  (no open questions logged — add with: fourthought question "..." --tag X)\n');
  for (const q of questions) {
    console.log(`  ? ${q.text}  ${q.tag ? '#' + q.tag : ''}  [${q.id}]`);
    const related = refl.filter((r) => r.tag && q.tag && r.tag === q.tag);
    if (related.length === 0) {
      console.log('      (no reflections tagged #' + (q.tag || '—') + ' yet)');
    } else {
      related.forEach((r) => {
        const roi = r.derived.roiPerMtok == null ? 'n/a' : r.derived.roiPerMtok;
        console.log(`      ${r.outcome} worth=${r.worth} roi=${roi}  ${pad(r.predictionText, 44)}`);
      });
    }
    console.log('');
  }
}

function cmdReport(p) {
  const rows = readLedger();
  const mode = p[0] || 'calibration';
  if (mode === 'calibration') return reportCalibration(rows);
  if (mode === 'roi') return reportRoi(rows);
  if (mode === 'forecast') return reportForecast(rows);
  if (mode === 'levers') return reportLevers(rows);
  return fail(`unknown report "${mode}" — use: calibration | roi | forecast | levers`);
}

// ---- dispatch ------------------------------------------------------------
function fail(msg) {
  console.error('error: ' + msg);
  process.exitCode = 1;
}
function usageText() {
  console.log(`fourthought — a FourThought ROI ledger for Claude Code work

  predict   "<text>" --valence N(1-10) --uncertainty F(0-1) [--branch B] [--cost-estimate T] [--tag X]
  statement "<text>" [--tag X]
  question  "<text>" [--tag X]
  reflect   <id> --outcome shipped|partial|failed|abandoned --worth N(0-10) [--note "..."]
  list      [--type prediction|reflection|question] [--open] [--tag X]
  show      <id>
  report    calibration | roi | forecast | levers

Predictions are staked before the outcome is known; reflections grade them
after, auto-joining token spend + git activity. See header for the method.`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case 'predict':
      return cmdPredict(positional, flags);
    case 'statement':
      return cmdSimple('statement', positional, flags);
    case 'question':
      return cmdSimple('question', positional, flags);
    case 'reflect':
      return cmdReflect(positional, flags);
    case 'list':
      return cmdList(positional, flags);
    case 'show':
      return cmdShow(positional);
    case 'report':
      return cmdReport(positional);
    case undefined:
    case 'help':
    case '--help':
      return usageText();
    default:
      fail(`unknown command "${cmd}"`);
      usageText();
  }
}

main();

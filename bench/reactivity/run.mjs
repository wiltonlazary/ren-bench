// The apples-to-apples reactivity comparison.
//
//   node bench/reactivity/run.mjs [--rounds N] [--warmup N] [--repeat N] [--only lib,lib]
//                      [--scenarios a,b] [--table]
// RRX_SCENARIOS=<path> selects another scenario definition (see scenarios.mjs).
//
// Runs every (library, scenario) pair in its own child process with the same
// node binary and flags, warm-up and number of timed rounds, and prints one
// JSON line per pair:
//   {"library", "scenario", "ms", "sum", "runs"}
// A pair whose sum or runs differ from the expected values of scenarios.json
// (the consensus) is reported with "ms": null and "fail": "checksum".
// Provenance goes to the first line as {"provenance": {...}}.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadavg, cpus } from 'node:os';
import { adapters, version, limits, rrxFrom } from './adapters.mjs';
import { definition, source } from './scenarios.mjs';
import { provenance, sources } from '../../provenance.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const rounds = Number(option('rounds', definition.rounds));
const warmup = Number(option('warmup', definition.warmup));
const repeat = Number(option('repeat', 1));
const only = option('only', null);
const table = args.includes('--table');
const libraries = only ? only.split(',') : Object.keys(adapters);
const wanted = option('scenarios', null);
const scenarios = definition.scenarios.filter(s => !wanted || wanted.split(',').includes(s.name));
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));

const versions = {};
for (const library of libraries) versions[library] = await version(library);
console.log(JSON.stringify({
  provenance: {
    ...provenance(fileURLToPath(new URL('../..', import.meta.url))),
    sources: sources(['rrx-core'], rrxFrom),
    versions,
    definition: source,
    rounds,
    warmup,
    repeat,
    cpus: cpus().length,
    load: loadavg().map(x => Math.round(x * 100) / 100),
    date: new Date().toISOString(),
  },
}));

const results = [];
const verdict = (entry, expect, repeat) => {
  const ok = entry.sum === expect.sum && entry.runs === expect.runs;
  const line = ok ? { ...entry, repeat } : { ...entry, ms: null, fail: 'checksum', expected: expect, repeat };
  results.push(line);
  console.log(JSON.stringify(line));
};

const measure = (library, scenario, r) => {
  const only = /** @type {Record<string, string[]>} */ (limits)[library];
  if (only && !only.includes(scenario.name)) return;
  const argv = [...process.execArgv, worker, library, scenario.name, String(warmup), String(rounds)];
  const child = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const lines = child.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  const line = lines.find(x => x.scenario === scenario.name);
  if (child.status !== 0 || !line) {
    results.push({ library, scenario: scenario.name, ms: null, fail: 'error', repeat: r });
    console.log(JSON.stringify({ library, scenario: scenario.name, ms: null, sum: null, runs: null, fail: 'error', error: child.stderr.trim().split('\n').slice(-3).join(' ') }));
    return;
  }
  verdict({ ...line, library }, scenario.expect, r);
};
// Repeats interleave the whole matrix; the library order rotates per repeat
// so drifting load does not favour one side.
for (let r = 0; r < repeat; r++) {
  const order = [...libraries];
  for (let k = 0; k < r % order.length; k++) order.push(/** @type {string} */ (order.shift()));
  for (const scenario of scenarios) for (const library of order) measure(library, scenario, r);
}

console.log(JSON.stringify({ load: loadavg().map(x => Math.round(x * 100) / 100) }));

if (table) {
  const names = [...new Set(results.map(r => r.library))];
  const times = (library, scenario) => results.filter(x => x.library === library && x.scenario === scenario);
  const median = xs => {
    const v = [...xs].sort((p, q) => p - q);
    return v[Math.floor(v.length / 2)];
  };
  /** The median over repeats, or null when any repeat failed its checksum. */
  const value = (library, scenario) => {
    const rs = times(library, scenario);
    if (rs.length === 0 || rs.some(x => x.ms == null)) return null;
    return median(rs.map(x => x.ms));
  };
  const cell = (library, scenario) => {
    const rs = times(library, scenario);
    if (rs.length === 0) return '';
    const failed = rs.find(x => x.ms == null);
    if (failed) return (failed.fail ?? 'fail').toUpperCase();
    const ms = rs.map(x => x.ms);
    const m = median(ms);
    return repeat > 1 ? `${m.toFixed(3)} (${Math.min(...ms).toFixed(3)}–${Math.max(...ms).toFixed(3)})` : m.toFixed(3);
  };
  const geo = xs => Math.exp(xs.reduce((t, x) => t + Math.log(x), 0) / xs.length);
  const ratio = other => {
    const xs = scenarios.map(s => {
      const a = value('rrx', s.name);
      const b = value(other, s.name);
      return a && b ? a / b : null;
    }).filter(x => x != null);
    return xs.length ? geo(xs).toFixed(2) : '';
  };
  const rows = [['library', ...scenarios.map(s => s.name), 'rrx ÷ library (geomean)']];
  for (const name of names) rows.push([name, ...scenarios.map(s => cell(name, s.name)), name === 'rrx' ? '1.00' : ratio(name)]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  const print = r => console.error('| ' + r.map((c, i) => c.padStart(widths[i])).join(' | ') + ' |');
  print(rows[0]);
  console.error('| ' + widths.map(w => '-'.repeat(w - 1) + ':').join(' | ') + ' |');
  for (const r of rows.slice(1)) print(r);
  // rrx-core ÷ library per scenario, from the medians over repeats.
  const per = [['rrx ÷', ...scenarios.map(s => s.name)]];
  for (const name of names) {
    if (name === 'rrx') continue;
    per.push([name, ...scenarios.map(s => {
      const a = value('rrx', s.name);
      const b = value(name, s.name);
      return a && b ? (a / b).toFixed(2) : '';
    })]);
  }
  const w2 = per[0].map((_, i) => Math.max(...per.map(r => r[i].length)));
  console.error('');
  console.error('| ' + per[0].map((c, i) => c.padStart(w2[i])).join(' | ') + ' |');
  console.error('| ' + w2.map(w => '-'.repeat(w - 1) + ':').join(' | ') + ' |');
  for (const r of per.slice(1)) console.error('| ' + r.map((c, i) => c.padStart(w2[i])).join(' | ') + ' |');
  // Caller-blocking time (median over repeats) for scenarios that report it.
  const blocked = scenarios.filter(s => results.some(x => x.scenario === s.name && x.blocking !== undefined));
  if (blocked.length > 0) {
    const rowsB = [['blocking ms', ...blocked.map(s => s.name)]];
    for (const name of names) {
      rowsB.push([name, ...blocked.map(s => {
        const xs = results.filter(x => x.library === name && x.scenario === s.name && x.blocking !== undefined && x.ms != null);
        return xs.length ? median(xs.map(x => x.blocking)).toFixed(3) : '';
      })]);
    }
    const w3 = rowsB[0].map((_, i) => Math.max(...rowsB.map(r => r[i].length)));
    console.error('');
    console.error('| ' + rowsB[0].map((c, i) => c.padStart(w3[i])).join(' | ') + ' |');
    console.error('| ' + w3.map(w => '-'.repeat(w - 1) + ':').join(' | ') + ' |');
    for (const r of rowsB.slice(1)) console.error('| ' + r.map((c, i) => c.padStart(w3[i])).join(' | ') + ' |');
  }
}

// A failed measurement is a failed command, even when a table was requested.
if (results.some(result => result.ms == null)) process.exitCode = 2;

// Paired A/B runs of the market table between this checkout (A) and another
// (B, --base: another ren-bench checkout with its suites installed and family
// dependencies linked to the desired library revisions), in ABBA order:
// on both sides:
//
//   node bench/market/abba.mjs --base ../base [--only ren-dom-c] [--benches create1k,create10k]
//                              [--pairs 4] [--rounds 10] [--warmup 5]
//
// Builds both sides once, then runs each side's own run.mjs (--no-build
// --memory 0 --out <scratch>) A, B, B, A, … one Chrome at a time (take the
// machine-wide lock around this script). Prints per implementation and
// benchmark the median of the run medians of `total` (click to painted
// frame) and `ready` (the click's JS), their ratio A/B, and in how many
// pairs A was faster.

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const base = option('base', null);
if (base === null) throw new Error('--base <ren-bench checkout> is required');
const sides = { A: resolvePath(here, '../..'), B: resolvePath(base) };
const only = option('only', 'ren-dom-c');
const benches = option('benches', 'create1k,create10k');
const pairs = Number(option('pairs', 4));
const rounds = option('rounds', '10');
const warmup = option('warmup', '5');
const scratch = join(sides.A, 'artifact/tmp/market-abba');
mkdirSync(scratch, { recursive: true });
const commit = dir => provenance(dir).commit;

for (const [name, dir] of Object.entries(sides)) {
  process.stderr.write(`build ${name} (${commit(dir)})\n`);
  execFileSync(process.execPath, [join(dir, 'bench/market/build.mjs'), '--only', only], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** @type {Record<'A' | 'B', any[]>} */
const runs = { A: [], B: [] };
const loads = [];
for (let p = 0; p < pairs; p++) {
  for (const name of p % 2 === 0 ? ['A', 'B', 'B', 'A'] : ['B', 'A', 'A', 'B']) {
    const out = join(scratch, `${name}-${p}-${runs[name].length}.json`);
    loads.push(loadavg()[0]);
    execFileSync(process.execPath, [join(sides[name], 'bench/market/run.mjs'), '--no-build', '--only', only, '--benches', benches, '--rounds', rounds, '--warmup', warmup, '--memory', '0', '--out', out], { cwd: sides[name], stdio: ['ignore', 'ignore', 'inherit'] });
    runs[name].push(JSON.parse(readFileSync(out, 'utf8')));
  }
}

const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const r = x => Math.round(x * 100) / 100;
const pick = (run, impl, bench, key) => {
  const b = run.results.find(x => x.name === impl)?.benches[bench];
  return b === undefined ? null : key === 'total' ? b.total.median : b[key];
};
console.log(JSON.stringify({ ...provenance(sides.A), A: commit(sides.A), B: commit(sides.B), sources: { A: runs.A[0].provenance.sources, B: runs.B[0].provenance.sources }, only, benches, pairs, rounds, warmup, chrome: runs.A[0].provenance.chrome, load: [r(Math.min(...loads)), r(Math.max(...loads))] }));
console.log('| implementation | bench | metric | A | B | A/B | A faster |');
console.log('| --- | --- | --- | ---: | ---: | ---: | ---: |');
for (const impl of only.split(','))
  for (const bench of benches.split(','))
    for (const key of ['total', 'ready']) {
      const a = runs.A.map(run => pick(run, impl, bench, key));
      const b = runs.B.map(run => pick(run, impl, bench, key));
      if (a.includes(null) || b.includes(null)) {
        console.log(`| ${impl} | ${bench} | ${key} | FAIL | | | |`);
        continue;
      }
      // Runs are in ABBA groups of four: each pair is the two A and two B runs of a group.
      let wins = 0;
      for (let i = 0; i < a.length; i += 2) if (a[i] + a[i + 1] < b[i] + b[i + 1]) wins++;
      console.log(`| ${impl} | ${bench} | ${key} | ${r(median(a))} | ${r(median(b))} | ${r(median(a) / median(b))} | ${wins}/${a.length / 2} |`);
    }

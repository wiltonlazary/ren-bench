import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from '../../provenance.mjs';
import { definition, source } from './scenarios.mjs';

// Compare two rrx-core checkouts through this one harness and its pinned dependencies.
// Usage: node bench/reactivity/paired.mjs <pairs> <scenarios> <candidate> <control>
if (!process.argv[4] || !process.argv[5]) {
  console.error('Usage: node bench/reactivity/paired.mjs <pairs> <scenarios> <candidate> <control>');
  process.exit(1);
}
const root = resolve(process.argv[4]);
const baseline = resolve(process.argv[5]);
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const pairs = Number(process.argv[2] ?? 10);
const names = process.argv[3]?.split(',');
const cases = definition.scenarios.filter(x => !names || names.includes(x.name));
const hash = directory => {
  const digest = createHash('sha256');
  for (const name of readdirSync(`${directory}/src`).sort()) {
    digest.update(name);
    digest.update(readFileSync(`${directory}/src/${name}`));
  }
  return digest.digest('hex');
};
console.log(JSON.stringify({ node: process.version, nodeOptions: process.env.NODE_OPTIONS,
  load: loadavg(), date: new Date().toISOString(), pairs,
  warmup: definition.warmup, rounds: definition.rounds,
  definition: source,
  baseline: provenance(baseline).commit,
  candidate: provenance(root).commit,
  inputs: { A: { path: baseline, ...provenance(baseline) }, B: { path: root, ...provenance(root) } },
  harness: provenance(fileURLToPath(new URL('../..', import.meta.url))),
  hashes: { A: hash(baseline), B: hash(root) },
}));
for (let pair = 0; pair < pairs; pair++) {
  for (const scenario of cases) {
    for (const arm of pair % 2 === 0 ? ['A', 'B'] : ['B', 'A']) {
      const cwd = arm === 'A' ? baseline : root;
      const run = spawnSync(process.execPath, [...process.execArgv, worker, 'rrx', scenario.name,
        String(definition.warmup), String(definition.rounds)],
      { cwd, env: { ...process.env, RRX_ROOT: cwd, RRX_SCENARIOS: fileURLToPath(source) }, encoding: 'utf8', timeout: 30000 });
      if (run.status !== 0) throw new Error(run.stderr || `exit ${run.status}`);
      const result = JSON.parse(run.stdout.trim());
      if (result.sum !== scenario.expect.sum || result.runs !== scenario.expect.runs)
        throw new Error(`checksum: ${run.stdout}`);
      console.log(JSON.stringify({ arm, pair, ...result }));
    }
  }
}
console.log(JSON.stringify({ load: loadavg(), date: new Date().toISOString() }));

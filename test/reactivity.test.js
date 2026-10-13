import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { packageRoot, provenance } from '../provenance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = fileURLToPath(new URL('../bench/reactivity/run.mjs', import.meta.url));
const run = env => spawnSync(process.execPath, [runner, '--only', 'rrx', '--scenarios', 'deep', '--warmup', '0', '--rounds', '1'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000,
});

test('reactivity measures the linked library and records its checkout independently', () => {
  const source = packageRoot('rrx-core');
  const child = run({ RRX_ROOT: source });
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].provenance.commit, provenance(root).commit);
  assert.equal(rows[0].provenance.sources['rrx-core'].path, source);
  assert.equal(rows[0].provenance.sources['rrx-core'].commit, provenance(source).commit);
  assert.equal(rows[1].sum, 100250);
  assert.equal(rows[1].runs, 401);
});

test('a mismatched benchmark checksum fails the command', () => {
  const scratch = join(root, 'artifact/tmp/reactivity-test');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(join(scratch, 'checksum-'));
  try {
    const definition = JSON.parse(readFileSync(new URL('../bench/reactivity/scenarios.json', import.meta.url), 'utf8'));
    definition.scenarios.find(scenario => scenario.name === 'deep').expect.sum = -1;
    const path = join(fixture, 'scenarios.json');
    writeFileSync(path, JSON.stringify(definition));
    const child = run({ RRX_SCENARIOS: path });
    assert.equal(child.status, 2, child.stderr);
    const row = child.stdout.trim().split('\n').map(JSON.parse).find(entry => entry.scenario === 'deep');
    assert.equal(row.fail, 'checksum');
    assert.equal(row.ms, null);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('paired workers use the same relative scenario definition across checkout directories', () => {
  const scratch = join(root, 'artifact/tmp/reactivity-test');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(join(scratch, 'paired-'));
  try {
    const definition = JSON.parse(readFileSync(new URL('../bench/reactivity/scenarios.json', import.meta.url), 'utf8'));
    definition.warmup = 0;
    definition.rounds = 1;
    const path = join(fixture, 'scenarios.json');
    writeFileSync(path, JSON.stringify(definition));
    const source = packageRoot('rrx-core');
    const child = spawnSync(process.execPath, ['bench/reactivity/paired.mjs', '1', 'deep', source, source], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, RRX_SCENARIOS: relative(root, path) },
    });
    assert.equal(child.status, 0, child.stderr);
    const rows = child.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.filter(row => row.scenario === 'deep').length, 2);
    assert.ok(rows.filter(row => row.scenario === 'deep').every(row => row.sum === 100250 && row.runs === 401));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

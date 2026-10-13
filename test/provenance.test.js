import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from '../provenance.mjs';

test('benchmark provenance distinguishes unknown, clean, unstaged, staged and untracked inputs', async () => {
  const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../artifact/tmp/bench-provenance-test');
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, 'fixture-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git(['init', '--quiet']);
    assert.equal(provenance(cwd).commit, null);
    assert.equal(provenance(cwd).dirty, null);
    await writeFile(join(cwd, 'input.js'), 'export const value = 1;\n');
    git(['add', 'input.js']);
    git(['-c', 'user.name=Benchmark Test', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'Set fixture input']);
    const commit = git(['rev-parse', 'HEAD']);
    assert.equal(provenance(cwd).commit, commit);
    assert.equal(provenance(cwd).dirty, false);
    await writeFile(join(cwd, 'input.js'), 'export const value = 2;\n');
    assert.equal(provenance(cwd).dirty, true);
    git(['add', 'input.js']);
    assert.equal(provenance(cwd).dirty, true);
    git(['restore', '--source=HEAD', '--staged', '--worktree', 'input.js']);
    await writeFile(join(cwd, 'new.js'), 'export const other = 1;\n');
    assert.equal(provenance(cwd).dirty, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('benchmark provenance includes inherited NODE_OPTIONS separately from command-line flags', () => {
  const module = new URL('../provenance.mjs', import.meta.url).href;
  const code = `import { provenance } from ${JSON.stringify(module)}; console.log(JSON.stringify(provenance(process.cwd())));`;
  const nodeOptions = '--max-old-space-size=96 --disable-wasm-trap-handler';
  const output = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
  const result = JSON.parse(output);
  assert.equal(result.nodeOptions, nodeOptions);
  assert.ok(result.flags.includes('--no-warnings'));
  assert.ok(!result.flags.includes('--max-old-space-size=96'));
  assert.equal(result.node, process.version);
});

test('benchmark provenance is unknown for a directory inside another repository, not that repository\'s', async () => {
  const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../artifact/tmp/bench-provenance-test');
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, 'fixture-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git(['init', '--quiet']);
    await mkdir(join(cwd, 'package'));
    await writeFile(join(cwd, 'package', 'input.js'), 'export const value = 1;\n');
    git(['add', '.']);
    git(['-c', 'user.name=Benchmark Test', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'Set fixture input']);
    // git rev-parse walks up to the enclosing repository: its clean identity is not the directory's.
    assert.deepEqual([provenance(join(cwd, 'package')).commit, provenance(join(cwd, 'package')).dirty], [null, null]);
    // A link to a repository's top is that repository.
    await symlink(cwd, join(scratch, `${cwd.split('/').pop()}-link`));
    const linked = provenance(join(scratch, `${cwd.split('/').pop()}-link`));
    assert.equal(linked.commit, git(['rev-parse', 'HEAD']));
    assert.equal(linked.dirty, false);
  } finally {
    await rm(join(scratch, `${cwd.split('/').pop()}-link`), { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

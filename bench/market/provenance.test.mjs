import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from '../../provenance.mjs';

const revision = cwd => {
  const { commit, dirty } = provenance(cwd);
  return { commit, dirty };
};

test('benchmark provenance distinguishes clean, unstaged, staged and untracked inputs', async () => {
  const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifact/tmp/market-provenance-test');
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, 'fixture-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git(['init', '--quiet']);
    assert.deepEqual(revision(cwd), { commit: null, dirty: null });
    await writeFile(join(cwd, 'input.js'), 'export const value = 1;\n');
    git(['add', 'input.js']);
    git(['-c', 'user.name=Benchmark Test', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'Set fixture input']);
    const commit = git(['rev-parse', 'HEAD']);
    assert.deepEqual(revision(cwd), { commit, dirty: false });
    await writeFile(join(cwd, 'input.js'), 'export const value = 2;\n');
    assert.deepEqual(revision(cwd), { commit, dirty: true });
    git(['add', 'input.js']);
    assert.deepEqual(revision(cwd), { commit, dirty: true });
    git(['restore', '--source=HEAD', '--staged', '--worktree', 'input.js']);
    await writeFile(join(cwd, 'new.js'), 'export const other = 1;\n');
    assert.deepEqual(revision(cwd), { commit, dirty: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

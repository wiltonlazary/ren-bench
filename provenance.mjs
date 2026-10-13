import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';

/** Git and Node settings of a benchmark or library checkout. */
export function provenance(cwd) {
  let commit = null;
  let dirty = null;
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    // git walks up to an enclosing repository: a directory that is not its own repository's top has no
    // provenance of its own, and must not take that repository's.
    if (realpathSync(git(['rev-parse', '--show-toplevel'])) === realpathSync(cwd)) {
      commit = git(['rev-parse', 'HEAD']);
      dirty = git(['status', '--porcelain']) !== '';
    }
  } catch {
    // Unknown provenance must not masquerade as a clean checkout.
  }
  return { commit, dirty, node: process.version, flags: [...process.execArgv], nodeOptions: process.env.NODE_OPTIONS ?? '' };
}

/** Resolve the package actually loaded by a suite, including file-linked checkouts. */
export function packageRoot(name, from = import.meta.url) {
  const require = createRequire(from);
  let path = dirname(realpathSync(require.resolve(name)));
  for (;;) {
    const manifest = join(path, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return path;
    const parent = dirname(path);
    if (parent === path) throw new Error(`Cannot locate package root for ${name}`);
    path = parent;
  }
}

/** Versions and independent git states of the measured family packages. */
export function sources(names, from = import.meta.url) {
  return Object.fromEntries(names.map(name => {
    const path = packageRoot(name, from);
    const { version } = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    const { commit, dirty } = provenance(path);
    return [name, { path, version, commit, dirty }];
  }));
}

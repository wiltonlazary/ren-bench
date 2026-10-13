// Builds the market benchmark's implementations: esbuild bundles (ESM,
// minified, production defines), with each framework's own compiler step in
// an esbuild plugin (babel-preset-solid for Solid, @vue/compiler-sfc for Vue
// SFCs, svelte/compiler for Svelte). Family libraries resolve through their
// public package entries to the linked checkouts recorded in provenance.
//
//   node bench/market/build.mjs [--only a,b]   (run.mjs builds first itself)

import { build as esbuild } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { impls } from './impls.mjs';
import { ren as templates } from 'ren-core/esbuild';
import { solid } from './solid.mjs';
import { sources } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolvePath(here, '../..');
// Bundles go to the benchmark checkout's build directory through `artifact`.
export const artifact = join(lib, 'artifact');
export const dist = join(artifact, 'bench/market/dist');
const family = sources(['rrx-core', 'ren-core', 'ren-dom'], import.meta.url);

const vue = () => {
  const require = createRequire(join(here, 'package.json'));
  const { parse, compileScript } = require('@vue/compiler-sfc');
  return {
    name: 'vue',
    setup(b) {
      b.onLoad({ filter: /\.vue$/ }, a => {
        const { descriptor, errors } = parse(readFileSync(a.path, 'utf8'), { filename: a.path });
        if (errors.length) return { errors: errors.map(e => ({ text: String(e.message ?? e) })) };
        const script = compileScript(descriptor, { id: 'bench', inlineTemplate: true, isProd: true });
        return { contents: script.content, loader: 'js', resolveDir: dirname(a.path) };
      });
    },
  };
};

const svelte = async () => {
  const { compile } = await import(pathToFileURL(join(here, 'node_modules/svelte/src/compiler/index.js')).href);
  return {
    name: 'svelte',
    setup(b) {
      b.onLoad({ filter: /\.svelte$/ }, a => {
        const out = compile(readFileSync(a.path, 'utf8'), { filename: a.path, generate: 'client', dev: false, css: 'external' });
        return { contents: out.js.code, loader: 'js', resolveDir: dirname(a.path) };
      });
    },
  };
};

/** Bundle and gzip sizes of the files an implementation's page loads. */
function sizes(dir) {
  const out = { files: {}, min: 0, gzip: 0 };
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const bytes = readFileSync(join(dir, file));
    const gz = gzipSync(bytes, { level: 9 }).length;
    out.files[file] = { min: bytes.length, gzip: gz };
    out.min += bytes.length;
    out.gzip += gz;
  }
  return out;
}

/** Installed version of each recorded package. */
export function versions(impl) {
  const from = join(here, impl.from ?? '.');
  const out = {};
  for (const name of impl.packages) {
    for (const base of [join(from, 'node_modules', name), join(here, 'node_modules', name)]) {
      if (existsSync(join(base, 'package.json'))) {
        out[name] = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version;
        break;
      }
    }
  }
  if (impl.kind === 'ren' || impl.kind === 'ren-compiled') {
    for (const [name, source] of Object.entries(family)) out[name] = source.version;
  }
  const esb = JSON.parse(readFileSync(join(here, 'node_modules/esbuild/package.json'), 'utf8')).version;
  out.esbuild = esb;
  return out;
}

export async function build(list) {
  const result = {};
  for (const impl of list) {
    const outdir = join(dist, impl.name);
    mkdirSync(outdir, { recursive: true });
    const plugins = [];
    const options = {};
    if (impl.kind === 'solid') plugins.push(solid(join(here, impl.from ?? '.')));
    if (impl.kind === 'vue') plugins.push(vue());
    if (impl.kind === 'svelte') plugins.push(await svelte());
    if (impl.kind === 'ren') {
      Object.assign(options, { jsx: 'automatic', jsxImportSource: 'ren-core' });
    }
    // The same sources through the library's own compiler (ren-core/esbuild).
    if (impl.kind === 'ren-compiled') plugins.push(templates());
    if (impl.kind === 'react') Object.assign(options, { jsx: 'automatic', jsxImportSource: 'react' });
    if (impl.kind === 'preact') Object.assign(options, { jsx: 'automatic', jsxImportSource: 'preact' });
    const entryPoints = { main: join(here, impl.entry) };
    if (impl.worker) entryPoints.worker = join(here, impl.worker);
    await esbuild({
      entryPoints,
      outdir,
      bundle: true,
      format: 'esm',
      minify: true,
      target: 'es2022',
      platform: 'browser',
      conditions: ['production'],
      define: {
        'process.env.NODE_ENV': '"production"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
      loader: { '.css': 'text' },
      plugins,
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'warning',
      ...options,
    });
    result[impl.name] = sizes(outdir);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--only');
  const only = i < 0 ? null : process.argv[i + 1].split(',');
  const list = only ? impls.filter(x => only.includes(x.name)) : impls;
  const out = await build(list);
  for (const [name, s] of Object.entries(out)) console.log(`${name.padEnd(12)} ${String(s.min).padStart(8)} B min ${String(s.gzip).padStart(7)} B gzip`);
  writeFileSync(join(dist, 'sizes.json'), JSON.stringify(out, null, 1));
}

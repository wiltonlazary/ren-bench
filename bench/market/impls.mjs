// The implementations of the market benchmark. To add a variant, add an
// entry here (and its source under impl/): `name` (the --only key, and the
// dist/ and URL directory), `label`, `entry` (relative to bench/market),
// optional `worker` (a second entry bundled as worker.js next to main.js),
// `kind` (the build pipeline in build.mjs), `packages` (whose installed
// versions the results record, resolved from `from`, default bench/market)
// and `note` (anything that makes it not directly comparable).

export const impls = [
  { name: 'vanilla', label: 'vanilla JS', entry: 'impl/vanilla/main.js', kind: 'plain', packages: [] },
  { name: 'solid2', label: 'Solid 2', entry: 'impl/solid2/main.jsx', kind: 'solid', packages: ['solid-js', '@solidjs/web', '@solidjs/signals', 'babel-preset-solid', '@dom-expressions/babel-plugin-jsx'] },
  { name: 'solid1', label: 'Solid 1.9', entry: 'solid1/main.jsx', kind: 'solid', from: 'solid1', packages: ['solid-js', 'babel-preset-solid', 'babel-plugin-jsx-dom-expressions'] },
  { name: 'svelte', label: 'Svelte 5', entry: 'impl/svelte/main.js', kind: 'svelte', packages: ['svelte'] },
  { name: 'vue', label: 'Vue 3.5', entry: 'impl/vue/main.js', kind: 'vue', packages: ['vue', '@vue/compiler-sfc'] },
  { name: 'preact', label: 'Preact 10 + signals', entry: 'impl/preact/main.jsx', kind: 'preact', packages: ['preact', '@preact/signals', '@preact/signals-core'] },
  { name: 'lit', label: 'Lit 3', entry: 'impl/lit/main.js', kind: 'plain', packages: ['lit', 'lit-html', 'lit-element'], note: 'shadow root, like ren-dom $shadow' },
  { name: 'react', label: 'React 19', entry: 'impl/react/main.jsx', kind: 'react', packages: ['react', 'react-dom', 'scheduler'] },
  { name: 'ren-dom', label: 'ren-dom $dom', entry: 'impl/ren/dom.jsx', kind: 'ren', packages: [] },
  { name: 'ren-dom-stop', label: 'ren-dom $dom, retire off', entry: 'impl/ren/stop.jsx', kind: 'ren', packages: [], note: 'background disposal off (retire: false): every removed row stops at once' },
  { name: 'ren-dom-rrx', label: 'ren-dom $dom, rrx-core fallback drain', entry: 'impl/ren/rrx.jsx', kind: 'ren', packages: [], note: 'retires as ren-dom; swept by rrx-core\'s macrotask fallback drain (4 ms setTimeout slices) instead of ren-core\'s pacing' },
  { name: 'ren-shadow', label: 'ren-dom $shadow', entry: 'impl/ren/shadow.jsx', kind: 'ren', packages: [], note: 'shadow root' },
  { name: 'ren-worker', label: 'ren-dom $dom, worker', entry: 'impl/ren/remote.jsx', worker: 'impl/ren/worker.jsx', kind: 'ren', packages: [], note: 'app in a Worker; script/heap columns are main thread (+ worker heap)' },
  { name: 'ren-dom-c', label: 'ren-dom $dom, compiled', entry: 'impl/ren/dom.jsx', kind: 'ren-compiled', packages: [], note: 'ren-core/esbuild templates' },
  { name: 'ren-shadow-c', label: 'ren-dom $shadow, compiled', entry: 'impl/ren/shadow.jsx', kind: 'ren-compiled', packages: [], note: 'shadow root; ren-core/esbuild templates' },
  { name: 'ren-worker-c', label: 'ren-dom $dom, worker, compiled', entry: 'impl/ren/remote.jsx', worker: 'impl/ren/worker.jsx', kind: 'ren-compiled', packages: [], note: 'app in a Worker; ren-core/esbuild templates (built by the worker host through Host calls)' },
];

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { solid } from './solid.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = resolve(here, '../../artifact/tmp/solid-compiler-test');

/** A test's bound: a hung build or check fails the test instead of hanging the run. */
const bounded = { timeout: 30000 };

/**
 * Run the actual esbuild compiler integration and browser runtime. The window,
 * the globals and the fixture directory are released after the test `t`, pass,
 * fail or time-out (a finally never runs after a hung await); node:test keeps
 * every hook to the end of the run, so the hook holds them in a slot it clears.
 */
async function fixture(t, source, from, check) {
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'fixture-'));
  const window = new Window();
  const prior = Object.getOwnPropertyDescriptors(globalThis);
  const slot = {
    release: async () => {
      await window.happyDOM.close();
      for (const key of ['window', 'document', 'Node']) {
        if (prior[key]) Object.defineProperty(globalThis, key, prior[key]);
        else delete globalThis[key];
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
  t.after(() => {
    const release = slot.release;
    slot.release = null;
    return release?.();
  });
  Object.assign(globalThis, { window, document: window.document, Node: window.Node });
  const entry = join(dir, 'app.jsx');
  await writeFile(entry, source);
  const result = await build({ entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'browser', conditions: ['production'],
    nodePaths: [join(from, 'node_modules')], plugins: [solid(from)],
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
  const code = result.outputFiles[0].text;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${dir}`);
  await check(module, window.document);
  module.dispose?.();
}

test('Solid 2 preserves user properties, strings, templates, regexes and JSX text', bounded, async t => {
  await fixture(t, `
    import { render } from '@solidjs/web';
    export const object = { $$click: 1, $$other: 3 };
    object.$$other = 4;
    export const values = ['.$$click', \`.$$click\`, /[.$$click]/.test('_'), object.$$other];
    export const dispose = render(() => <div>
      <span>.$$click</span>
      <button onClick={() => object.$$click++}>click</button>
    </div>, document.body);
  `, here, ({ object, values }, document) => {
    assert.deepEqual(values, ['.$$click', '.$$click', false, 4]);
    assert.equal(document.querySelector('span').textContent, '.$$click');
    document.querySelector('button').click();
    assert.equal(object.$$click, 2);
    assert.equal(object.$$other, 4);
    assert.equal(Object.hasOwn(object, '_$$click'), false);
  });
});

for (const [version, from, web, key] of [
  [2, here, '@solidjs/web', '_$$'],
  [1, join(here, 'solid1'), 'solid-js/web', '$$'],
]) {
  test(`Solid ${version} delegates functions, bound data and dynamic handlers`, bounded, async t => {
    await fixture(t, `
      import { render } from '${web}';
      export const seen = [];
      const named = e => seen.push(['named', e.currentTarget.id]);
      const bound = (data, e) => seen.push([data, e.currentTarget.id]);
      const handlers = { click: e => seen.push(['dynamic', e.currentTarget.id]) };
      export const dispose = render(() => <div>
        <button id="inline" onClick={e => seen.push(['inline', e.currentTarget.id])}>inline</button>
        <button id="named" onClick={named}>named</button>
        <button id="bound" onClick={[bound, 42]}>bound</button>
        <button id="dynamic" onClick={handlers.click}>dynamic</button>
        <button id="double" onDblClick={e => seen.push(['double', e.currentTarget.id])}>double</button>
      </div>, document.body);
    `, from, ({ seen, dispose }, document) => {
      for (const id of ['inline', 'named', 'bound', 'dynamic']) {
        const button = document.getElementById(id);
        assert.equal(typeof button[key + 'click'], 'function', `${id} remains delegated`);
        button.click();
      }
      const double = document.getElementById('double');
      assert.equal(typeof double[key + 'dblclick'], 'function');
      double.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      assert.equal(document.getElementById('bound')[key + 'clickData'], 42);
      assert.deepEqual(seen, [['inline', 'inline'], ['named', 'named'], [42, 'bound'], ['dynamic', 'dynamic'], ['double', 'double']]);
      const detached = document.getElementById('inline');
      dispose();
      detached.click();
      assert.equal(seen.length, 5);
    });
  });
}

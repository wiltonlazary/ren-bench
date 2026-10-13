import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pinned JSX compiler emits $$event; @solidjs/web rc.9 owns _$$event.
 * Adapt only its generated delegated assignments, before code generation.
 * Babel preserves source locations on user nodes (including cloned nodes),
 * while the compiler's imports, delegation call and member assignments are
 * synthetic. The event list comes from that generated delegation call.
 * Once the compiler emits the runtime key this pass naturally does nothing.
 */
function delegatedKeys() {
  return {
    name: 'solid2-delegated-keys',
    post(file) {
      const delegates = new Set();
      for (const node of file.ast.program.body) {
        if (node.type !== 'ImportDeclaration' || node.source.value !== '@solidjs/web') continue;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && !specifier.loc && specifier.imported.name === 'delegateEvents') {
            delegates.add(specifier.local.name);
          }
        }
      }
      const keys = new Set();
      file.path.traverse({
        CallExpression({ node }) {
          if (node.loc || node.callee.type !== 'Identifier' || !delegates.has(node.callee.name)) return;
          const events = node.arguments[0];
          if (events?.type !== 'ArrayExpression') return;
          for (const event of events.elements) {
            if (event?.type !== 'StringLiteral') continue;
            keys.add(`$$${event.value}`);
            keys.add(`$$${event.value}Data`);
          }
        },
      });
      file.path.traverse({
        AssignmentExpression({ node }) {
          const target = node.left;
          if (node.loc || node.operator !== '=' || target.type !== 'MemberExpression' || target.loc || target.computed) return;
          if (target.object.type !== 'Identifier' || target.object.loc || target.property.type !== 'Identifier' || target.property.loc) return;
          if (keys.has(target.property.name)) target.property.name = `_${target.property.name}`;
        },
      });
    },
  };
}

/** Compile with each Solid implementation's own pinned compiler and runtime. */
export function solid(from) {
  const require = createRequire(join(from, 'package.json'));
  const babel = require('@babel/core');
  const preset = require.resolve('babel-preset-solid');
  const major = Number(JSON.parse(readFileSync(join(from, 'node_modules/solid-js/package.json'), 'utf8')).version.split('.')[0]);
  return {
    name: 'solid',
    setup(b) {
      b.onLoad({ filter: /\.jsx$/ }, async a => {
        const source = readFileSync(a.path, 'utf8');
        const out = await babel.transformAsync(source, {
          filename: a.path, presets: [[preset, { generate: 'dom' }]],
          plugins: major === 2 ? [delegatedKeys] : [],
          babelrc: false, configFile: false, sourceMaps: false,
        });
        return { contents: out.code, loader: 'js' };
      });
    },
  };
}

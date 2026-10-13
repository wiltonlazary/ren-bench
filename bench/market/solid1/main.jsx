// Solid 1.9: js-framework-benchmark's keyed solid (frameworks/keyed/solid),
// compiled by babel-preset-solid 1.9, on the shared data module. Async rows
// (async1k) are a createResource read under Suspense.

import { createSignal, createSelector, createResource, batch, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { id as nextId, label as nextLabel, later } from '../common/data.js';

const buildData = count => {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    const [label, setLabel] = createSignal(nextLabel());
    data[i] = { id: nextId(), label, setLabel };
  }
  return data;
};

const Button = ([id, text, fn]) => (
  <div class="col-sm-6 smallpad">
    <button prop:id={id} class="btn btn-primary btn-block" type="button" onClick={fn}>
      {text}
    </button>
  </div>
);

render(() => {
  const [data, setData] = createSignal([]);
  const [selected, setSelected] = createSignal(null);
  const run = () => setData(buildData(1_000));
  const runLots = () => setData(buildData(10_000));
  const add = () => setData(d => [...d, ...buildData(1_000)]);
  const update = () =>
    batch(() => {
      for (let i = 0, d = data(), len = d.length; i < len; i += 10) d[i].setLabel(l => l + ' !!!');
    });
  const [request, setRequest] = createSignal(0);
  const [loaded] = createResource(request, () =>
    later(1_000).then(rows =>
      rows.map(row => {
        const [label, setLabel] = createSignal(row.label);
        return { id: row.id, label, setLabel };
      }),
    ),
  );
  const runAsync = () => setRequest(n => n + 1);
  const clear = () =>
    batch(() => {
      setRequest(0);
      setData([]);
    });
  const swapRows = () => {
    const list = data().slice();
    if (list.length > 998) {
      const item = list[1];
      list[1] = list[998];
      list[998] = item;
      setData(list);
    }
  };
  const isSelected = createSelector(selected);

  return (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid 1</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <Button {...['run', 'Create 1,000 rows', run]} />
              <Button {...['runlots', 'Create 10,000 rows', runLots]} />
              <Button {...['add', 'Append 1,000 rows', add]} />
              <Button {...['update', 'Update every 10th row', update]} />
              <Button {...['clear', 'Clear', clear]} />
              <Button {...['swaprows', 'Swap Rows', swapRows]} />
              <Button {...['runasync', 'Create 1,000 rows async', runAsync]} />
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <Suspense>
          <For each={request() > 0 ? loaded() : data()}>
            {row => {
              const rowId = row.id;
              return (
                <tr class={isSelected(rowId) ? 'danger' : ''}>
                  <td class="col-md-1" textContent={rowId} />
                  <td class="col-md-4">
                    <a onClick={() => setSelected(rowId)} textContent={row.label()} />
                  </td>
                  <td class="col-md-1">
                    <a onClick={() => setData(d => d.toSpliced(d.findIndex(d => d.id === rowId), 1))}>
                      <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                    </a>
                  </td>
                  <td class="col-md-6" />
                </tr>
              );
            }}
          </For>
          </Suspense>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}, document.getElementById('main'));

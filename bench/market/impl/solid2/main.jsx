// Solid 2 (2.0.0-rc.9): the keyed solid implementation of
// js-framework-benchmark ported to the 2.0 API, compiled by
// babel-preset-solid 2.0.0-rc.2 (@dom-expressions/babel-plugin-jsx
// 0.50.0-next.44). 2.0 batches writes itself (no batch), For passes the raw
// row, and createSelector is gone: selection is a projection, the 2.0 idiom
// that notifies only the rows whose key changed. Async rows (async1k) are an
// async createMemo read under a Loading boundary, 2.0's async primitive.

import { createSignal, createProjection, createMemo, For, Loading } from 'solid-js';
import { render } from '@solidjs/web';
import { id as nextId, label as nextLabel, later } from '../../common/data.js';

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
    <button id={id} class="btn btn-primary btn-block" type="button" onClick={fn}>
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
  const update = () => {
    for (let i = 0, d = data(), len = d.length; i < len; i += 10) d[i].setLabel(l => l + ' !!!');
  };
  const [request, setRequest] = createSignal(0);
  const loaded = createMemo(async () => {
    if (request() === 0) return [];
    const rows = await later(1_000);
    return rows.map(row => {
      const [label, setLabel] = createSignal(row.label);
      return { id: row.id, label, setLabel };
    });
  });
  const runAsync = () => setRequest(n => n + 1);
  const clear = () => {
    setRequest(0);
    setData([]);
  };
  const swapRows = () => {
    const list = data().slice();
    if (list.length > 998) {
      const item = list[1];
      list[1] = list[998];
      list[998] = item;
      setData(list);
    }
  };
  let previous = null;
  const isSelected = createProjection(draft => {
    const id = selected();
    if (previous != null) delete draft[previous];
    if (id != null) draft[id] = true;
    previous = id;
  }, {});

  return (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid 2</h1>
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
          <Loading>
          <For each={request() > 0 ? loaded() : data()}>
            {row => {
              const rowId = row.id;
              return (
                <tr class={isSelected[rowId] ? 'danger' : ''}>
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
          </Loading>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}, document.getElementById('main'));

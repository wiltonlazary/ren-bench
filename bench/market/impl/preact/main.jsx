// Preact 10 + @preact/signals: js-framework-benchmark's keyed preact-signals
// (frameworks/keyed/preact-signals), on the shared data module. Signals bind
// straight to DOM properties (class, textContent). Async rows (async1k):
// Preact has no async data primitive (its Suspense is preact/compat, for lazy
// components), so the handler awaits the data and writes the signal.

import { signal, batch, useComputed } from '@preact/signals';
import { For } from '@preact/signals/utils';
import { render } from 'preact';
import { id as nextId, label as nextLabel, later } from '../../common/data.js';

function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) data[i] = { id: nextId(), label: signal(nextLabel()) };
  return data;
}

const Button = ({ id, text, fn }) => (
  <div class="col-sm-6 smallpad">
    <button id={id} class="btn btn-primary btn-block" type="button" onClick={fn}>
      {text}
    </button>
  </div>
);

const data = signal([]);
const selected = signal(null);

const run = () => {
    data.value = buildData(1000);
  },
  runLots = () => (data.value = buildData(10000)),
  add = () => {
    data.value = data.value.concat(buildData(1000));
  },
  update = () =>
    batch(() => {
      for (let i = 0, d = data.value, len = d.length; i < len; i += 10) d[i].label.value = d[i].label.value + ' !!!';
    }),
  swapRows = () => {
    const d = data.value.slice();
    if (d.length > 998) {
      const tmp = { ...d[1] };
      d[1] = { ...d[998] };
      d[998] = tmp;
      data.value = d;
    }
  },
  runAsync = async () => {
    const rows = await later(1000);
    data.value = rows.map(row => ({ id: row.id, label: signal(row.label) }));
  },
  clear = () => (data.value = []),
  remove = id => {
    const idx = data.value.findIndex(d => d.id === id);
    data.value = [...data.value.slice(0, idx), ...data.value.slice(idx + 1)];
  },
  select = id => {
    selected.value = id;
  };

const Row = ({ id, label }) => {
  const rowClass = useComputed(() => (selected.value === id ? 'danger' : ''));
  return (
    <tr class={rowClass}>
      <td class="col-md-1" textContent={id} />
      <td class="col-md-4">
        <a onClick={() => select(id)} textContent={label} />
      </td>
      <td class="col-md-1">
        <a onClick={() => remove(id)}>
          <span class="glyphicon glyphicon-remove" aria-hidden="true" />
        </a>
      </td>
      <td class="col-md-6" />
    </tr>
  );
};

const App = () => (
  <div class="container">
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6">
          <h1>Preact signals</h1>
        </div>
        <div class="col-md-6">
          <div class="row">
            <Button id="run" text="Create 1,000 rows" fn={run} />
            <Button id="runlots" text="Create 10,000 rows" fn={runLots} />
            <Button id="add" text="Append 1,000 rows" fn={add} />
            <Button id="update" text="Update every 10th row" fn={update} />
            <Button id="clear" text="Clear" fn={clear} />
            <Button id="swaprows" text="Swap Rows" fn={swapRows} />
            <Button id="runasync" text="Create 1,000 rows async" fn={runAsync} />
          </div>
        </div>
      </div>
    </div>
    <table class="table table-hover table-striped test-data">
      <tbody>
        <For each={data}>{row => <Row key={row.id} id={row.id} label={row.label} />}</For>
      </tbody>
    </table>
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
  </div>
);

render(<App />, document.getElementById('main'));

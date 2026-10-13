// ren-core and ren-dom: the table as a ren-core user writes it with the library as it stands
// (src/ of this checkout, unmodified). One definition, run by every ren-core
// variant: $dom direct, $shadow direct, and $dom in worker mode (the same view
// served from a Worker), each with the automatic JSX runtime and compiled
// by ren-core/esbuild (the -c variants). Rows are keyed (For by id); a row's label is a
// signal read as a dynamic child; selection uses rrx-core $select (O(1): only the
// old and new rows' bindings run); handlers are per-element onClick (the DOM
// renderers delegate them to the root's container). Handlers run in an rrx-core $batch already.
// Async rows (async1k) come through an rrx-core $task, whose pending read keeps
// the list as it is until the rows arrive.

import { $signal, $read, $write, $select, $task } from 'rrx-core';
import { For } from 'ren-core';
import { id as nextId, label as nextLabel, later } from '../../common/data.js';

/** @param {import('rrx-core').Graph} root */
export function Bench(root) {
  const rows = $signal(root, []);
  const selected = $signal(root, 0);
  const isSelected = $select(root, () => $read(selected));
  const build = count => {
    const data = new Array(count);
    for (let i = 0; i < count; i++) data[i] = { id: nextId(), label: $signal(root, nextLabel()) };
    return data;
  };
  const run = () => $write(rows, build(1000));
  const runLots = () => $write(rows, build(10000));
  const add = () => $write(rows, $read(rows).concat(build(1000)));
  const update = () => {
    const list = $read(rows);
    for (let i = 0; i < list.length; i += 10) $write(list[i].label, `${$read(list[i].label)} !!!`);
  };
  const request = $signal(root, 0);
  const loaded = $task(root, () => $read(request), (n, complete) => {
    if (n === 0) complete({ ok: true, value: [] });
    else later(1000).then(data => complete({ ok: true, value: data.map(row => ({ id: row.id, label: $signal(root, row.label) })) }));
  });
  const runAsync = () => $write(request, $read(request) + 1);
  const clear = () => {
    $write(request, 0);
    $write(rows, []);
  };
  const swapRows = () => {
    const list = $read(rows).slice();
    if (list.length > 998) {
      const item = list[1];
      list[1] = list[998];
      list[998] = item;
      $write(rows, list);
    }
  };
  const remove = id => {
    const list = $read(rows);
    $write(rows, list.toSpliced(list.findIndex(row => row.id === id), 1));
  };
  const Button = ({ id, text, fn }) => (
    <div class="col-sm-6 smallpad">
      <button id={id} class="btn btn-primary btn-block" type="button" onClick={fn}>
        {text}
      </button>
    </div>
  );
  return () => (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>ren-dom</h1>
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
          <For each={() => ($read(request) > 0 ? $read(loaded) : $read(rows))} by={row => row.id}>
            {row => {
              const { id, label } = row();
              return (
                <tr class={() => (isSelected(id) ? 'danger' : '')}>
                  <td class="col-md-1">{String(id)}</td>
                  <td class="col-md-4">
                    <a onClick={() => $write(selected, id)}>{label}</a>
                  </td>
                  <td class="col-md-1">
                    <a onClick={() => remove(id)}>
                      <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                    </a>
                  </td>
                  <td class="col-md-6" />
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}

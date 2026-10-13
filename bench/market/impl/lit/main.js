// Lit 3: js-framework-benchmark's keyed lit (frameworks/keyed/lit), on the
// shared data module, in plain JS (reactive properties declared statically
// instead of with TypeScript decorators). As there, the view lives in the
// element's shadow root, one delegated click listener serves the table, and
// the shared stylesheet is adopted by the shadow root. Async rows (async1k):
// lit-html's until directive over the promise of the rows.

import { LitElement, html, unsafeCSS, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { until } from 'lit/directives/until.js';
import css from '../../common/style.css';
import { rows as buildData, later } from '../../common/data.js';

class Store {
  data = [];
  selected = undefined;
  updateData() {
    const newData = [...this.data];
    for (let i = 0; i < newData.length; i += 10) newData[i].label += ' !!!';
    this.data = newData;
  }
  delete(id) {
    const idx = this.data.findIndex(d => d.id == id);
    this.data = this.data.slice(0, idx).concat(this.data.slice(idx + 1));
  }
  run() {
    this.data = buildData(1000);
    this.selected = undefined;
  }
  add() {
    this.data = this.data.concat(buildData(1000));
  }
  update() {
    this.updateData();
  }
  select(id) {
    this.selected = id;
  }
  runLots() {
    this.data = buildData(10000);
    this.selected = undefined;
  }
  clear() {
    this.data = [];
    this.selected = undefined;
  }
  swapRows() {
    if (this.data.length > 998) {
      const d1 = this.data[1];
      const d998 = this.data[998];
      this.data = this.data.map((data, i) => (i === 1 ? d998 : i === 998 ? d1 : data));
    }
  }
}

const store = new Store();

class MainElement extends LitElement {
  static properties = { _rows: { state: true }, _selected: { state: true }, _pending: { state: true } };
  static styles = unsafeCSS(css);
  constructor() {
    super();
    this._rows = store.data;
    this._selected = store.selected;
    this._pending = null;
    this._row = item => html`<tr class=${item.id == this._selected ? 'danger' : ''}><td class="col-md-1">${item.id}</td><td class="col-md-4"><a data-action="select" data-id=${item.id}>${item.label}</a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true" data-action="remove" data-id=${item.id}></span></a></td><td class="col-md-6"></td></tr>`;
  }
  render() {
    return html`
      <div class="container">
        <div class="jumbotron">
          <div class="row">
            <div class="col-md-6"><h1>Lit 3</h1></div>
            <div class="col-md-6">
              <div class="row">
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run" @click=${this._run}>Create 1,000 rows</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots" @click=${this._runLots}>Create 10,000 rows</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add" @click=${this._add}>Append 1,000 rows</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update" @click=${this._update}>Update every 10th row</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear" @click=${this._clear}>Clear</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows" @click=${this._swapRows}>Swap Rows</button></div>
                <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runasync" @click=${this._runAsync}>Create 1,000 rows async</button></div>
              </div>
            </div>
          </div>
        </div>
        <table class="table table-hover table-striped test-data" @click=${this._handleClick}>
          <tbody>${this._pending !== null ? until(this._pending, nothing) : repeat(this._rows, item => item.id, this._row)}</tbody>
        </table>
        <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
      </div>
    `;
  }
  _handleClick(e) {
    const { action, id } = e.target.dataset;
    if (action && id) this['_' + action](Number(id));
  }
  _add() {
    store.add();
    this._sync();
  }
  _remove(id) {
    store.delete(id);
    this._sync();
  }
  _select(id) {
    store.select(id);
    this._sync();
  }
  _run() {
    this._pending = null;
    store.run();
    this._sync();
  }
  _update() {
    store.update();
    this._sync();
  }
  _runLots() {
    this._pending = null;
    store.runLots();
    this._sync();
  }
  _runAsync() {
    store.clear();
    this._sync();
    this._pending = later(1000).then(rows => {
      store.data = rows;
      return repeat(rows, item => item.id, this._row);
    });
  }
  _clear() {
    this._pending = null;
    store.clear();
    this._sync();
  }
  _swapRows() {
    store.swapRows();
    this._sync();
  }
  _sync() {
    this._rows = store.data;
    this._selected = store.selected;
  }
}
customElements.define('main-element', MainElement);

globalThis.benchScope = () => document.querySelector('main-element')?.shadowRoot ?? null;
document.getElementById('main').appendChild(document.createElement('main-element'));

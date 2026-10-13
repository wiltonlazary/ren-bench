// Hand-optimized vanilla JS: js-framework-benchmark's keyed vanillajs
// (frameworks/keyed/vanillajs/src/Main.js), on the shared data module. The
// static skeleton is the one of its index.html; one delegated listener per
// region, a cloned row template, and direct text-node writes. Async rows
// (async1k): the handler awaits the data, then runs the create path.

import { rows as build, later } from '../../common/data.js';

const BUTTONS = [
  ['run', 'Create 1,000 rows'],
  ['runlots', 'Create 10,000 rows'],
  ['add', 'Append 1,000 rows'],
  ['update', 'Update every 10th row'],
  ['clear', 'Clear'],
  ['swaprows', 'Swap Rows'],
  ['runasync', 'Create 1,000 rows async'],
];
document.getElementById('main').innerHTML =
  '<div class="container"><div class="jumbotron"><div class="row"><div class="col-md-6"><h1>VanillaJS keyed</h1></div><div class="col-md-6"><div class="row">' +
  BUTTONS.map(([id, text]) => `<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="${id}">${text}</button></div>`).join('') +
  '</div></div></div></div><table class="table table-hover table-striped test-data"><tbody id="tbody"></tbody></table>' +
  '<span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span></div>';

const rowTemplate = document.createElement('tr');
rowTemplate.innerHTML =
  "<td class='col-md-1'> </td><td class='col-md-4'><a> </a></td><td class='col-md-1'><a><span class='glyphicon glyphicon-remove' aria-hidden='true'></span></a></td><td class='col-md-6'></td>";

class Store {
  constructor() {
    this.data = [];
    this.selected = null;
  }
  updateData() {
    for (let i = 0; i < this.data.length; i += 10) this.data[i].label += ' !!!';
  }
  delete(id) {
    const idx = this.data.findIndex(d => d.id == id);
    this.data = this.data.filter((e, i) => i != idx);
    return this;
  }
  run() {
    this.data = build(1000);
    this.selected = null;
  }
  add() {
    this.data = this.data.concat(build(1000));
    this.selected = null;
  }
  update() {
    this.updateData();
    this.selected = null;
  }
  select(id) {
    this.selected = id;
  }
  runLots() {
    this.data = build(10000);
    this.selected = null;
  }
  clear() {
    this.data = [];
    this.selected = null;
  }
  swapRows() {
    if (this.data.length > 998) {
      const a = this.data[1];
      this.data[1] = this.data[998];
      this.data[998] = a;
    }
  }
}

const getParentId = elem => {
  while (elem) {
    if (elem.tagName === 'TR') return elem.data_id;
    elem = elem.parentNode;
  }
  return undefined;
};

class Main {
  constructor() {
    this.store = new Store();
    this.rows = [];
    this.data = [];
    this.selectedRow = undefined;
    document.getElementById('main').addEventListener('click', e => {
      const t = e.target;
      if (t.matches('#add')) (e.stopPropagation(), this.add());
      else if (t.matches('#run')) (e.stopPropagation(), this.run());
      else if (t.matches('#update')) (e.stopPropagation(), this.update());
      else if (t.matches('#runlots')) (e.stopPropagation(), this.runLots());
      else if (t.matches('#clear')) (e.stopPropagation(), this.clear());
      else if (t.matches('#swaprows')) (e.stopPropagation(), this.swapRows());
      else if (t.matches('#runasync')) (e.stopPropagation(), this.runAsync());
    });
    this.tbody = document.getElementById('tbody');
    this.table = document.getElementsByTagName('table')[0];
    this.tbody.addEventListener('click', e => {
      e.stopPropagation();
      let p = e.target;
      while (p && p.tagName !== 'TD') p = p.parentNode;
      if (!p) return;
      if (p.parentNode.childNodes[1] == p) {
        const id = getParentId(e.target);
        this.select(this.data.findIndex(row => row.id === id));
      } else if (p.parentNode.childNodes[2] == p) {
        const id = getParentId(e.target);
        this.delete(this.data.findIndex(row => row.id === id));
      }
    });
  }
  async runAsync() {
    const data = await later(1000);
    this.removeAllRows();
    this.store.clear();
    this.rows = [];
    this.data = [];
    this.store.data = data;
    this.appendRows();
    this.unselect();
  }
  run() {
    this.removeAllRows();
    this.store.clear();
    this.rows = [];
    this.data = [];
    this.store.run();
    this.appendRows();
    this.unselect();
  }
  add() {
    this.store.add();
    this.appendRows();
  }
  update() {
    this.store.update();
    for (let i = 0; i < this.data.length; i += 10) this.rows[i].childNodes[1].childNodes[0].firstChild.nodeValue = this.store.data[i].label;
  }
  unselect() {
    if (this.selectedRow !== undefined) {
      this.selectedRow.className = '';
      this.selectedRow = undefined;
    }
  }
  select(idx) {
    this.unselect();
    this.store.select(this.data[idx].id);
    this.selectedRow = this.rows[idx];
    this.selectedRow.className = 'danger';
  }
  recreateSelection() {
    const old = this.store.selected;
    const idx = this.store.data.findIndex(d => d.id === old);
    if (idx >= 0) {
      this.store.select(this.data[idx].id);
      this.selectedRow = this.rows[idx];
      this.selectedRow.className = 'danger';
    }
  }
  delete(idx) {
    this.store.delete(this.data[idx].id);
    this.rows[idx].remove();
    this.rows.splice(idx, 1);
    this.data.splice(idx, 1);
    this.unselect();
    this.recreateSelection();
  }
  removeAllRows() {
    this.tbody.textContent = '';
  }
  runLots() {
    this.removeAllRows();
    this.store.clear();
    this.rows = [];
    this.data = [];
    this.store.runLots();
    this.appendRows();
    this.unselect();
  }
  clear() {
    this.store.clear();
    this.rows = [];
    this.data = [];
    this.removeAllRows();
    this.unselect();
  }
  swapRows() {
    if (this.data.length > 10) {
      this.store.swapRows();
      this.data[1] = this.store.data[1];
      this.data[998] = this.store.data[998];
      this.tbody.insertBefore(this.rows[998], this.rows[2]);
      this.tbody.insertBefore(this.rows[1], this.rows[999]);
      const tmp = this.rows[998];
      this.rows[998] = this.rows[1];
      this.rows[1] = tmp;
    }
  }
  appendRows() {
    const rows = this.rows;
    const s = this.store.data;
    const data = this.data;
    const tbody = this.tbody;
    const empty = !tbody.firstChild;
    if (empty) tbody.remove();
    for (let i = rows.length; i < s.length; i++) {
      const tr = this.createRow(s[i]);
      rows[i] = tr;
      data[i] = s[i];
      tbody.appendChild(tr);
    }
    if (empty) this.table.insertBefore(tbody, null);
  }
  createRow(data) {
    const tr = rowTemplate.cloneNode(true);
    const td1 = tr.firstChild;
    const a2 = td1.nextSibling.firstChild;
    tr.data_id = data.id;
    td1.firstChild.nodeValue = data.id;
    a2.firstChild.nodeValue = data.label;
    return tr;
  }
}

new Main();

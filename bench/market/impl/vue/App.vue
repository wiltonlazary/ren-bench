<!-- Vue 3.5: js-framework-benchmark's keyed vue (frameworks/keyed/vue/src/App.vue),
     on the shared data module; compiled by @vue/compiler-sfc (inline template, production).
     Async rows (async1k): Vue's Suspense is experimental and serves async
     components, not data, so the handler awaits the data (the documented way). -->
<script setup>
import { ref, shallowRef } from 'vue'
import { rows as buildData, later } from '../../common/data.js'

const selected = ref()
const rows = shallowRef([])

function setRows(update = rows.value.slice()) {
  rows.value = update
}
function add() {
  rows.value = rows.value.concat(buildData(1000))
}
function remove(id) {
  rows.value.splice(rows.value.findIndex((d) => d.id === id), 1)
  setRows()
}
function select(id) {
  selected.value = id
}
function run() {
  setRows(buildData(1000))
  selected.value = undefined
}
function update() {
  const _rows = rows.value
  for (let i = 0; i < _rows.length; i += 10) _rows[i].label += ' !!!'
  setRows()
}
async function runAsync() {
  const data = await later(1000)
  setRows(data)
  selected.value = undefined
}
function runLots() {
  setRows(buildData(10000))
  selected.value = undefined
}
function clear() {
  setRows([])
  selected.value = undefined
}
function swapRows() {
  const _rows = rows.value
  if (_rows.length > 998) {
    const d1 = _rows[1]
    _rows[1] = _rows[998]
    _rows[998] = d1
    setRows()
  }
}
</script>

<template>
  <div class="container">
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6"><h1>Vue 3.5</h1></div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run" @click="run">Create 1,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots" @click="runLots">Create 10,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add" @click="add">Append 1,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update" @click="update">Update every 10th row</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear" @click="clear">Clear</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows" @click="swapRows">Swap Rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runasync" @click="runAsync">Create 1,000 rows async</button></div>
          </div>
        </div>
      </div>
    </div>
    <table class="table table-hover table-striped test-data">
      <tbody>
        <tr v-for="{ id, label } of rows" :key="id" :class="{ danger: id === selected }" v-memo="[label, id === selected]">
          <td class="col-md-1">{{ id }}</td>
          <td class="col-md-4"><a @click="select(id)">{{ label }}</a></td>
          <td class="col-md-1"><a @click="remove(id)"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      </tbody>
    </table>
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
  </div>
</template>

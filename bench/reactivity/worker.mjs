// One (library, scenario) measurement in its own process:
//   node worker.mjs <library> <scenario> [warmup] [rounds]
// Prints one JSON line: {"library", "scenario", "ms", "sum", "runs"}, plus
// "blocking" for a scenario that reports it.

import { adapters } from './adapters.mjs';
import { definition, scenarios } from './scenarios.mjs';

const [library, scenario, warm, count] = process.argv.slice(2);
const parameters = definition.scenarios.find(s => s.name === scenario);
if (!parameters || !adapters[library]) {
  console.error(`unknown library or scenario: ${library} ${scenario}`);
  process.exit(2);
}
const warmup = Number(warm ?? definition.warmup);
const rounds = Number(count ?? definition.rounds);
const adapter = await adapters[library]();
const run = scenarios[scenario];
let result;
// A scenario may be asynchronous (steps): its promise is awaited, inside the timing.
const once = () => run(adapter, parameters);
for (let i = 0; i < warmup; i++) {
  result = once();
  if (result instanceof Promise) result = await result;
}
const times = [];
const blocking = [];
for (let i = 0; i < rounds; i++) {
  const started = process.hrtime.bigint();
  result = once();
  if (result instanceof Promise) result = await result;
  if (result.blocking !== undefined) blocking.push(result.blocking);
  times.push(Number(process.hrtime.bigint() - started) / 1e6);
}
times.sort((a, b) => a - b);
blocking.sort((a, b) => a - b);
/** @type {Record<string, unknown>} */
const line = { library, scenario, ms: times[Math.floor(rounds / 2)], sum: result.sum, runs: result.runs };
// Scenarios that report the caller-blocking part of a run (disposal): its median.
if (blocking.length > 0) line.blocking = blocking[Math.floor(blocking.length / 2)];
console.log(JSON.stringify(line));

// The table's data, shared by every implementation: the word lists of
// js-framework-benchmark, and a seeded generator instead of Math.random, so
// every implementation produces the same labels in the same order and the
// harness compares like with like. Ids start at 1 on each page load.

const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const NOUNS = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

let seed = 1;
let next = 1;
const random = max => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % max;

/** The next row id. */
export const id = () => next++;

/** The next label. */
export const label = () => `${ADJECTIVES[random(ADJECTIVES.length)]} ${COLOURS[random(COLOURS.length)]} ${NOUNS[random(NOUNS.length)]}`;

/** Plain rows `{ id, label }`, for implementations whose rows are plain data. */
export function rows(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) data[i] = { id: next++, label: label() };
  return data;
}

/**
 * The async benchmark's source: plain rows delivered after a macrotask, as a
 * fetch would, so every implementation waits the same one timer turn and
 * then goes through its own async path. The rows are made when the promise
 * resolves (ids stay consecutive).
 * timer: feature, the fetch latency every implementation waits alike.
 */
export const later = count => new Promise(resolve => setTimeout(() => resolve(rows(count)), 0));

// Run: node test/plan.test.mjs
// Replays generated plans against a simulated text buffer and checks the
// result equals the input exactly, across many seeds and settings.
import { buildPlan, normalize, graphemes, estimateMs } from '../humanizer.js';
import assert from 'node:assert/strict';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function replay(plan) {
  const buf = [];
  for (const a of plan) {
    if (a.type === 'insert') buf.push(a.text);
    else if (a.key.key === 'Backspace') buf.pop();
    else if (a.key.key === 'Enter') buf.push('\n');
    else buf.push(a.key.text);
  }
  return buf.join('');
}

const samples = [
  'Hello world',
  'Shipping a KMP app this weekend 🚀\n\nStack: Compose, Ktor, SQLDelight. Thoughts?',
  'Curly “quotes” and it’s — dashes… plus émojis 👨‍👩‍👧 and #hashtags @someone',
  'Tabs\tand\r\nwindows newlines, $100 & 50% off! (really?) {braces} [brackets] <angles> a|b ~`^_+=',
  'aaaa bbbb ZZZZ 1234567890',
  '',
];

let runs = 0;
for (const text of samples) {
  for (const typoRate of [0, 0.025, 0.2]) {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = buildPlan(text, { wpm: 60, typoRate, thinkingPauses: true }, mulberry32(seed));
      assert.equal(replay(plan), normalize(text), `mismatch seed=${seed} typo=${typoRate}`);
      for (const a of plan) assert.ok(a.delay >= 0 && Number.isFinite(a.delay));
      runs++;
    }
  }
}

// Speed sanity: realised WPM should be roughly in the ballpark of the target.
const prose = 'The quick brown fox jumps over the lazy dog and then keeps running across the field ' .repeat(10);
for (const wpm of [40, 60, 90]) {
  let sum = 0;
  for (let s = 1; s <= 30; s++) sum += estimateMs(buildPlan(prose, { wpm, typoRate: 0.02 }, mulberry32(s)));
  const ms = sum / 30;
  const realised = (graphemes(prose).length / 5) / (ms / 60000);
  console.log(`target ${wpm} WPM -> realised ~${realised.toFixed(1)} WPM (incl. pauses & typos)`);
  assert.ok(realised > wpm * 0.55 && realised < wpm * 1.15);
}

console.log(`OK: ${runs} plans replayed exactly`);

// Converts text into a timed "keystroke plan" that mimics a human typist.
//
// Each action carries `delay`: ms from the PREVIOUS key-down to THIS key-down
// (the inter-key interval), and keys carry `hold`: ms between key-down and key-up.
//
// Timing model
//   base interval  = 60 000 / (WPM × 5)          (5 chars per "word")
//   jitter         = log-normal, σ = 0.4         (human IKIs are right-skewed)
//   modifiers      = word start, Shift, digits/symbols, same vs alternating hand
//   pauses         = after punctuation, newlines, random "thinking" at word starts
//   typos          = adjacent-key error, sometimes noticed 1–2 chars late,
//                    then backspaced and corrected

import { keyFor, neighborOf, handOf, BACKSPACE } from './keyboard.js';

export const DEFAULTS = { wpm: 55, typoRate: 0.025, thinkingPauses: true };

export function normalize(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/ /g, ' ');
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** Split into user-perceived characters so emoji / ZWJ sequences stay intact. */
export function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), s => s.segment) : Array.from(text);
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const uniform = (rng, a, b) => a + (b - a) * rng();
const isAsciiLetter = ch => /^[a-zA-Z]$/.test(ch);

export function buildPlan(rawText, options = {}, rng = Math.random) {
  const o = { ...DEFAULTS, ...options };
  const base = 60000 / (o.wpm * 5);
  const g = graphemes(normalize(rawText));
  const plan = [];

  const keyAct = (desc, delay) => ({
    type: 'key',
    key: desc,
    delay: Math.round(delay),
    hold: Math.round(uniform(rng, 45, 110)),
  });

  const interval = (prev, cur) => {
    // log-normal with mean ≈ base
    let t = base * Math.exp(0.4 * gauss(rng) - 0.08);
    t = Math.min(Math.max(t, base * 0.35), base * 4);

    const pd = keyFor(prev);
    const cd = keyFor(cur);
    if (prev === ' ') t *= 1.25;                            // starting a new word
    if (cd?.shift && !pd?.shift) t *= 1.3;                  // reaching for Shift
    if (cd && /[0-9]/.test(cur)) t *= 1.15;                 // number row
    if (cd && !/[a-zA-Z0-9 \n]/.test(cur)) t *= 1.2;        // symbols
    const hp = handOf(prev), hc = handOf(cur);
    if (hp && hc) t *= hp === hc ? 1.1 : 0.85;              // hand alternation
    if (prev === cur) t *= 1.1;                             // same key twice

    if (prev && /[.!?…]/.test(prev)) t += uniform(rng, 250, 800) * (o.thinkingPauses ? 1 : 0.5);
    else if (prev && /[,;:]/.test(prev)) t += uniform(rng, 80, 250);
    if (prev === '\n') t += uniform(rng, 350, 1000);
    if (o.thinkingPauses && prev === ' ' && rng() < 0.025) t += uniform(rng, 600, 2000);
    return t;
  };

  let prev = null;
  for (let i = 0; i < g.length; i++) {
    const cur = g[i];
    let delay = i === 0 ? uniform(rng, 150, 350) : interval(prev, cur);
    const desc = keyFor(cur);

    // ---- typo injection (letters only) ----
    if (desc && o.typoRate > 0 && isAsciiLetter(cur) && rng() < o.typoRate) {
      const wrong = neighborOf(cur, rng);
      if (wrong) {
        plan.push(keyAct(keyFor(wrong), delay));
        // Humans often notice the mistake a character or two later.
        const r = rng();
        const extra = r < 0.55 ? 0 : r < 0.85 ? 1 : 2;
        let p = wrong, typed = 1;
        for (let j = 1; j <= extra && i + j < g.length && isAsciiLetter(g[i + j]); j++) {
          plan.push(keyAct(keyFor(g[i + j]), interval(p, g[i + j])));
          p = g[i + j];
          typed++;
        }
        for (let k = 0; k < typed; k++) {
          plan.push(keyAct(BACKSPACE, k === 0 ? uniform(rng, 250, 650) : base * uniform(rng, 0.6, 1.0)));
        }
        delay = uniform(rng, 120, 280);
      }
    }

    if (desc) {
      plan.push(keyAct(desc, delay));
    } else {
      // Not on the keyboard: emoji take a moment to "pick", typographic chars less so.
      const extra = EMOJI_RE.test(cur) ? uniform(rng, 300, 900) : uniform(rng, 50, 200);
      plan.push({ type: 'insert', text: cur, delay: Math.round(delay + extra) });
    }
    prev = cur;
  }
  return plan;
}

export function estimateMs(plan) {
  let total = 0;
  for (const a of plan) total += Math.max(a.delay, a.hold || 0);
  return total;
}

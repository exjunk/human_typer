// US-QWERTY layout model.
// Maps a character to the physical key a human would press, in the shape
// Chrome DevTools Protocol's Input.dispatchKeyEvent expects.

const SHIFTED_TO_BASE = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
  '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[',
  '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};

// base char -> [KeyboardEvent.code, windowsVirtualKeyCode]
const PUNCT_KEYS = {
  '`': ['Backquote', 192], '-': ['Minus', 189], '=': ['Equal', 187],
  '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220],
  ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188],
  '.': ['Period', 190], '/': ['Slash', 191], ' ': ['Space', 32],
};

/**
 * @returns {{key:string, code:string, keyCode:number, shift:boolean, text:string, unmodified:string} | null}
 *   null => character is not on a US keyboard (emoji, curly quotes, accents…)
 */
export function keyFor(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return null;

  if (ch >= 'a' && ch <= 'z') {
    const up = ch.toUpperCase();
    return { key: ch, code: 'Key' + up, keyCode: up.charCodeAt(0), shift: false, text: ch, unmodified: ch };
  }
  if (ch >= 'A' && ch <= 'Z') {
    return { key: ch, code: 'Key' + ch, keyCode: ch.charCodeAt(0), shift: true, text: ch, unmodified: ch.toLowerCase() };
  }
  if (ch >= '0' && ch <= '9') {
    return { key: ch, code: 'Digit' + ch, keyCode: ch.charCodeAt(0), shift: false, text: ch, unmodified: ch };
  }
  if (ch in PUNCT_KEYS) {
    const [code, keyCode] = PUNCT_KEYS[ch];
    return { key: ch, code, keyCode, shift: false, text: ch, unmodified: ch };
  }
  if (ch in SHIFTED_TO_BASE) {
    const base = keyFor(SHIFTED_TO_BASE[ch]);
    return { ...base, key: ch, shift: true, text: ch, unmodified: base.text };
  }
  if (ch === '\n') {
    return { key: 'Enter', code: 'Enter', keyCode: 13, shift: false, text: '\r', unmodified: '\r' };
  }
  return null;
}

export const BACKSPACE = {
  key: 'Backspace', code: 'Backspace', keyCode: 8, shift: false, text: '', unmodified: '',
};

export const SHIFT = { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 };

// ---- Typo model: physically adjacent keys on a staggered QWERTY board ----
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function neighborOf(ch, rng = Math.random) {
  const lower = ch.toLowerCase();
  let r = -1, c = -1;
  ROWS.forEach((row, ri) => { const ci = row.indexOf(lower); if (ci >= 0) { r = ri; c = ci; } });
  if (r < 0) return null;

  const cand = [];
  const add = (rr, cc) => {
    if (rr >= 0 && rr < ROWS.length && cc >= 0 && cc < ROWS[rr].length) cand.push(ROWS[rr][cc]);
  };
  add(r, c - 1); add(r, c + 1);          // same row
  add(r - 1, c); add(r - 1, c + 1);      // row above (offset left)
  add(r + 1, c - 1); add(r + 1, c);      // row below (offset right)

  const pick = cand[Math.floor(rng() * cand.length)];
  return ch === lower ? pick : pick.toUpperCase();
}

// ---- Which hand types the key (alternating hands is faster) ----
const LEFT = new Set('`12345qwertasdfgzxcvb~!@#$%QWERTASDFGZXCVB');
const RIGHT = new Set("67890-=yuiop[]\\hjkl;'nm,./^&*()_+YUIOP{}|HJKL:\"NM<>?");

export function handOf(ch) {
  if (!ch || ch.length !== 1) return null;
  if (LEFT.has(ch)) return 'L';
  if (RIGHT.has(ch)) return 'R';
  return null;
}

// Service worker: owns the typing job.
// Attaches the Chrome DevTools Protocol to the X tab and sends real, trusted
// input through Input.dispatchMouseEvent and Input.dispatchKeyEvent, following
// the plan built by humanizer.js.

import { buildPlan, estimateMs } from './humanizer.js';
import { SHIFT } from './keyboard.js';

let job = null; // { tabId, cancelled, reason, attached }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// On macOS, editing keys need explicit editor commands to take effect through CDP.
// Playwright does the same.
const MAC_COMMANDS = { Backspace: ['deleteBackward'], Enter: ['insertNewline'] };
let isMac = false;
chrome.runtime.getPlatformInfo().then(p => { isMac = p.os === 'mac'; });

// ---------------------------------------------------------------- status
async function setStatus(status) {
  await chrome.storage.session.set({ status: { ...status, ts: Date.now() } });
  const pct = status.state === 'typing' ? Math.floor((status.progress || 0) * 100) : null;
  await chrome.action.setBadgeText({ text: pct === null ? '' : `${pct}%` });
  await chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
}

// --------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START') {
    if (job) { sendResponse({ ok: false, error: 'Already typing.' }); return false; }
    run(msg.tabId, msg.text, msg.options);
    sendResponse({ ok: true });
  } else if (msg.type === 'STOP') {
    stop('Stopped');
    sendResponse({ ok: true });
  } else if (msg.type === 'ABORT_FROM_PAGE') {
    if (job && sender.tab && sender.tab.id === job.tabId) stop(msg.reason || 'Stopped');
  }
  return false;
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (job && source.tabId === job.tabId) {
    job.attached = false;
    stop(reason === 'canceled_by_user' ? 'Stopped (debugging banner dismissed)' : `Stopped (${reason})`);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (job && job.tabId === tabId) { job.attached = false; stop('Tab closed'); }
});

function stop(reason) {
  if (!job || job.cancelled) return;
  job.cancelled = true;
  job.reason = reason;
}

// ------------------------------------------------------------- helpers
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (r && r.ok) return;
  } catch (_) { /* not injected yet (tab opened before install) */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function ask(tabId, msg) {
  const r = await chrome.tabs.sendMessage(tabId, msg);
  if (!r || !r.ok) throw new Error((r && r.error) || `Page did not answer ${msg.type}`);
  return r;
}

/** Sleep that wakes up early when the job is cancelled. */
async function wait(ms) {
  const end = performance.now() + ms;
  while (!job.cancelled) {
    const left = end - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(left, 100));
  }
}

function makeSender(tabId) {
  const target = { tabId };
  return (method, params) => chrome.debugger.sendCommand(target, method, params);
}

/** Move the mouse along an eased, slightly curved path, then click. */
async function humanClick(send, rect) {
  const tx = rect.left + rect.width * rand(0.25, 0.6);
  const ty = rect.top + Math.min(rect.height / 2, rand(12, 22));
  let x = tx + rand(-260, 260), y = ty + rand(80, 220);
  const steps = Math.round(rand(12, 22));
  const bend = rand(-40, 40);
  const sx = x, sy = y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
    x = sx + (tx - sx) * e + Math.sin(Math.PI * t) * bend;
    y = sy + (ty - sy) * e;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(rand(8, 20));
  }
  await sleep(rand(60, 160));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(rand(50, 110));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 });
}

async function pressKey(send, d, hold) {
  const modifiers = d.shift ? 8 : 0;
  if (d.shift) {
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: SHIFT.key, code: SHIFT.code,
      windowsVirtualKeyCode: SHIFT.keyCode, location: SHIFT.location, modifiers: 8,
    });
    await sleep(rand(20, 55));
  }

  const down = {
    type: d.text ? 'keyDown' : 'rawKeyDown',
    key: d.key,
    code: d.code,
    windowsVirtualKeyCode: d.keyCode,
    nativeVirtualKeyCode: d.keyCode,
    modifiers,
  };
  if (d.text) { down.text = d.text; down.unmodifiedText = d.unmodified; }
  if (isMac && MAC_COMMANDS[d.key]) down.commands = MAC_COMMANDS[d.key];
  await send('Input.dispatchKeyEvent', down);

  await sleep(hold);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: d.key, code: d.code,
    windowsVirtualKeyCode: d.keyCode, nativeVirtualKeyCode: d.keyCode, modifiers,
  });

  if (d.shift) {
    await sleep(rand(10, 40));
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: SHIFT.key, code: SHIFT.code,
      windowsVirtualKeyCode: SHIFT.keyCode, location: SHIFT.location, modifiers: 0,
    });
  }
}

const loose = s => s.replace(/\s+/g, ' ').trim();

// ----------------------------------------------------------------- job
async function run(tabId, text, options) {
  job = { tabId, cancelled: false, reason: null, attached: false };
  const send = makeSender(tabId);

  try {
    await setStatus({ state: 'preparing', progress: 0, message: 'Finding the composer…' });
    await ensureContentScript(tabId);
    await ask(tabId, { type: 'LOCATE' });

    await chrome.debugger.attach({ tabId }, '1.3');
    job.attached = true;
    // Typing continues even if Chrome treats the tab as unfocused (e.g. while the popup is open).
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await sleep(450); // the "started debugging" banner shifts the layout

    const loc = await ask(tabId, { type: 'LOCATE' });
    await sleep(rand(150, 300));
    await humanClick(send, loc.rect);
    await sleep(rand(250, 550));
    await ask(tabId, { type: 'ARM' });

    const plan = buildPlan(text, options);
    let remaining = estimateMs(plan);
    let lastDown = performance.now();
    let lastReport = 0;

    for (let i = 0; i < plan.length && !job.cancelled; i++) {
      const a = plan[i];
      await wait(a.delay - (performance.now() - lastDown));
      if (job.cancelled) break;
      lastDown = performance.now();

      if (a.type === 'key') await pressKey(send, a.key, a.hold);
      else await send('Input.insertText', { text: a.text });

      remaining -= Math.max(a.delay, a.hold || 0);
      if (performance.now() - lastReport > 250 || i === plan.length - 1) {
        lastReport = performance.now();
        await setStatus({
          state: 'typing',
          progress: (i + 1) / plan.length,
          etaMs: Math.max(0, remaining),
          message: 'Typing… (press Esc on the page to stop)',
        });
      }
    }

    if (job.cancelled) {
      await setStatus({ state: 'stopped', progress: 0, message: job.reason || 'Stopped' });
    } else {
      await sleep(300);
      const { text: finalText } = await ask(tabId, { type: 'READ_TEXT' });
      const ok = loose(finalText).endsWith(loose(text));
      await setStatus({
        state: 'done',
        progress: 1,
        message: ok
          ? 'Done. The text matches. Review it and press Post yourself.'
          : 'Done, but the composer text looks different from your input. Please review it before posting.',
        warn: !ok,
      });
    }
  } catch (e) {
    await setStatus({ state: 'error', progress: 0, message: String(e && e.message || e) });
  } finally {
    try { await chrome.tabs.sendMessage(tabId, { type: 'DISARM' }); } catch (_) {}
    if (job && job.attached) { try { await chrome.debugger.detach({ tabId }); } catch (_) {} }
    job = null;
  }
}

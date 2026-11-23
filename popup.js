import { buildPlan, estimateMs, graphemes, normalize, DEFAULTS } from './humanizer.js';

const $ = id => document.getElementById(id);
const els = {
  text: $('text'), count: $('count'), wpm: $('wpm'), wpmLabel: $('wpmLabel'),
  typos: $('typos'), pauses: $('pauses'), estimate: $('estimate'),
  start: $('start'), stop: $('stop'), statusBox: $('statusBox'),
  status: $('status'), barFill: $('barFill'),
};

const X_URL = /^https:\/\/(x|twitter)\.com\//;

const fmt = ms => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

function options() {
  return {
    wpm: Number(els.wpm.value),
    typoRate: Number(els.typos.value),
    thinkingPauses: els.pauses.checked,
  };
}

let saveTimer;
function refresh() {
  const t = normalize(els.text.value);
  els.count.textContent = `${graphemes(t).length} chars`;
  els.wpmLabel.textContent = `${els.wpm.value} WPM`;
  els.estimate.textContent = t
    ? `Estimated time: ~${fmt(estimateMs(buildPlan(t, options())))}`
    : '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ draft: els.text.value, settings: options() });
  }, 200);
}

function renderStatus(s) {
  const busy = s && (s.state === 'preparing' || s.state === 'typing');
  els.start.hidden = busy;
  els.stop.hidden = !busy;
  if (!s || s.state === 'idle') { els.statusBox.hidden = true; return; }
  els.statusBox.hidden = false;
  els.barFill.style.width = `${Math.round((s.progress || 0) * 100)}%`;
  let msg = s.message || '';
  if (s.state === 'typing' && s.etaMs != null) msg += ` · ~${fmt(s.etaMs)} left`;
  els.status.textContent = msg;
  els.status.className = s.state === 'error' || s.warn ? 'error' : '';
}

async function init() {
  const { draft = '', settings = {} } = await chrome.storage.local.get(['draft', 'settings']);
  const o = { ...DEFAULTS, ...settings };
  els.text.value = draft;
  els.wpm.value = o.wpm;
  els.typos.value = String(o.typoRate);
  if (els.typos.selectedIndex < 0) els.typos.value = String(DEFAULTS.typoRate);
  els.pauses.checked = o.thinkingPauses;
  refresh();

  const { status } = await chrome.storage.session.get('status');
  renderStatus(status);
  els.text.focus();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) renderStatus(changes.status.newValue);
});

for (const el of [els.text, els.wpm, els.typos, els.pauses]) {
  el.addEventListener('input', refresh);
  el.addEventListener('change', refresh);
}

els.start.addEventListener('click', async () => {
  const text = els.text.value;
  if (!normalize(text).trim()) {
    renderStatus({ state: 'error', message: 'Paste some text first.' });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !X_URL.test(tab.url)) {
    renderStatus({ state: 'error', message: 'Switch to an x.com tab with the composer open.' });
    return;
  }
  const r = await chrome.runtime.sendMessage({ type: 'START', tabId: tab.id, text, options: options() });
  if (!r || !r.ok) {
    renderStatus({ state: 'error', message: (r && r.error) || 'Could not start.' });
    return;
  }
  window.close(); // hand focus back to the page, as a person would
});

els.stop.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP' }));

init();

// Runs on x.com. It does NOT type. It only:
//   - finds the post composer, scrolls it into view and reports its position
//   - moves the caret to the end of the text
//   - watches for Esc or lost focus while typing and asks the background to stop
//   - reads the final text back so the result can be checked
(() => {
  if (window.__xHumanTyperLoaded) return;
  window.__xHumanTyperLoaded = true;

  const SELECTORS = [
    '[data-testid="tweetTextarea_0"]',
    'div[role="textbox"][contenteditable="true"]',
  ];

  let armed = null; // { el, onKey, onFocusOut }

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  const editableOf = el =>
    el.isContentEditable ? el : (el.querySelector('[contenteditable="true"]') || el);

  function findComposer() {
    // Prefer the modal composer (/compose/post) over the inline timeline one.
    const dialog = document.querySelector('[role="dialog"]');
    const scopes = dialog ? [dialog, document] : [document];
    for (const scope of scopes) {
      for (const sel of SELECTORS) {
        for (const el of scope.querySelectorAll(sel)) {
          if (isVisible(el)) return editableOf(el);
        }
      }
    }
    const active = document.activeElement;
    if (active && active.isContentEditable) return active;
    return null;
  }

  const textOf = el => (el.innerText || '').replace(/ /g, ' ');

  function caretToEnd(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const abort = reason => {
    disarm();
    chrome.runtime.sendMessage({ type: 'ABORT_FROM_PAGE', reason }).catch(() => {});
  };

  function arm(el) {
    disarm();
    const onKey = e => {
      if (e.key === 'Escape') {
        // Keep X from closing the composer modal on this Esc.
        e.preventDefault();
        e.stopImmediatePropagation();
        abort('Stopped (Esc pressed)');
      }
    };
    const onFocusOut = () => {
      // Window blur (e.g. opening the popup) keeps activeElement, so only a real
      // focus change inside the page stops typing.
      setTimeout(() => {
        if (!armed) return;
        const a = document.activeElement;
        if (!a || !(el === a || el.contains(a) || a.contains(el))) {
          abort('Stopped: the composer lost focus');
        }
      }, 150);
    };
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('focusout', onFocusOut);
    armed = { el, onKey, onFocusOut };
  }

  function disarm() {
    if (!armed) return;
    window.removeEventListener('keydown', armed.onKey, true);
    armed.el.removeEventListener('focusout', armed.onFocusOut);
    armed = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg.type) {
        case 'PING':
          sendResponse({ ok: true });
          break;

        case 'LOCATE': {
          const el = findComposer();
          if (!el) {
            sendResponse({ ok: false, error: 'Post composer not found. Open "Post" on x.com first.' });
            break;
          }
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          sendResponse({
            ok: true,
            rect: { left: r.left, top: r.top, width: r.width, height: r.height },
            existingText: textOf(el),
          });
          break;
        }

        case 'ARM': {
          const el = findComposer();
          if (!el) { sendResponse({ ok: false, error: 'Composer disappeared.' }); break; }
          if (!(document.activeElement === el || el.contains(document.activeElement))) el.focus();
          caretToEnd(el);
          arm(el);
          sendResponse({ ok: true });
          break;
        }

        case 'DISARM':
          disarm();
          sendResponse({ ok: true });
          break;

        case 'READ_TEXT': {
          const el = findComposer();
          sendResponse({ ok: !!el, text: el ? textOf(el) : '' });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
    return false;
  });
})();

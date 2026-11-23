# X Human Typer

A Chrome extension (Manifest V3) that types your text into the X post composer
with **real, trusted keystrokes** at a human pace, instead of pasting it.

## Install
1. Unzip, then open `chrome://extensions`.
2. Turn on **Developer mode** and click **Load unpacked**. Pick the `x-human-typer` folder.
3. Pin the extension.

## Use
1. On x.com, open the composer (click **Post**, or use the inline box on Home).
2. Open the extension, paste your text, and set the speed, typo level and pauses.
3. Click **Start typing**. The popup closes and typing begins.
   - Chrome shows a *"X Human Typer started debugging this browser"* banner. This is expected.
     Clicking **Cancel** on the banner stops typing.
   - Press **Esc** on the page, or click **Stop** in the popup, to stop typing.
4. When it finishes, the extension reads the composer back and checks the text matches. **You press Post yourself.**

## How it works

```
popup.js ──START──▶ background.js (service worker)
                      │ chrome.debugger.attach (CDP 1.3)
                      │ Input.dispatchMouseEvent  → eased mouse path + click on composer
                      │ Input.dispatchKeyEvent    → Shift down/up, keyDown(text)/keyUp per char
                      │ Input.insertText          → emoji & non-keyboard chars (like an emoji picker)
                      ▼
                    content.js (on x.com): finds the composer, moves the caret to the end,
                    watches for Esc / focus loss, reads the text back to verify
```

- **Why CDP?** Events made in page JavaScript are `isTrusted: false` and don't insert text.
  CDP input goes through Chrome's real input pipeline, so X sees `keydown → keypress →
  beforeinput → input → keyup` with `isTrusted: true`, the same as a physical keyboard.
- **macOS:** Backspace and Enter also send the `deleteBackward` / `insertNewline` editor
  commands, which Mac Chrome needs for synthesized editing keys.

### Timing model (`humanizer.js`)
| Factor | Behaviour |
|---|---|
| Base interval | `60000 / (WPM × 5)` ms per keystroke |
| Jitter | Log-normal, σ = 0.4 (human inter-key intervals are right-skewed) |
| Key hold | 45–110 ms between keydown and keyup |
| Word start | ×1.25 |
| Shift / digits / symbols | ×1.3 / ×1.15 / ×1.2 |
| Hand alternation | ×0.85 alternating hands, ×1.1 same hand |
| Punctuation | +250–800 ms after `.!?…`, +80–250 ms after `,;:` |
| Newline | +350–1000 ms |
| Thinking pause | 2.5 % chance at a word start: +0.6–2 s |
| Typos | An adjacent QWERTY key, sometimes noticed 1–2 letters late, then backspaced and retyped |

A rate of 60 WPM works out to about 54 WPM once pauses and typos are included.

## Tests
```
node test/plan.test.mjs
```
This replays thousands of generated plans (emoji, curly quotes, CRLF, tabs, high typo
rates) against a simulated buffer and checks the result equals the input exactly. It also
checks the realised WPM.

## Known limitations
- **Mentions and hashtags followed by Enter:** if X's `@`/`#` suggestion list is open
  when a newline is typed, Enter may pick a suggestion. The check at the end will flag it.
  Putting a space or punctuation before the line break avoids this.
- The composer is found with `[data-testid="tweetTextarea_0"]` and falls back to
  `div[role=textbox][contenteditable]`. If X changes its DOM, update `SELECTORS` in `content.js`.
- Keys are mapped for a US QWERTY layout. Other characters are inserted with `Input.insertText`.
- Long tabs are typed as two spaces, because Tab would move focus out of the composer.
- Use it for posting your own content by hand. Bulk or automated posting falls under X's automation rules.

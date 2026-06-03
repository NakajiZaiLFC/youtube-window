// tests/promptDismisser.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findDismissTarget, removeEnforcement } from '../extension/content/promptDismisser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const selectors = {
  stillWatchingDialog:  { css: 'yt-confirm-dialog-renderer' },
  stillWatchingConfirm: { css: 'yt-confirm-dialog-renderer #confirm-button' },
  adblockDialog:        { css: 'tp-yt-paper-dialog' },
  adblockDialogClose:   { css: 'tp-yt-paper-dialog #dismiss-button' },
};

function docFrom(html) {
  // M-2: フィクスチャは body 内側の HTML 断片として直接代入する。
  // <body>...</body> ラッパーへの依存をなくし、断片のみのフィクスチャでも動作する。
  document.body.innerHTML = html;
  return document;
}

describe('findDismissTarget', () => {
  it('returns the confirm button for a "still watching" dialog', () => {
    const target = findDismissTarget(docFrom(fixture('still-watching-dialog.html')), selectors);
    expect(target).not.toBeNull();
    expect(target.id).toBe('confirm-button');
  });
  it('returns the dismiss button for an adblock dialog', () => {
    const target = findDismissTarget(docFrom(fixture('adblock-dialog.html')), selectors);
    expect(target).not.toBeNull();
    expect(target.id).toBe('dismiss-button');
  });
  it('returns null when no dialog present', () => {
    const target = findDismissTarget(docFrom(fixture('no-dialog.html')), selectors);
    expect(target).toBeNull();
  });
});

describe('removeEnforcement', () => {
  it('removes an adblock enforcement dialog and its backdrop', () => {
    const doc = docFrom(`
      <tp-yt-iron-overlay-backdrop></tp-yt-iron-overlay-backdrop>
      <ytd-popup-container>
        <tp-yt-paper-dialog>広告ブロッカーの利用は、YouTube の利用規約で認められていません</tp-yt-paper-dialog>
      </ytd-popup-container>`);
    expect(removeEnforcement(doc)).toBe(true);
    expect(doc.querySelector('tp-yt-paper-dialog')).toBeNull();
    expect(doc.querySelector('tp-yt-iron-overlay-backdrop')).toBeNull();
  });

  it('matches the English variant too', () => {
    const doc = docFrom('<tp-yt-paper-dialog>Ad blockers are not allowed</tp-yt-paper-dialog>');
    expect(removeEnforcement(doc)).toBe(true);
    expect(doc.querySelector('tp-yt-paper-dialog')).toBeNull();
  });

  it('leaves unrelated dialogs untouched', () => {
    const doc = docFrom('<tp-yt-paper-dialog>設定メニュー</tp-yt-paper-dialog>');
    expect(removeEnforcement(doc)).toBe(false);
    expect(doc.querySelector('tp-yt-paper-dialog')).not.toBeNull();
  });
});

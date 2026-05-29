// tests/promptDismisser.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findDismissTarget } from '../extension/content/promptDismisser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const selectors = {
  stillWatchingDialog:  { css: 'yt-confirm-dialog-renderer' },
  stillWatchingConfirm: { css: 'yt-confirm-dialog-renderer #confirm-button' },
  adblockDialog:        { css: 'tp-yt-paper-dialog' },
  adblockDialogClose:   { css: 'tp-yt-paper-dialog #dismiss-button' },
};

function docFrom(html) {
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
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

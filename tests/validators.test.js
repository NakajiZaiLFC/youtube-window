// tests/validators.test.js
import { describe, it, expect } from 'vitest';
import { isValidSelectors } from '../extension/content/validators.js';

const valid = { version: 'v', selectors: { adShowing: { css: '.x' } } };

describe('isValidSelectors', () => {
  it('accepts an object with version and non-empty selectors', () => {
    expect(isValidSelectors(valid)).toBe(true);
  });
  it('rejects null / missing selectors / empty selectors', () => {
    expect(isValidSelectors(null)).toBe(false);
    expect(isValidSelectors({ version: 'v' })).toBe(false);
    expect(isValidSelectors({ version: 'v', selectors: {} })).toBe(false);
  });

  // I-1: 破損キャッシュ対策 – 各エントリの css 文字列を検証する
  it('rejects a selector entry that is missing the css key', () => {
    expect(isValidSelectors({ version: 'v', selectors: { adShowing: {} } })).toBe(false);
  });
  it('rejects a selector entry whose css is an empty string', () => {
    expect(isValidSelectors({ version: 'v', selectors: { adShowing: { css: '' } } })).toBe(false);
  });
  it('rejects a selector entry whose css is not a string', () => {
    expect(isValidSelectors({
      version: 'v',
      selectors: { adShowing: { css: '.x' }, bad: { css: 123 } },
    })).toBe(false);
  });
  it('accepts multiple valid selectors (multi-key valid object)', () => {
    expect(isValidSelectors({
      version: 'v',
      selectors: { adShowing: { css: '.ad' }, skipButton: { css: '.skip' } },
    })).toBe(true);
  });
});

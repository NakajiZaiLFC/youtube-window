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
});

// tests/selectorLoader.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickSelectors, getSelectors } from '../extension/content/selectorLoader.js';

const valid = { version: 'v', selectors: { adShowing: { css: '.x' } } };

describe('pickSelectors (3段フォールバック)', () => {
  const bundled = { version: 'bundled', selectors: { adShowing: { css: '.b' } } };
  it('prefers a valid remote', () => {
    const r = pickSelectors({ remote: valid, cached: null, bundled });
    expect(r.source).toBe('remote');
    expect(r.data).toBe(valid);
  });
  it('falls back to cached when remote invalid', () => {
    const cached = { version: 'cached', selectors: { adShowing: { css: '.c' } } };
    const r = pickSelectors({ remote: null, cached, bundled });
    expect(r.source).toBe('cached');
    expect(r.data).toBe(cached);
  });
  it('falls back to bundled when remote and cached invalid', () => {
    const r = pickSelectors({ remote: null, cached: undefined, bundled });
    expect(r.source).toBe('bundled');
    expect(r.data).toBe(bundled);
  });
});

// JSON import 経路（同梱デフォルト）を実際に評価する唯一のテスト
describe('getSelectors (JSON import 経路)', () => {
  beforeEach(() => {
    let store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn((k) => Promise.resolve({ [k]: store[k] })),
      set: vi.fn((o) => { store = { ...store, ...o }; return Promise.resolve(); }),
    } } };
  });
  it('returns bundled selectors when storage cache is empty', async () => {
    const sels = await getSelectors();
    // 同梱 selectors.json の adShowing が読めること（import が壊れていれば throw / undefined）
    expect(sels.adShowing).toBeTruthy();
    expect(typeof sels.adShowing.css).toBe('string');
  });
  it('returns cached selectors when present and valid', async () => {
    globalThis.chrome.storage.local.set({ selectorsCache: valid });
    const sels = await getSelectors();
    expect(sels.adShowing.css).toBe('.x');
  });
});

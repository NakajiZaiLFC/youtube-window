// tests/adSnapshotLogger.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimSnapshots, captureAdDom, exportSnapshots, MAX_COUNT, MAX_CHARS_EACH }
  from '../extension/content/adSnapshotLogger.js';

const mk = (html) => ({ capturedAt: 't', url: 'u', region: 'player', html });

describe('trimSnapshots (純粋)', () => {
  it('keeps only the most recent MAX_COUNT entries', () => {
    const list = Array.from({ length: MAX_COUNT + 3 }, (_, i) => mk('x' + i));
    const out = trimSnapshots(list);
    expect(out).toHaveLength(MAX_COUNT);
    expect(out[out.length - 1].html).toBe('x' + (MAX_COUNT + 2)); // newest kept
  });
  it('truncates oversized html to MAX_CHARS_EACH (文字数上限)', () => {
    const big = mk('a'.repeat(MAX_CHARS_EACH + 100));
    const out = trimSnapshots([big]);
    expect(out[0].html.length).toBeLessThanOrEqual(MAX_CHARS_EACH);
  });
  it('truncates multibyte html by char count (バイト数ではない点を明示)', () => {
    const out = trimSnapshots([mk('あ'.repeat(MAX_CHARS_EACH + 50))]);
    expect(out[0].html.length).toBe(MAX_CHARS_EACH); // .length は code unit 数
  });
});

describe('captureAdDom + exportSnapshots (storage 経路・設計書 §4.5 の核)', () => {
  beforeEach(() => {
    let store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn((k) => Promise.resolve({ [k]: store[k] })),
      set: vi.fn((o) => { store = { ...store, ...o }; return Promise.resolve(); }),
    } } };
  });
  it('appends a snapshot and keeps at most MAX_COUNT (oldest dropped)', async () => {
    const node = { outerHTML: '<div>ad</div>' };
    for (let i = 0; i < MAX_COUNT + 2; i++) {
      await captureAdDom(node, { url: 'u' + i });
    }
    const out = await exportSnapshots();
    expect(out).toHaveLength(MAX_COUNT);
    expect(out[out.length - 1].url).toBe('u' + (MAX_COUNT + 1)); // newest kept
    expect(out[0].url).toBe('u2'); // oldest two dropped
  });
});

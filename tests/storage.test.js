// tests/storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../extension/content/storage.js';

function fakeChromeStorage(initial = {}) {
  let store = { ...initial };
  return {
    storage: {
      local: {
        get: vi.fn((keys) => Promise.resolve(
          typeof keys === 'string' ? { [keys]: store[keys] } : { ...store }
        )),
        set: vi.fn((obj) => { store = { ...store, ...obj }; return Promise.resolve(); }),
      },
    },
  };
}

beforeEach(() => { globalThis.chrome = fakeChromeStorage(); });

describe('storage', () => {
  it('returns DEFAULT_SETTINGS merged when nothing stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides defaults with stored values', async () => {
    globalThis.chrome = fakeChromeStorage({ settings: { loop: false } });
    const s = await getSettings();
    expect(s.loop).toBe(false);
    expect(s.autoSkip).toBe(DEFAULT_SETTINGS.autoSkip);
  });

  it('setSetting persists a single key', async () => {
    await setSetting('playlistUrl', 'https://x');
    const s = await getSettings();
    expect(s.playlistUrl).toBe('https://x');
  });
});

// tests/playlistController.test.js
import { describe, it, expect } from 'vitest';
import { decideEndAction, restartPlaylist } from '../extension/content/playlistController.js';

describe('decideEndAction', () => {
  it('restarts when at playlist end and loop enabled', () => {
    expect(decideEndAction({ atPlaylistEnd: true, loopEnabled: true })).toBe('restart-playlist');
  });
  it('does nothing at end when loop disabled', () => {
    expect(decideEndAction({ atPlaylistEnd: true, loopEnabled: false })).toBe('none');
  });
  it('does nothing when not at end (YouTube auto-advances)', () => {
    expect(decideEndAction({ atPlaylistEnd: false, loopEnabled: true })).toBe('none');
  });
});

// I-2: restartPlaylist の適用関数テスト
describe('restartPlaylist', () => {
  it('sets index=1 in the URL', () => {
    const loc = { href: 'https://www.youtube.com/watch?v=abc&list=PLxyz&index=5' };
    restartPlaylist(loc);
    expect(new URL(loc.href).searchParams.get('index')).toBe('1');
  });

  it('preserves other query params when resetting index', () => {
    const loc = { href: 'https://www.youtube.com/watch?v=abc&list=PLxyz&index=3' };
    restartPlaylist(loc);
    const url = new URL(loc.href);
    expect(url.searchParams.get('v')).toBe('abc');
    expect(url.searchParams.get('list')).toBe('PLxyz');
    expect(url.searchParams.get('index')).toBe('1');
  });
});

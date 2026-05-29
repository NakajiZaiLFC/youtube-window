// tests/playlistController.test.js
import { describe, it, expect } from 'vitest';
import { decideEndAction } from '../extension/content/playlistController.js';

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

// tests/adSkipper.test.js
import { describe, it, expect } from 'vitest';
import { decideAdAction, applyAdAction, unmuteIfNeeded } from '../extension/content/adSkipper.js';

describe('decideAdAction', () => {
  it('returns none when no ad is showing', () => {
    expect(decideAdAction({ adShowing: false })).toBe('none');
  });
  it('clicks skip when skip button is present and enabled', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: true }))
      .toBe('click-skip');
  });
  it('mutes and waits when skip button present but still counting down', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: false }))
      .toBe('mute-and-wait');
  });
  it('mutes and waits for unskippable ad (no skip button)', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: false }))
      .toBe('mute-and-wait');
  });
});

// I-2: applyAdAction と unmuteIfNeeded の適用関数テスト
describe('applyAdAction – mute-and-wait', () => {
  it('mutes video on mute-and-wait action', () => {
    const video = { muted: false, duration: NaN, currentTime: 0 };
    applyAdAction('mute-and-wait', { video });
    expect(video.muted).toBe(true);
  });

  it('attempts to set currentTime=duration for a finite-duration video (best-effort)', () => {
    const video = { muted: false, duration: 30, currentTime: 0 };
    applyAdAction('mute-and-wait', { video });
    expect(video.currentTime).toBe(30);
  });

  it('does not throw even when setting currentTime throws (best-effort)', () => {
    const video = {
      muted: false,
      duration: 30,
      get currentTime() { return 0; },
      set currentTime(_v) { throw new Error('seek blocked'); },
    };
    expect(() => applyAdAction('mute-and-wait', { video })).not.toThrow();
    expect(video.muted).toBe(true);
  });
});

describe('unmuteIfNeeded', () => {
  it('unmutes video when weMuted is true and video is muted', () => {
    const video = { muted: true };
    unmuteIfNeeded(video, true);
    expect(video.muted).toBe(false);
  });

  it('does not change muted when weMuted is false', () => {
    const video = { muted: true };
    unmuteIfNeeded(video, false);
    expect(video.muted).toBe(true);
  });
});

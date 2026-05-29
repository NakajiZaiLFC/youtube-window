// tests/adSkipper.test.js
import { describe, it, expect } from 'vitest';
import { decideAdAction, applyAdAction, unmuteIfNeeded } from '../extension/content/adSkipper.js';

describe('decideAdAction', () => {
  it('returns none when no ad is showing', () => {
    expect(decideAdAction({ adShowing: false })).toBe('none');
  });
  it('returns skip whenever an ad is showing (skippable or not)', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: true })).toBe('skip');
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: false })).toBe('skip');
    expect(decideAdAction({ adShowing: true, skipButtonPresent: false })).toBe('skip');
  });
});

// applyAdAction('skip'): ミュート＋末尾へ早送り＋スキップボタンclick
describe('applyAdAction – skip', () => {
  const noSel = { doc: null, selectors: null };

  it('mutes the ad video', () => {
    const video = { muted: false, duration: NaN, currentTime: 0 };
    applyAdAction('skip', { video, ...noSel });
    expect(video.muted).toBe(true);
  });

  it('fast-forwards a finite-duration ad to its end', () => {
    const video = { muted: false, duration: 30, currentTime: 0 };
    applyAdAction('skip', { video, ...noSel });
    expect(video.currentTime).toBe(30);
  });

  it('does not seek when duration is not finite', () => {
    const video = { muted: false, duration: Infinity, currentTime: 5 };
    applyAdAction('skip', { video, ...noSel });
    expect(video.currentTime).toBe(5);
  });

  it('does not throw when seeking throws (best-effort)', () => {
    const video = {
      muted: false, duration: 30,
      get currentTime() { return 0; },
      set currentTime(_v) { throw new Error('seek blocked'); },
    };
    expect(() => applyAdAction('skip', { video, ...noSel })).not.toThrow();
    expect(video.muted).toBe(true);
  });

  it('clicks the skip button when present', () => {
    let clicked = 0;
    const btn = { click() { clicked++; }, dispatchEvent() {} };
    const doc = { querySelector: () => btn, defaultView: undefined };
    const video = { muted: true, duration: 10, currentTime: 0 };
    applyAdAction('skip', { doc, video, selectors: { skipButton: { css: '.x' } } });
    expect(clicked).toBeGreaterThan(0);
  });

  it('does nothing for non-skip actions', () => {
    const video = { muted: false, duration: 30, currentTime: 0 };
    applyAdAction('none', { video, ...noSel });
    expect(video.muted).toBe(false);
    expect(video.currentTime).toBe(0);
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

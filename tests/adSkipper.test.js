// tests/adSkipper.test.js
import { describe, it, expect } from 'vitest';
import { decideAdAction } from '../extension/content/adSkipper.js';

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

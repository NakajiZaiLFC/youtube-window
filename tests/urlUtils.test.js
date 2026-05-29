// tests/urlUtils.test.js
import { describe, it, expect } from 'vitest';
import { extractListId, toWatchUrl, buildWatchUrl } from '../extension/content/urlUtils.js';

describe('extractListId', () => {
  it('extracts list from a playlist URL with tracking param', () => {
    expect(extractListId('https://youtube.com/playlist?list=PLabc123&si=xyz')).toBe('PLabc123');
  });
  it('extracts list from a watch URL', () => {
    expect(extractListId('https://www.youtube.com/watch?v=AAA&list=PLabc123')).toBe('PLabc123');
  });
  it('returns null for a URL without list', () => {
    expect(extractListId('https://www.youtube.com/watch?v=AAA')).toBeNull();
  });
  it('returns null for an invalid URL', () => {
    expect(extractListId('not a url')).toBeNull();
  });
});

describe('toWatchUrl', () => {
  it('converts a playlist URL (with &si) to a watch?list URL', () => {
    expect(toWatchUrl('https://youtube.com/playlist?list=PLo5&si=XJ'))
      .toBe('https://www.youtube.com/watch?list=PLo5');
  });
  it('normalizes a watch URL that has v= to start from the playlist top', () => {
    expect(toWatchUrl('https://www.youtube.com/watch?v=AAA&list=PLo5'))
      .toBe('https://www.youtube.com/watch?list=PLo5');
  });
  it('returns the original URL when no list is present', () => {
    expect(toWatchUrl('https://www.youtube.com/watch?v=AAA'))
      .toBe('https://www.youtube.com/watch?v=AAA');
  });
});

describe('buildWatchUrl', () => {
  it('builds watch?v=&list= with a known first video', () => {
    expect(buildWatchUrl('PLo5', 'abc12345678'))
      .toBe('https://www.youtube.com/watch?v=abc12345678&list=PLo5');
  });
  it('falls back to watch?list= when videoId is missing', () => {
    expect(buildWatchUrl('PLo5', null)).toBe('https://www.youtube.com/watch?list=PLo5');
  });
  it('returns null when listId is missing', () => {
    expect(buildWatchUrl(null, 'abc')).toBeNull();
  });
});

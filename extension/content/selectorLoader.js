// extension/content/selectorLoader.js
import bundled from '../selectors.json';
import { isValidSelectors } from './validators.js';

// remote → cached → bundled の順で最初に妥当なものを採用
export function pickSelectors({ remote, cached, bundled: b }) {
  if (isValidSelectors(remote)) return { source: 'remote', data: remote };
  if (isValidSelectors(cached)) return { source: 'cached', data: cached };
  return { source: 'bundled', data: b };
}

const CACHE_KEY = 'selectorsCache';

// content 側: storage のキャッシュ → 無ければ同梱デフォルト
export async function getSelectors() {
  const got = await chrome.storage.local.get(CACHE_KEY);
  const { data } = pickSelectors({ remote: null, cached: got[CACHE_KEY], bundled });
  return data.selectors;
}

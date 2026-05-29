// extension/background.js
import { isValidSelectors } from './content/validators.js'; // JSON import を持たない SW-safe モジュール

const ALARM = 'daily-selector-refresh';
// TODO(Phase 2 で確定): リモート selectors.json の raw URL。Phase 1 では空＝no-op が正常。
const REMOTE_URL = '';

async function refreshSelectors() {
  if (!REMOTE_URL) return; // Phase 1 は no-op
  try {
    const res = await fetch(REMOTE_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (isValidSelectors(json)) {
      await chrome.storage.local.set({ selectorsCache: json });
    }
  } catch (e) {
    console.debug('[yt-ext] selector refresh failed', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 * 24 });
  refreshSelectors();
});
chrome.runtime.onStartup.addListener(refreshSelectors);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refreshSelectors(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openPlaylist') {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
    return true; // この分岐のみ async channel を開く
  }
  return false; // 未処理メッセージは channel を開いたままにしない
});

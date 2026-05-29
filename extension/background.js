// extension/background.js
import { isValidSelectors } from './content/validators.js'; // JSON import を持たない SW-safe モジュール
import { toWatchUrl } from './content/urlUtils.js';          // 純粋関数（JSON import なし）

const ALARM = 'daily-selector-refresh';
// TODO(Phase 2 で確定): リモート selectors.json の raw URL。Phase 1 では空＝no-op が正常。
const REMOTE_URL = '';

// 再生用「裏の小窓」のタブ ID。SW は再起動で揮発するため storage にも保存して復元する。
let playerTabId = null;

async function loadPlayerTabId() {
  const got = await chrome.storage.local.get('playerTabId');
  playerTabId = got.playerTabId ?? null;
}
async function setPlayerTabId(id) {
  playerTabId = id;
  await chrome.storage.local.set({ playerTabId: id });
}

// プレイリストを「再生が始まる watch URL」にして、小さなバックグラウンド窓で開く（既存なら再利用）。
async function openPlayer(url) {
  const watch = toWatchUrl(url);
  await loadPlayerTabId();
  if (playerTabId != null) {
    try {
      const tab = await chrome.tabs.get(playerTabId);
      await chrome.tabs.update(playerTabId, { url: watch });
      await chrome.windows.update(tab.windowId, { focused: false });
      return { ok: true, reused: true };
    } catch {
      await setPlayerTabId(null); // 窓が閉じられていた
    }
  }
  const win = await chrome.windows.create({
    url: watch, type: 'popup', width: 480, height: 300, focused: false,
  });
  let id = win.tabs?.[0]?.id ?? null;
  if (id == null) { // 一部環境で win.tabs が空のことがある
    const ts = await chrome.tabs.query({ windowId: win.id });
    id = ts[0]?.id ?? null;
  }
  await setPlayerTabId(id);
  return { ok: true, reused: false };
}

// popup からの制御メッセージを再生タブへ転送する。
// 「窓が閉じた(closed)」と「読み込み中で未準備(loading)」を区別する。
async function forwardToPlayer(msg) {
  await loadPlayerTabId();
  if (playerTabId == null) return { ok: false, error: 'not-open' };
  // タブ自体が存在するか確認（無ければ本当に閉じた → 追跡解除）
  try {
    await chrome.tabs.get(playerTabId);
  } catch {
    await setPlayerTabId(null);
    return { ok: false, error: 'not-open' };
  }
  // タブは在る。content script 未注入/読み込み中なら sendMessage が失敗するが、
  // それは一時的なので tabId は保持して 'loading' を返す。
  try {
    return await chrome.tabs.sendMessage(playerTabId, msg);
  } catch (e) {
    return { ok: false, error: 'loading' };
  }
}

const FORWARD_TYPES = ['play', 'pause', 'next', 'prev', 'setLoop', 'setAutoSkip', 'getStatus'];

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

// 再生窓が閉じられたら追跡を解除
chrome.tabs.onRemoved.addListener(async (id) => {
  await loadPlayerTabId();
  if (id === playerTabId) await setPlayerTabId(null);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'openPlaylist') {
      sendResponse(await openPlayer(msg.url));
      return;
    }
    if (msg.type === 'isOpen') {
      await loadPlayerTabId();
      sendResponse({ ok: true, open: playerTabId != null });
      return;
    }
    if (FORWARD_TYPES.includes(msg.type)) {
      sendResponse(await forwardToPlayer(msg));
      return;
    }
    sendResponse({ ok: false, error: 'unknown' });
  })();
  return true; // 全分岐で async 応答
});

// extension/background.js
import { isValidSelectors } from './content/validators.js'; // JSON import を持たない SW-safe モジュール
import { toWatchUrl, extractListId, buildWatchUrl } from './content/urlUtils.js'; // 純粋関数（JSON import なし）

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

// プレイリストを「再生が始まる watch URL」にして開く。
// ★ 重要: 裏(active:false)で読み込むと YouTube が不正な配信ノードを返し再生失敗
//   (ERR_NAME_NOT_RESOLVED / "not available on this device")。手動クリック=前面なら再生OK。
//   そこで「前面で開いて再生を確実に開始 → playerStarted を受けたら元のタブへ戻して裏へ回す」。
// プレイリストの先頭動画IDを取得（watch?v=&list= の空v問題を避けるため）。
// 拡張は youtube.com の host_permissions を持つので SW から CORS なしで取得できる。
async function firstVideoId(listId) {
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${listId}`, { credentials: 'include' });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function openPlayer(url) {
  // 先頭動画ID付きの URL を組み立てる（空 v だと再生が不安定なため）。失敗時は従来の watch?list=。
  const listId = extractListId(url);
  let watch = toWatchUrl(url);
  if (listId) {
    const vid = await firstVideoId(listId);
    if (vid) watch = buildWatchUrl(listId, vid);
  }
  await loadPlayerTabId();
  // 再生開始後に戻る先（今アクティブなタブ）を覚えておく
  try {
    const [prev] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (prev?.id != null) await chrome.storage.local.set({ prevActiveTabId: prev.id });
  } catch {}

  if (playerTabId != null) {
    try {
      await chrome.tabs.get(playerTabId);
      await chrome.tabs.update(playerTabId, { url: watch, active: true }); // 前面化して再生
      return { ok: true, reused: true };
    } catch {
      await setPlayerTabId(null); // タブが閉じられていた
    }
  }
  const tab = await chrome.tabs.create({ url: watch, active: true }); // ★前面で開く
  await setPlayerTabId(tab.id ?? null);
  return { ok: true, reused: false };
}

// content から「再生が始まった」通知が来たら、元のタブへフォーカスを戻して再生タブを裏へ。
async function onPlayerStarted() {
  const got = await chrome.storage.local.get('prevActiveTabId');
  const prev = got.prevActiveTabId;
  if (prev == null) return;
  try { await chrome.tabs.update(prev, { active: true }); } catch {}
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

const FORWARD_TYPES = ['play', 'pause', 'seek', 'next', 'prev', 'setLoop', 'getStatus'];

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
    if (msg.type === 'playerStarted') { // content から（再生開始通知）
      await onPlayerStarted();
      sendResponse({ ok: true });
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

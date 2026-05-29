// extension/content/adSnapshotLogger.js
export const MAX_COUNT = 5;
export const MAX_CHARS_EACH = 50_000; // 文字数上限（バイトではない）
const KEY = 'adSnapshots';

// 純粋: 直近 MAX_COUNT 件に絞り、各 html を MAX_CHARS_EACH 文字に切り詰める
export function trimSnapshots(list) {
  return list
    .slice(-MAX_COUNT)
    .map((s) => ({ ...s, html: s.html.slice(0, MAX_CHARS_EACH) }));
}

// 適用: 広告 DOM を storage.local に追記（push してから trim）
export async function captureAdDom(node, { url }) {
  const got = await chrome.storage.local.get(KEY);
  const list = got[KEY] || [];
  list.push({ capturedAt: new Date().toISOString(), url, region: 'player', html: node.outerHTML });
  await chrome.storage.local.set({ [KEY]: trimSnapshots(list) });
}

// エクスポート用に現在の蓄積を返す（popup から chrome.downloads で書き出す）
export async function exportSnapshots() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || [];
}

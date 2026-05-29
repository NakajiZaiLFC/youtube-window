// extension/content/urlUtils.js
// プレイリスト系 URL から list ID を取り出し、実際に再生が始まる watch URL に変換する。

export function extractListId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('list');
  } catch {
    return null;
  }
}

// playlist?list=ID / watch?v=..&list=ID / 余計な &si= 付き → https://www.youtube.com/watch?list=ID
// list が無ければ元の URL をそのまま返す（best-effort）。
export function toWatchUrl(url) {
  const list = extractListId(url);
  if (list) return `https://www.youtube.com/watch?list=${list}`;
  return url;
}

// 先頭動画ID付きの watch URL を組み立てる。空 v だと再生開始が不安定なため、
// videoId が分かる場合は watch?v=<id>&list=<list> を使う（手動クリック相当）。
export function buildWatchUrl(listId, videoId) {
  if (videoId && listId) return `https://www.youtube.com/watch?v=${videoId}&list=${listId}`;
  if (listId) return `https://www.youtube.com/watch?list=${listId}`;
  return null;
}

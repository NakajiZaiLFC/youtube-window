// extension/content/playlistController.js

// 純粋: プレイリスト終端での挙動を決める。途中は YouTube が自動で次へ進むので none。
export function decideEndAction(state) {
  if (state.atPlaylistEnd && state.loopEnabled) return 'restart-playlist';
  return 'none';
}

// 薄い適用関数群
export function clickNext(doc, selectors) {
  const btn = doc.querySelector(selectors.nextButton.css);
  if (btn) btn.click();
  return !!btn;
}
export function clickPrev(doc, selectors) {
  const btn = doc.querySelector(selectors.prevButton.css);
  if (btn) btn.click();
  return !!btn;
}
// 先頭復帰の具体手段は設計書 §9 の未決事項。暫定: index=1 へ再遷移。
export function restartPlaylist(loc) {
  const url = new URL(loc.href);
  url.searchParams.set('index', '1');
  loc.href = url.toString();
}

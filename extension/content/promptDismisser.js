// extension/content/promptDismisser.js

// 純粋: 閉じるべきダイアログがあればクリック対象要素を返す。無ければ null。
export function findDismissTarget(root, selectors) {
  if (root.querySelector(selectors.stillWatchingDialog.css)) {
    const btn = root.querySelector(selectors.stillWatchingConfirm.css);
    if (btn) return btn;
  }
  if (root.querySelector(selectors.adblockDialog.css)) {
    const btn = root.querySelector(selectors.adblockDialogClose.css);
    if (btn) return btn;
  }
  return null;
}

// 「広告ブロッカーは利用規約で認められていません」系の強制ダイアログ判定用。
// 閉じるボタンが無い/効かないことが多いため、テキストで特定して DOM ごと除去する。
const ENFORCE_RE = /広告ブロッカー|アドブロック|ad ?block|許可リスト|アローリスト|allow ?list/i;

// 強制ダイアログ要素を列挙（テキスト一致のみ。通常のダイアログは巻き込まない）。
export function findEnforcementDialogs(root) {
  const candidates = root.querySelectorAll('tp-yt-paper-dialog, ytd-enforcement-message-view-model');
  const hits = [];
  for (const el of candidates) {
    if (ENFORCE_RE.test(el.textContent || '')) hits.push(el);
  }
  return hits;
}

// 強制ダイアログ + 暗幕を DOM から除去し、スクロールロックを解除する。
// 返り値: 1つ以上除去したら true。
export function removeEnforcement(root) {
  const hits = findEnforcementDialogs(root);
  if (hits.length === 0) return false;
  for (const el of hits) {
    (el.closest('tp-yt-paper-dialog') || el).remove();
  }
  root.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
  try { if (root.documentElement) root.documentElement.style.overflow = ''; } catch {}
  try { if (root.body) root.body.style.overflow = ''; } catch {}
  return true;
}

// 薄い適用関数。閉じられるものはクリック、強制ダイアログは DOM 除去。
// 返り値: 何か処理したら true（呼び出し側で再生を再開させる用）。
export function dismissIfPresent(root, selectors) {
  let acted = false;
  const target = findDismissTarget(root, selectors);
  if (target) { target.click(); acted = true; }
  if (removeEnforcement(root)) acted = true;
  return acted;
}

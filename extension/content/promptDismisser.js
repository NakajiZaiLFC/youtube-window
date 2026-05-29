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

// 薄い適用関数
export function dismissIfPresent(root, selectors) {
  const target = findDismissTarget(root, selectors);
  if (target) target.click();
  return !!target;
}

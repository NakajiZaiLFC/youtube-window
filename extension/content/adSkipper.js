// extension/content/adSkipper.js

// 純粋: プレイヤー状態から取るべき広告対応を決める
export function decideAdAction(state) {
  if (!state.adShowing) return 'none';
  if (state.skipButtonPresent && state.skipButtonEnabled) return 'click-skip';
  return 'mute-and-wait';
}

// 薄い適用関数（手動確認）。video/document と現行 selectors を受けて副作用を起こす。
// fast-forward は best-effort（設計書 §4.2: 広告中シーク禁止の可能性あり、PoC は Task 13）。
export function applyAdAction(action, { doc, video, selectors }) {
  switch (action) {
    case 'click-skip': {
      const btn = doc.querySelector(selectors.skipButton.css);
      if (btn) {
        btn.click();
        // YouTube が合成 click を無視する場合に備え、実ポインタ操作も発火
        try {
          const view = doc.defaultView || (typeof window !== 'undefined' ? window : undefined);
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
            btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view }));
          });
        } catch {}
      }
      break;
    }
    case 'mute-and-wait': {
      if (video && !video.muted) video.muted = true;
      // best-effort 早送り（効かない環境では無視される）
      try { if (video && isFinite(video.duration)) video.currentTime = video.duration; } catch {}
      break;
    }
    default:
      break;
  }
}

// 広告終了時に拡張がミュートした分だけ解除する用（weMuted フラグは呼び出し側が管理）
export function unmuteIfNeeded(video, weMuted) {
  if (video && weMuted && video.muted) video.muted = false;
}

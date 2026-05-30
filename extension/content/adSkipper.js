// extension/content/adSkipper.js

// 純粋: 広告中なら 'skip'、それ以外は 'none'。
// （合成クリックは YouTube に無視されるため、スキップ可否で分岐せず常に skip 処理を行う）
export function decideAdAction(state) {
  return state.adShowing ? 'skip' : 'none';
}

// 広告スキップの本体。最も確実なのは「広告動画を末尾へ早送りして即終了させる」こと。
// 併せてミュート＆スキップボタンのクリック（効く場合の保険）も行う。
export function applyAdAction(action, { doc, video, selectors }) {
  if (action !== 'skip') return;

  // 1) ミュート（早送りが効かない一瞬の保険）
  if (video && !video.muted) video.muted = true;

  // 2) 広告動画を末尾へ早送り（= 実質スキップ）。効く環境が大半。
  try {
    if (video && isFinite(video.duration) && video.duration > 0) {
      video.currentTime = video.duration;
    }
  } catch {}

  // 2.5) 早送りがクランプされる広告向けの保険: 再生速度を最大化して一瞬で消化する
  try {
    if (video && video.playbackRate !== 16) video.playbackRate = 16;
  } catch {}

  // 3) スキップボタンがあればクリックも試す（click + 実ポインタ操作）
  const btn = doc && selectors ? doc.querySelector(selectors.skipButton.css) : null;
  if (btn) {
    try {
      btn.click();
      const view = doc.defaultView || (typeof window !== 'undefined' ? window : undefined);
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view }));
      });
    } catch {}
  }
}

// 広告終了時に拡張がミュートした分だけ解除する用（weMuted フラグは呼び出し側が管理）
export function unmuteIfNeeded(video, weMuted) {
  if (video && weMuted && video.muted) video.muted = false;
}

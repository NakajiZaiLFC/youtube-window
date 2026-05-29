// extension/content/content.js
import { getSelectors } from './selectorLoader.js';
import { getSettings } from './storage.js';
import { decideAdAction, applyAdAction, unmuteIfNeeded } from './adSkipper.js';
import { dismissIfPresent } from './promptDismisser.js';
import { decideEndAction, clickNext, clickPrev, restartPlaylist } from './playlistController.js';
import { captureAdDom } from './adSnapshotLogger.js';

let selectors = null;
let settings = null;
let weMuted = false;
let lastAdShowing = false;
let pollTimer = null;
let observer = null;
let rafQueued = false;
let restarting = false;

function getVideo() { return document.querySelector('video'); }

function readAdState() {
  const adShowing = !!document.querySelector(selectors.adShowing.css);
  const skipBtn = document.querySelector(selectors.skipButton.css);
  return {
    adShowing,
    skipButtonPresent: !!skipBtn,
    skipButtonEnabled: !!skipBtn && !skipBtn.disabled,
  };
}

function tick() {
  try {
    if (!selectors || !settings || restarting) return;
    // 1) ダイアログ回避
    dismissIfPresent(document, selectors);
    // 2) 広告処理
    if (settings.autoSkip) {
      const adState = readAdState();
      const action = decideAdAction(adState);
      const video = getVideo();
      const wasMutedBefore = !!(video && video.muted);
      applyAdAction(action, { doc: document, video, selectors });
      // 自分がミュートしたフレームだけ weMuted を立てる
      if (video && video.muted && !wasMutedBefore) weMuted = true;
      // 広告開始エッジで実広告 DOM を記録
      if (adState.adShowing && !lastAdShowing) {
        console.info('[yt-ext] 広告検出', { skipButtonPresent: adState.skipButtonPresent, action });
        const player = document.querySelector(selectors.adShowing.css);
        if (player) captureAdDom(player, { url: location.href });
      }
      // 広告終了エッジで自分のミュートだけ解除
      if (!adState.adShowing && lastAdShowing) {
        unmuteIfNeeded(video, weMuted);
        weMuted = false;
      }
      lastAdShowing = adState.adShowing;
    }
    // 3) 終端ループ
    const video = getVideo();
    if (video && video.ended) {
      // 終端検出: 実DOMでの挙動はTask 12/13で要確認
      const nextBtn = document.querySelector(selectors.nextButton.css);
      const atEnd = !nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true';
      if (decideEndAction({ atPlaylistEnd: atEnd, loopEnabled: settings.loop }) === 'restart-playlist') {
        restarting = true;
        if (pollTimer) clearInterval(pollTimer); // 多重 restart 防止
        if (observer) observer.disconnect();
        restartPlaylist(location);
      }
    }
  } catch (e) {
    console.debug('[yt-ext] tick error', e);
  }
}

function scheduleTick() {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => { rafQueued = false; tick(); });
}

async function init() {
  const sel = await getSelectors();
  const set = await getSettings();
  // ここから同期セクション（await を挟まない）
  selectors = sel;
  settings = set;
  restarting = false;
  lastAdShowing = false; // 曲遷移で広告状態をリセット
  weMuted = false;
  if (pollTimer) clearInterval(pollTimer);
  if (observer) observer.disconnect();        // 前回 observer を破棄（リーク防止）
  pollTimer = setInterval(tick, 500);
  observer = new MutationObserver(scheduleTick); // 変異は rAF に集約
  observer.observe(document.documentElement, { childList: true, subtree: true });
  console.info('[yt-ext] 起動', { autoSkip: settings.autoSkip, loop: settings.loop, selectorsVersion: selectors && '(loaded)' });
}

// YouTube は SPA。曲遷移ごとに再初期化
document.addEventListener('yt-navigate-finish', () => { init(); });

// 現在の再生状態を popup に返す（selectors 未初期化でも最低限は答える）
function currentStatus() {
  const v = getVideo();
  let adShowing = false;
  try { adShowing = !!(selectors && document.querySelector(selectors.adShowing.css)); } catch {}
  return {
    title: document.title.replace(/\s*-\s*YouTube\s*$/, '').trim(),
    playing: !!(v && !v.paused && !v.ended && v.currentTime > 0),
    hasVideo: !!v,
    adShowing,
    loop: settings ? settings.loop : null,
    autoSkip: settings ? settings.autoSkip : null,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'getStatus') { sendResponse({ ok: true, status: currentStatus() }); return; }
      if (!selectors || !settings) { sendResponse({ ok: false, error: 'not-ready' }); return; }
      const v = getVideo();
      switch (msg.type) {
        case 'play': if (v) await v.play().catch(() => {}); break;
        case 'pause': if (v) v.pause(); break;
        case 'next': clickNext(document, selectors); break;
        case 'prev': clickPrev(document, selectors); break;
        case 'setLoop': settings.loop = msg.value; break;
        case 'setAutoSkip':
          settings.autoSkip = msg.value;
          if (!msg.value) { // OFF にしたら自分のミュートを解除し状態リセット
            unmuteIfNeeded(getVideo(), weMuted);
            weMuted = false;
            lastAdShowing = false;
          }
          break;
      }
      sendResponse({ ok: true, status: currentStatus() });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true; // async response
});

init();

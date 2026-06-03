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
let startedNotified = false; // 再生開始を background に1回だけ通知したか
let lastAdAction = null;     // 広告中のアクション変化をログするため

// 本体プレイヤーの video（広告中も同じ要素に広告が乗る）。無ければ最初の video。
function getVideo() { return document.querySelector('.html5-main-video') || document.querySelector('video'); }

function readAdState() {
  const adShowing = !!document.querySelector(selectors.adShowing.css);
  const skipBtn = document.querySelector(selectors.skipButton.css);
  return {
    adShowing,
    skipButtonPresent: !!skipBtn,
    skipButtonEnabled: !!skipBtn && !skipBtn.disabled,
  };
}

// スキップボタンの中心座標を background に渡し、CDP で本物のクリックを送らせる。
// （合成クリックは YouTube に無視されるため。背景タブでも CDP Input は trusted 扱い）
let lastSkipClick = 0;
function requestSkipClick() {
  const now = Date.now();
  if (now - lastSkipClick < 600) return; // 連打防止
  const btn = document.querySelector(selectors.skipButton.css);
  if (!btn) return;
  // テキスト要素だった場合は押せる本体（ボタン）へ寄せる
  const target = btn.closest('button') || btn;
  const r = target.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  lastSkipClick = now;
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  try { chrome.runtime.sendMessage({ type: 'debuggerClick', x, y }); } catch {}
}

function tick() {
  try {
    if (!selectors || !settings || restarting) return;
    // 1) ダイアログ回避（広告ブロッカー警告などは DOM ごと除去 → 一時停止されていたら再開）
    if (dismissIfPresent(document, selectors)) {
      const v = getVideo();
      if (v && v.paused) v.play().catch(() => {});
    }
    // 2) 広告処理
    if (settings.autoSkip) {
      const adState = readAdState();
      const action = decideAdAction(adState);
      const video = getVideo();
      const wasMutedBefore = !!(video && video.muted);
      applyAdAction(action, { doc: document, video, selectors });
      // 自分がミュートしたフレームだけ weMuted を立てる
      if (video && video.muted && !wasMutedBefore) weMuted = true;
      // スキップボタンが出ている = スキップ可能 → background に本物クリックを依頼
      if (adState.adShowing && adState.skipButtonPresent) requestSkipClick();
      // 広告中のアクション変化を実況ログ
      if (adState.adShowing && action !== lastAdAction) {
        console.info('[yt-ext] 広告', action, '| skipBtn:', adState.skipButtonPresent,
          'enabled:', adState.skipButtonEnabled, '| hidden:', document.hidden,
          '| t:', video ? Math.floor(video.currentTime) : '-',
          '/', video && isFinite(video.duration) ? Math.floor(video.duration) : '?',
          '| rate:', video ? video.playbackRate : '-');
        lastAdAction = action;
      }
      // 広告開始エッジで実広告 DOM を記録
      if (adState.adShowing && !lastAdShowing) {
        const player = document.querySelector(selectors.adShowing.css);
        if (player) captureAdDom(player, { url: location.href });
      }
      // 広告終了エッジで自分のミュートを解除＋再生速度を1xへ戻す
      if (!adState.adShowing && lastAdShowing) {
        unmuteIfNeeded(video, weMuted);
        try { if (video && video.playbackRate !== 1) video.playbackRate = 1; } catch {}
        weMuted = false;
        lastAdAction = null;
      }
      lastAdShowing = adState.adShowing;
    }
    // 再生が実際に始まったら background に1回だけ通知（→ 元タブへ戻して裏へ回す）
    const video = getVideo();
    if (!startedNotified && video && !video.paused && !video.ended && video.currentTime > 0) {
      startedNotified = true;
      try { chrome.runtime.sendMessage({ type: 'playerStarted' }); } catch {}
    }
    // 3) 終端ループ
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
  settings.autoSkip = true; // 広告スキップは常時 ON（UI からは切れない）
  restarting = false;
  lastAdShowing = false; // 曲遷移で広告状態をリセット
  weMuted = false;
  // startedNotified は init でリセットしない:
  // SPA の曲送り毎に再背面化してフォーカスを奪うのを防ぐ（フルリロード時のみ false に戻る）
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
function currentVideoId() {
  try { return new URLSearchParams(location.search).get('v') || ''; } catch { return ''; }
}

function currentChannel() {
  const el = document.querySelector(
    '#owner #channel-name a, ytd-video-owner-renderer #channel-name a, ' +
    '#upload-info #channel-name a, ytd-channel-name a'
  );
  return el ? el.textContent.trim() : '';
}

function currentStatus() {
  const v = getVideo();
  let adShowing = false;
  try { adShowing = !!(selectors && document.querySelector(selectors.adShowing.css)); } catch {}
  return {
    title: document.title.replace(/\s*-\s*YouTube\s*$/, '').trim(),
    channel: currentChannel(),
    videoId: currentVideoId(),
    playing: !!(v && !v.paused && !v.ended && v.currentTime > 0),
    hasVideo: !!v,
    adShowing,
    currentTime: v && isFinite(v.currentTime) ? v.currentTime : 0,
    duration: v && isFinite(v.duration) ? v.duration : 0,
    loop: settings ? settings.loop : null,
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
        case 'seek': if (v && typeof msg.value === 'number' && isFinite(msg.value)) v.currentTime = msg.value; break;
        case 'next': clickNext(document, selectors); break;
        case 'prev': clickPrev(document, selectors); break;
        case 'setLoop': settings.loop = msg.value; break;
      }
      sendResponse({ ok: true, status: currentStatus() });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true; // async response
});

init();

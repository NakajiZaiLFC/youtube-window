// extension/popup.js
import { getSettings, setSetting } from './content/storage.js';
import { exportSnapshots } from './content/adSnapshotLogger.js';

// ?panel=1 付き = ポップアウト済みの独立小窓（Document PiP の発射台にもなる）
const isPanel = location.search.includes('panel');

// Document PiP に移すと UI ノードは pip 側 document へ移動するため、
// 取得元(root)を可変にしておく（移動してもイベントハンドラはノードに残る）。
let root = document;
let pipWin = null;
const $ = (id) => root.getElementById(id);

// すべての制御は background（SW）経由で「裏の再生タブ」へ送る
function bg(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no-bg' }));
}

let lastPlaying = false;
let lastTitle = null;
let lastVid = null;
let lastChannel = null;
let seeking = false;
let seekDur = 0;     // 直近の総再生時間（シーク計算用）
let seekCur = 0;     // 直近の再生位置（±10秒用）

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function setStatus(text, idle) {
  const st = $('status');
  if (!st) return;
  st.firstChild ? (st.firstChild.textContent = text) : (st.textContent = text);
  st.classList.toggle('idle', !!idle);
}

function setTimes(cur, dur) {
  const e = $('elapsed'); if (e) e.textContent = fmt(cur);
  const d = $('duration'); if (d) d.textContent = fmt(dur);
}

// ウォークマン風マーキー: はみ出す時だけ端で止まりつつ往復スクロール
function updateMarquee() {
  const el = $('now');
  if (!el) return;
  el.classList.remove('scroll');
  el.style.removeProperty('--shift');
  el.style.removeProperty('--dur');
  requestAnimationFrame(() => {
    const overflow = el.scrollWidth - el.parentElement.clientWidth;
    if (overflow > 4) {
      el.style.setProperty('--shift', `-${overflow}px`);
      el.style.setProperty('--dur', `${Math.max(6, overflow / 16 + 4)}s`);
      el.classList.add('scroll');
    }
  });
}

function setTitle(title) {
  if (title === lastTitle) return; // 同じ曲ならアニメをリセットしない
  lastTitle = title;
  $('now').textContent = title || '—';
  updateMarquee();
}

function setChannel(name) {
  if (name === lastChannel) return;
  lastChannel = name;
  const el = $('channel');
  if (el) el.textContent = name || '';
}

function setThumb(videoId) {
  if (videoId === lastVid) return;
  lastVid = videoId;
  const img = $('thumb');
  if (!img) return;
  if (videoId) {
    img.classList.remove('empty');
    img.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  } else {
    img.removeAttribute('src');
    img.classList.add('empty');
  }
}

function render(r) {
  if (r && r.error === 'loading') {
    setTitle('読み込み中…'); setChannel(''); setStatus('接続中…', false);
    $('playpause').textContent = '▶';
    return;
  }
  if (!r || !r.ok || !r.status) {
    setTitle('—'); setChannel(''); setThumb(''); setStatus('停止中', true);
    $('playpause').textContent = '▶';
    if (!seeking) { $('seek').value = 0; setTimes(0, 0); }
    seekDur = 0; seekCur = 0;
    return;
  }
  const s = r.status;
  setTitle(s.title || '読み込み中…');
  setChannel(s.channel || '');
  setThumb(s.videoId || '');
  lastPlaying = s.playing;
  $('playpause').textContent = s.playing ? '⏸' : '▶';
  if (s.adShowing) setStatus('広告スキップ中…', false);
  else if (s.playing) setStatus('再生中', false);
  else setStatus('一時停止', true);

  seekDur = s.duration || 0;
  seekCur = s.currentTime || 0;
  if (!seeking) {
    $('seek').value = seekDur ? Math.round((s.currentTime / seekDur) * 1000) : 0;
    setTimes(s.currentTime, seekDur);
  }
}

async function poll() {
  render(await bg({ type: 'getStatus' }));
}

// ── トランスポート ───────────────────────────────────────────
// 再生ボタン = 未起動なら開始 / 起動済みなら 再生⇔一時停止
$('playpause').onclick = async () => {
  await maybePin();            // ← 必ず最初に（user activation 維持のため）
  const o = await bg({ type: 'isOpen' });
  if (!o || !o.open) {
    const s = await getSettings();
    setStatus('起動中…', false);
    await bg({ type: 'openPlaylist', url: s.playlistUrl });
    setTimeout(poll, 1500);
    return;
  }
  await bg({ type: lastPlaying ? 'pause' : 'play' });
  setTimeout(poll, 200);
};

$('next').onclick = async () => { await maybePin(); await bg({ type: 'next' }); setTimeout(poll, 600); };
$('prev').onclick = async () => { await maybePin(); await bg({ type: 'prev' }); setTimeout(poll, 600); };

// ±15秒（絶対シークで実現）
async function nudge(delta) {
  await maybePin();
  if (!seekDur) return;
  const t = Math.max(0, Math.min(seekDur, seekCur + delta));
  await bg({ type: 'seek', value: t });
  setTimeout(poll, 200);
}
$('back15').onclick = () => nudge(-15);
$('fwd15').onclick = () => nudge(15);

// ── ループ: 常時ON（ロック・クリック不要） ──────────────────
// 読み込み時に必ずONへ固定する。アイコンは点灯した状態表示のみ。
async function lockLoopOn() {
  const el = $('loop');
  el.classList.add('on');
  el.title = 'リピート: 常時ON';
  el.setAttribute('aria-disabled', 'true');
  await setSetting('loop', true);
  bg({ type: 'setLoop', value: true });
}

// ── シークバー ─────────────────────────────────────────────
$('seek').addEventListener('input', () => {
  seeking = true;
  setTimes(($('seek').value / 1000) * seekDur, seekDur);
});
$('seek').addEventListener('change', async () => {
  const time = ($('seek').value / 1000) * seekDur;
  await bg({ type: 'seek', value: time });
  seeking = false;
  setTimeout(poll, 200);
});

// ── 最前面固定 / 小窓 ───────────────────────────────────────
// Chrome 拡張のウィンドウは「常に最前面」にできない。唯一の手段が
// Document Picture-in-Picture（常に最前面に浮く小窓）。
// tab（ツールバー popup）モード: まず独立小窓へポップアウト（PiP には永続コンテキストが要る）。
// panel（独立小窓）モード: そこから Document PiP を起動して最前面に固定。
const supportsPiP = 'documentPictureInPicture' in window;

let pipPending = false;
let autoPinArmed = false; // 初回操作で最前面固定するか

// 初回の操作（再生など）で一度だけ最前面固定する。
// Document PiP の requestWindow は user activation 必須なので、各ボタン処理の
// 「先頭」で await maybePin() を呼ぶこと（手前に別の await を挟むと固定が弾かれる）。
async function maybePin() {
  if (!autoPinArmed) return;
  autoPinArmed = false;
  const ok = await enterPiP();
  if (!ok) autoPinArmed = true; // 失敗時は次の操作で再試行
}

async function enterPiP() {
  if (!supportsPiP) return false;
  if (pipPending || (pipWin && !pipWin.closed)) { try { pipWin && pipWin.focus(); } catch {} return true; }
  pipPending = true;
  let win;
  try {
    win = await documentPictureInPicture.requestWindow({ width: 460, height: 200 });
  } catch { pipPending = false; return false; }
  pipWin = win;
  pipPending = false;

  // スタイルを移植
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((s) => {
    win.document.head.appendChild(s.cloneNode(true));
  });
  win.document.body.classList.add('pip');

  // UI 本体を PiP 側へ移動（イベントハンドラはノードに付いたまま移動する）
  const wrap = document.getElementById('wrap');
  win.document.body.append(wrap);
  root = win.document;

  // 注: Document PiP は位置を右下に固定し、moveTo も受け付けない（ブラウザ仕様）。
  //     位置をコードから変更する手段が無いため、初期位置の指定は行わない。

  // PiP のサイズ変更をロック: サイズが既定とズレるたびに必ず戻す（resizeTo 許可時のみ有効）。
  // 既定サイズに一致したら resizeTo を呼ばないので無限ループにならない。
  win.addEventListener('resize', () => {
    if (Math.abs(win.outerWidth - 460) > 2 || Math.abs(win.outerHeight - 200) > 2) {
      try { win.resizeTo(460, 200); } catch {}
    }
  });

  // 発射台の小窓（最前面にならない方）はもう不要 → 最小化して隠す
  try {
    const cur = await chrome.windows.getCurrent();
    if (cur && cur.id != null) chrome.windows.update(cur.id, { state: 'minimized' });
  } catch {}

  // PiP を閉じたら: 再生中の YouTube タブを閉じ、発射台の小窓も片付ける（残骸を残さない）
  win.addEventListener('pagehide', () => {
    pipWin = null;
    pipPending = false;
    try { chrome.runtime.sendMessage({ type: 'closePlayer' }); } catch {}
    try { window.close(); } catch {}
  });
  return true;
}

// 拡張アイコン押下時は常に独立小窓で開く（既に開いていればそれを前面化）。
async function autoPopout() {
  const panelUrl = chrome.runtime.getURL('popup.html?panel=1');
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    for (const w of wins) {
      for (const t of (w.tabs || [])) {
        if (t.url && t.url.includes('popup.html?panel=1')) {
          // 最小化済み = PiP で最前面表示中。空シェルを呼び戻さずそのまま閉じる
          if (w.state !== 'minimized') {
            await chrome.windows.update(w.id, { focused: true });
          }
          window.close();
          return;
        }
      }
    }
  } catch {}
  try {
    await chrome.windows.create({
      url: panelUrl, type: 'popup', width: 480, height: 210, focused: true,
    });
  } catch {}
  window.close();
}

// ── デバッグ: 広告DOM書き出し（UIからは隠しているが機能は残す） ──
const exportBtn = $('export');
if (exportBtn) {
  exportBtn.onclick = async () => {
    const data = await exportSnapshots();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: 'youtube-ad-snapshots.json', saveAs: false });
      setStatus(`${data.length} 件書き出し`, false);
    } catch { setStatus('書き出しに失敗', true); }
    finally { URL.revokeObjectURL(url); }
  };
}

async function load() {
  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}
  // ツールバーから開かれた時は常に独立小窓へ転送（インラインpopupは使わない）
  if (!isPanel) { await autoPopout(); return; }
  document.title = 'Hi-Fi Player';
  await lockLoopOn();              // ループ常時ON
  if (supportsPiP) {
    autoPinArmed = true;          // 初回操作で最前面固定
    // 小窓のどこをクリックしても最前面化する。bubble フェーズで拾うので、
    // ボタン押下時はボタン側の処理が先に走り、ここでの maybePin は冪等で no-op になる。
    document.addEventListener('click', () => { maybePin(); });
  }
  lockLauncherSize();             // 小窓のサイズ変更をロック
  await poll();
  setInterval(poll, 1000);
}

// launcher 小窓のサイズ変更をロック: 既定サイズへ戻す（chrome.windows API で確実に）
function lockLauncherSize() {
  const W = 480, H = 210;
  let busy = false;
  window.addEventListener('resize', async () => {
    if (busy || (pipWin && !pipWin.closed)) return; // PiP中(=最小化)は無視
    busy = true;
    try {
      const cur = await chrome.windows.getCurrent();
      if (cur && cur.state !== 'minimized' && (cur.width !== W || cur.height !== H)) {
        await chrome.windows.update(cur.id, { width: W, height: H });
      }
    } catch {}
    busy = false;
  });
}

load().catch(() => { setStatus('初期化に失敗', true); });

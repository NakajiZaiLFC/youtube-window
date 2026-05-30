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
  const t = $('times');
  if (t) t.textContent = dur ? ` · ${fmt(cur)} / ${fmt(dur)}` : '';
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

$('next').onclick = async () => { await bg({ type: 'next' }); setTimeout(poll, 600); };
$('prev').onclick = async () => { await bg({ type: 'prev' }); setTimeout(poll, 600); };

// ±10秒（絶対シークで実現）
async function nudge(delta) {
  if (!seekDur) return;
  const t = Math.max(0, Math.min(seekDur, seekCur + delta));
  await bg({ type: 'seek', value: t });
  setTimeout(poll, 200);
}
$('back10').onclick = () => nudge(-10);
$('fwd10').onclick = () => nudge(10);

// ── ループ（アイコンのみ） ──────────────────────────────────
function wireLoop() {
  const el = $('loop');
  const toggle = async () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    await setSetting('loop', on);
    bg({ type: 'setLoop', value: on });
  };
  el.onclick = toggle;
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
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

async function enterPiP() {
  if (!supportsPiP) { setStatus('このChromeはPiP非対応', true); return; }
  if (pipWin && !pipWin.closed) { try { pipWin.focus(); } catch {} return; }
  let win;
  try {
    win = await documentPictureInPicture.requestWindow({ width: 460, height: 200 });
  } catch { setStatus('最前面固定に失敗', true); return; }
  pipWin = win;

  // スタイルを移植
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((s) => {
    win.document.head.appendChild(s.cloneNode(true));
  });
  win.document.body.classList.add('pip');

  // UI 本体を PiP 側へ移動（イベントハンドラはノードに付いたまま移動する）
  const wrap = document.getElementById('wrap');
  win.document.body.append(wrap);
  root = win.document;

  const fb = $('float');
  if (fb) { fb.title = '最前面固定を解除'; fb.classList.add('on'); }

  win.addEventListener('pagehide', () => {
    document.body.appendChild(wrap);
    root = document;
    pipWin = null;
    const f = $('float');
    if (f) { f.title = '最前面に固定'; f.classList.remove('on'); }
  });
}

function wireFloat() {
  const el = $('float');
  if (isPanel) {
    // 独立小窓: Document PiP で最前面に固定
    el.textContent = '📌';
    el.title = supportsPiP ? '最前面に固定' : '最前面固定は非対応';
    el.onclick = () => {
      if (pipWin && !pipWin.closed) { pipWin.close(); return; }
      enterPiP();
    };
  } else {
    // ツールバー popup: 永続する独立小窓へポップアウト
    el.textContent = '⧉';
    el.title = '小窓で開く';
    el.onclick = () => {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?panel=1'),
        type: 'popup', width: 480, height: 210, focused: true,
      });
      window.close();
    };
  }
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
  if (isPanel) document.title = 'Hi-Fi Player';
  wireFloat();
  const s = await getSettings();
  $('loop').classList.toggle('on', s.loop);
  wireLoop();
  await poll();
  setInterval(poll, 1000);
}

load().catch(() => { setStatus('初期化に失敗', true); });

// extension/popup.js
import { getSettings, setSetting } from './content/storage.js';
import { exportSnapshots } from './content/adSnapshotLogger.js';

const $ = (id) => document.getElementById(id);

// すべての制御は background（SW）経由で「裏の再生タブ」へ送る
function bg(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no-bg' }));
}

let lastPlaying = false;
let lastTitle = null;
let seeking = false;
let seekDur = 0; // 直近の総再生時間（シーク計算用）

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function setStatus(text, idle) {
  const st = $('status');
  st.textContent = text;
  st.classList.toggle('idle', !!idle);
}

// ウォークマン風マーキー: はみ出す時だけ、端で止まりつつ往復スクロール
function updateMarquee() {
  const el = $('now');
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

function render(r) {
  if (r && r.error === 'loading') {
    setTitle('読み込み中…');
    setStatus('接続中…', false);
    $('playpause').textContent = '▶';
    return;
  }
  if (!r || !r.ok || !r.status) {
    setTitle('—');
    setStatus('停止中', true);
    $('playpause').textContent = '▶';
    if (!seeking) { $('seek').value = 0; $('elapsed').textContent = '0:00'; $('duration').textContent = '0:00'; }
    return;
  }
  const s = r.status;
  setTitle(s.title || '読み込み中…');
  lastPlaying = s.playing;
  $('playpause').textContent = s.playing ? '⏸' : '▶';
  if (s.adShowing) setStatus('広告スキップ中…', false);
  else if (s.playing) setStatus('再生中', false);
  else setStatus('一時停止', true);

  seekDur = s.duration || 0;
  if (!seeking) {
    $('seek').value = seekDur ? Math.round((s.currentTime / seekDur) * 1000) : 0;
    $('elapsed').textContent = fmt(s.currentTime);
    $('duration').textContent = fmt(seekDur);
  }
}

async function poll() {
  render(await bg({ type: 'getStatus' }));
}

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

// ループ（アイコンのみ）
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

// シークバー
$('seek').addEventListener('input', () => {
  seeking = true;
  $('elapsed').textContent = fmt(($('seek').value / 1000) * seekDur);
});
$('seek').addEventListener('change', async () => {
  const time = ($('seek').value / 1000) * seekDur;
  await bg({ type: 'seek', value: time });
  seeking = false;
  setTimeout(poll, 200);
});

$('export').onclick = async () => {
  const data = await exportSnapshots();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: 'youtube-ad-snapshots.json', saveAs: false });
    setStatus(`${data.length} 件書き出し`, false);
  } catch (e) {
    setStatus('書き出しに失敗', true);
  } finally {
    URL.revokeObjectURL(url);
  }
};

async function load() {
  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}
  const s = await getSettings();
  $('loop').classList.toggle('on', s.loop);
  wireLoop();
  await poll();
  setInterval(poll, 1000);
}

load().catch(() => { setStatus('初期化に失敗', true); });

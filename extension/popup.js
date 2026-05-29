// extension/popup.js
import { getSettings, setSetting } from './content/storage.js';
import { exportSnapshots } from './content/adSnapshotLogger.js';

const $ = (id) => document.getElementById(id);

// すべての制御は background（SW）経由で「裏の再生窓」へ送る
function bg(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no-bg' }));
}

let lastPlaying = false;

function setChip(id, on) { $(id).classList.toggle('on', !!on); }

// #status はテキストのみ更新（ドットは CSS の ::before）。停止/一時停止は .idle で淡色化。
function setStatus(text, idle) {
  const st = $('status');
  st.textContent = text;
  st.classList.toggle('idle', !!idle);
}

function render(status, open) {
  if (!open || !status) {
    $('now').textContent = '—';
    setStatus('停止中', true);
    $('playpause').textContent = '▶';
    return;
  }
  $('now').textContent = status.title || '読み込み中…';
  lastPlaying = status.playing;
  $('playpause').textContent = status.playing ? '⏸' : '▶';
  if (status.adShowing) setStatus('広告スキップ中…', false);
  else if (status.playing) setStatus('再生中', false);
  else setStatus('一時停止', true);
}

async function poll() {
  const r = await bg({ type: 'getStatus' });
  render(r && r.ok ? r.status : null, !!(r && r.ok));
}

async function load() {
  const s = await getSettings();
  $('url').value = s.playlistUrl;
  setChip('loop', s.loop);
  setChip('autoSkip', s.autoSkip);
  await poll();
  setInterval(poll, 1000); // popup が閉じれば自動停止
}

$('start').onclick = async () => {
  const s = await getSettings();
  setStatus('起動中…', false);
  await bg({ type: 'openPlaylist', url: s.playlistUrl });
  setTimeout(poll, 1500);
};

$('playpause').onclick = async () => {
  await bg({ type: lastPlaying ? 'pause' : 'play' });
  setTimeout(poll, 200);
};
$('next').onclick = async () => { await bg({ type: 'next' }); setTimeout(poll, 600); };
$('prev').onclick = async () => { await bg({ type: 'prev' }); setTimeout(poll, 600); };

function wireToggle(id, settingKey, msgType) {
  const el = $(id);
  const handler = async () => {
    const on = !el.classList.contains('on');
    setChip(id, on);
    await setSetting(settingKey, on);
    bg({ type: msgType, value: on });
  };
  el.onclick = handler;
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } };
}
wireToggle('loop', 'loop', 'setLoop');
wireToggle('autoSkip', 'autoSkip', 'setAutoSkip');

$('save').onclick = async () => {
  await setSetting('playlistUrl', $('url').value.trim());
  setStatus('URL保存しました', false);
};

$('export').onclick = async () => {
  const data = await exportSnapshots();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: 'youtube-ad-snapshots.json', saveAs: false });
    $('status').textContent = `${data.length} 件エクスポート`;
  } catch (e) {
    $('status').textContent = 'エクスポートに失敗しました';
  } finally {
    URL.revokeObjectURL(url);
  }
};

load().catch(() => { $('status').textContent = '初期化に失敗しました'; });

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

function render(status, open) {
  if (!open || !status) {
    $('now').textContent = '—';
    $('status').innerHTML = '<span class="dot" style="color:#5a4636">●</span> 停止中';
    $('playpause').textContent = '▶';
    return;
  }
  $('now').textContent = status.title || '読み込み中…';
  lastPlaying = status.playing;
  $('playpause').textContent = status.playing ? '⏸' : '▶';
  let label;
  if (status.adShowing) label = '<span class="dot">●</span> 広告スキップ中…';
  else if (status.playing) label = '<span class="dot">●</span> 再生中';
  else label = '<span class="dot" style="color:#5a4636">●</span> 一時停止';
  $('status').innerHTML = label;
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
  $('status').innerHTML = '<span class="dot">●</span> 起動中…';
  await bg({ type: 'openPlaylist', url: s.playlistUrl });
  setTimeout(poll, 1500);
};

$('playpause').onclick = async () => {
  await bg({ type: lastPlaying ? 'pause' : 'play' });
  setTimeout(poll, 200);
};
$('next').onclick = async () => { await bg({ type: 'next' }); setTimeout(poll, 600); };
$('prev').onclick = async () => { await bg({ type: 'prev' }); setTimeout(poll, 600); };

$('loop').onclick = async () => {
  const on = !$('loop').classList.contains('on');
  setChip('loop', on);
  await setSetting('loop', on);
  bg({ type: 'setLoop', value: on });
};
$('autoSkip').onclick = async () => {
  const on = !$('autoSkip').classList.contains('on');
  setChip('autoSkip', on);
  await setSetting('autoSkip', on);
  bg({ type: 'setAutoSkip', value: on });
};

$('save').onclick = async () => {
  await setSetting('playlistUrl', $('url').value.trim());
  $('status').innerHTML = '<span class="dot">●</span> URL保存しました';
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

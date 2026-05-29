// extension/popup.js
import { getSettings, setSetting } from './content/storage.js';
import { exportSnapshots } from './content/adSnapshotLogger.js';

const $ = (id) => document.getElementById(id);

async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    $('status').textContent = 'このタブには接続できません（YouTubeで開いてください）';
  }
}

async function load() {
  const s = await getSettings();
  $('url').value = s.playlistUrl;
  $('loop').checked = s.loop;
  $('autoSkip').checked = s.autoSkip;
  const cache = await chrome.storage.local.get('selectorsCache');
  $('status').textContent = 'セレクタ: ' + (cache.selectorsCache?.version || '同梱デフォルト');
}

$('save').onclick = async () => { await setSetting('playlistUrl', $('url').value.trim()); $('status').textContent = '保存しました'; };
$('start').onclick = async () => {
  const s = await getSettings();
  if (!s.playlistUrl) { $('status').textContent = 'URLを保存してください'; return; }
  try {
    await chrome.runtime.sendMessage({ type: 'openPlaylist', url: s.playlistUrl });
  } catch (e) {
    $('status').textContent = 'プレイリストの起動に失敗しました';
  }
};
$('next').onclick = () => sendToActiveTab({ type: 'next' });
$('prev').onclick = () => sendToActiveTab({ type: 'prev' });
$('loop').onchange = async (e) => { await setSetting('loop', e.target.checked); sendToActiveTab({ type: 'setLoop', value: e.target.checked }); };
$('autoSkip').onchange = async (e) => { await setSetting('autoSkip', e.target.checked); sendToActiveTab({ type: 'setAutoSkip', value: e.target.checked }); };
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

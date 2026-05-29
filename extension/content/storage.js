// extension/content/storage.js
export const DEFAULT_SETTINGS = {
  // 既定はユーザー固定のプレイリスト（popup から変更可）
  playlistUrl: 'https://youtube.com/playlist?list=PLo5_HqN-8W46WkZczUFECWMIRvR2bc0Hf&si=XJ-ul5DduBJ86j3p',
  loop: true,
  autoSkip: true,
};

const KEY = 'settings';

export async function getSettings() {
  const got = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(got[KEY] || {}) };
}

export async function setSetting(key, value) {
  const current = await getSettings();
  const next = { ...current, [key]: value };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

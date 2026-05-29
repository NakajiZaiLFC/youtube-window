// extension/content/storage.js
export const DEFAULT_SETTINGS = {
  playlistUrl: '',
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

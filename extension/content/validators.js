// extension/content/validators.js
export function isValidSelectors(obj) {
  if (!(obj && typeof obj === 'object'
    && typeof obj.version === 'string'
    && obj.selectors && typeof obj.selectors === 'object'
    && Object.keys(obj.selectors).length > 0)) return false;

  // I-1: 各エントリが css に非空文字列を持つことを確認（破損キャッシュ対策）
  return Object.values(obj.selectors).every(
    (entry) => entry && typeof entry.css === 'string' && entry.css.length > 0,
  );
}

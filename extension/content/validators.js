// extension/content/validators.js
export function isValidSelectors(obj) {
  return !!(obj && typeof obj === 'object'
    && typeof obj.version === 'string'
    && obj.selectors && typeof obj.selectors === 'object'
    && Object.keys(obj.selectors).length > 0);
}

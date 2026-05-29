// build.mjs — content script を単一 IIFE バンドルに固める
import { build } from 'esbuild';

await build({
  entryPoints: ['extension/content/content.js'],
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  loader: { '.json': 'json' },
  outfile: 'extension/dist/content.bundle.js',
});
console.log('built extension/dist/content.bundle.js');

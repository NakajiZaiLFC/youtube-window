// build.mjs — content script を単一 IIFE バンドルに固める ＋ version を manifest.json へ同期
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

// version の単一の出どころは package.json。manifest.json へ同期してズレを防ぐ。
function syncVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const manifestPath = 'extension/manifest.json';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== pkg.version) {
    manifest.version = pkg.version;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`synced manifest version -> ${pkg.version}`);
  }
  return pkg.version;
}

try {
  const version = syncVersion();
  await build({
    entryPoints: ['extension/content/content.js'],
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    loader: { '.json': 'json' },
    outfile: 'extension/dist/content.bundle.js',
  });
  console.log(`built extension/dist/content.bundle.js (v${version})`);
} catch (e) {
  console.error(e);
  process.exit(1);
}

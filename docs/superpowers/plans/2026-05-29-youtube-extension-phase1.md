# YouTube プレイリスト拡張 Phase 1（拡張本体）Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YouTube ネイティブプレイリストを広告自動回避・確認ダイアログ自動回避しつつ連続再生する MV3 Chrome 拡張本体（操作パネル付き）を作る。

**Architecture:** vanilla JS ES モジュールで実装。広告/ダイアログ/プレイリストの「判断」を純粋関数に切り出して Vitest + jsdom で単体テストし、DOM 適用部は薄く保つ。セレクタは外部 `selectors.json`（同梱デフォルト＋将来リモート fetch）に集約。content script のみ esbuild で単一バンドルに固める（content script は静的 import 不可のため）。service worker と popup は ES モジュールをそのまま使用。

**Tech Stack:** Manifest V3 / vanilla JavaScript (ESM) / esbuild（content バンドル）/ Vitest + jsdom（テスト）/ Node 20+。

**設計書:** `docs/superpowers/specs/2026-05-29-youtube-playlist-adfree-extension-design.md`

**スコープ注記:** 本計画は設計書の **Subsystem 1（拡張本体）のみ**。Subsystem 2（毎朝の保守 Hook）は Phase 1 完了後に別計画として作成する。Phase 1 完了時点で「手動セレクタ更新で完結して動く拡張」が成果物。

---

## File Structure（Phase 1 で作る／触るファイル）

```
extension/
  manifest.json              MV3 設定。content は dist/content.bundle.js を参照
  selectors.json             同梱デフォルトのセレクタ契約（フォールバック元）
  background.js              service worker（type:module）。alarms / リモート refresh / タブ起動 / メッセージ中継
  popup.html                 操作パネル UI
  popup.js                   popup ロジック（type=module）
  content/
    storage.js               chrome.storage ラッパ（純粋寄り、mock でテスト）
    validators.js            isValidSelectors（JSON import を持たない純粋関数。SW も安全に import 可）
    selectorLoader.js        セレクタ選択ロジック（3段フォールバック・純粋）＋storage 読み出し＋同梱JSON import
    adSkipper.js             decideAdAction(純粋) ＋ DOM 適用
    promptDismisser.js       findDismissTarget(純粋・jsdom) ＋ クリック適用
    playlistController.js    decideEndAction(純粋) ＋ next/prev/restart DOM 操作
    adSnapshotLogger.js      trimSnapshots(純粋) ＋ 広告 DOM 記録/エクスポート
    content.js               司令塔（二重監視・SPA再初期化・メッセージ処理）
  dist/
    content.bundle.js        esbuild 出力（manifest が参照。git 管理外）
package.json
vitest.config.js
build.mjs                    esbuild ビルドスクリプト
tests/
  storage.test.js
  validators.test.js
  selectorLoader.test.js
  adSkipper.test.js
  promptDismisser.test.js
  playlistController.test.js
  adSnapshotLogger.test.js
  fixtures/
    still-watching-dialog.html
    no-dialog.html
    adblock-dialog.html
```

各ファイルは単一責務。判断ロジック（`decide*`/`find*`/`trim*`/`pick*`）は副作用なしの純粋関数として独立テストし、DOM・chrome API への適用は薄い適用関数に分離する。

---

## Chunk 1: プロジェクト土台とツールチェーン

### Task 1: スキャフォールドと依存導入

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`
- Create: `extension/dist/.gitkeep`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "yt-playlist-adfree-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "build": "node build.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.21.0",
    "jsdom": "^24.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: vitest.config.js を作成**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: .gitignore を作成**

```
node_modules/
extension/dist/*.js
```

- [ ] **Step 4: dist ディレクトリを git 追跡用に確保**

`extension/dist/.gitkeep` を空ファイルで作成。

- [ ] **Step 5: 依存をインストールしてテストランナーが動くことを確認**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: exit code 0（テスト 0 件でも `--passWithNoTests` により正常終了）

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.js .gitignore extension/dist/.gitkeep
git commit -m "chore: scaffold extension project with vitest + esbuild"
```

---

## Chunk 2: 純粋ロジックモジュール（TDD）

> このチャンクは副作用のない判断ロジックを TDD で実装する。各モジュールは「純粋関数（テスト対象）＋薄い適用関数（手動確認）」に分かれる。

### Task 2: storage.js（設定ラッパ）

**Files:**
- Create: `extension/content/storage.js`
- Test: `tests/storage.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../extension/content/storage.js';

function fakeChromeStorage(initial = {}) {
  let store = { ...initial };
  return {
    storage: {
      local: {
        get: vi.fn((keys) => Promise.resolve(
          typeof keys === 'string' ? { [keys]: store[keys] } : { ...store }
        )),
        set: vi.fn((obj) => { store = { ...store, ...obj }; return Promise.resolve(); }),
      },
    },
  };
}

beforeEach(() => { globalThis.chrome = fakeChromeStorage(); });

describe('storage', () => {
  it('returns DEFAULT_SETTINGS merged when nothing stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides defaults with stored values', async () => {
    globalThis.chrome = fakeChromeStorage({ settings: { loop: false } });
    const s = await getSettings();
    expect(s.loop).toBe(false);
    expect(s.autoSkip).toBe(DEFAULT_SETTINGS.autoSkip);
  });

  it('setSetting persists a single key', async () => {
    await setSetting('playlistUrl', 'https://x');
    const s = await getSettings();
    expect(s.playlistUrl).toBe('https://x');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/storage.test.js`
Expected: FAIL（モジュール未定義 / export 無し）

- [ ] **Step 3: 最小実装**

```js
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/storage.test.js`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**

```bash
git add extension/content/storage.js tests/storage.test.js
git commit -m "feat: add storage wrapper with default settings"
```

### Task 3a: validators.js（JSON import を持たない検証関数）

> SW（background.js）は `isValidSelectors` だけを使う。これを `selectorLoader.js`（同梱 JSON を import する）から切り離し、SW が JSON モジュール解決でクラッシュしないようにする（MV3 のネイティブ ESM は import attributes 無しの JSON import を解決できない）。

**Files:**
- Create: `extension/content/validators.js`
- Test: `tests/validators.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/validators.test.js
import { describe, it, expect } from 'vitest';
import { isValidSelectors } from '../extension/content/validators.js';

const valid = { version: 'v', selectors: { adShowing: { css: '.x' } } };

describe('isValidSelectors', () => {
  it('accepts an object with version and non-empty selectors', () => {
    expect(isValidSelectors(valid)).toBe(true);
  });
  it('rejects null / missing selectors / empty selectors', () => {
    expect(isValidSelectors(null)).toBe(false);
    expect(isValidSelectors({ version: 'v' })).toBe(false);
    expect(isValidSelectors({ version: 'v', selectors: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/validators.test.js`
Expected: FAIL

- [ ] **Step 3: 最小実装（JSON import を一切持たない）**

```js
// extension/content/validators.js
export function isValidSelectors(obj) {
  return !!(obj && typeof obj === 'object'
    && typeof obj.version === 'string'
    && obj.selectors && typeof obj.selectors === 'object'
    && Object.keys(obj.selectors).length > 0);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/validators.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**

```bash
git add extension/content/validators.js tests/validators.test.js
git commit -m "feat: add JSON-import-free selector validator (SW-safe)"
```

### Task 3: selectorLoader.js（3段フォールバック）

**Files:**
- Create: `extension/content/selectorLoader.js`
- Create: `extension/selectors.json`
- Test: `tests/selectorLoader.test.js`

- [ ] **Step 1: selectors.json（同梱デフォルト）を作成**

設計書 §5.3 のスキーマに準拠。`<実調査で確定>` のダイアログ系は Task 12 の実 DOM 調査で確定するため、初期値は調査前の暫定セレクタを入れ、`assert` は維持する。

```json
{
  "version": "2026-05-29.0-bundled",
  "updatedAt": "2026-05-29T00:00:00+09:00",
  "selectors": {
    "adShowing":            { "css": ".ad-showing",            "assertType": "static",  "assert": "exists" },
    "skipButton":           { "css": ".ytp-ad-skip-button",    "assertType": "static",  "assert": "clickable-button" },
    "nextButton":           { "css": ".ytp-next-button",       "assertType": "dynamic", "assert": "advances-video" },
    "prevButton":           { "css": ".ytp-prev-button",       "assertType": "static",  "assert": "exists" },
    "stillWatchingDialog":  { "css": "yt-confirm-dialog-renderer", "assertType": "static",  "assert": "dialog" },
    "stillWatchingConfirm": { "css": "yt-confirm-dialog-renderer #confirm-button", "assertType": "dynamic", "assert": "dismisses-dialog" },
    "adblockDialog":        { "css": "tp-yt-paper-dialog",     "assertType": "static",  "assert": "dialog" },
    "adblockDialogClose":   { "css": "tp-yt-paper-dialog #dismiss-button", "assertType": "dynamic", "assert": "dismisses-dialog" }
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

```js
// tests/selectorLoader.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickSelectors, getSelectors } from '../extension/content/selectorLoader.js';

const valid = { version: 'v', selectors: { adShowing: { css: '.x' } } };

describe('pickSelectors (3段フォールバック)', () => {
  const bundled = { version: 'bundled', selectors: { adShowing: { css: '.b' } } };
  it('prefers a valid remote', () => {
    const r = pickSelectors({ remote: valid, cached: null, bundled });
    expect(r.source).toBe('remote');
    expect(r.data).toBe(valid);
  });
  it('falls back to cached when remote invalid', () => {
    const cached = { version: 'cached', selectors: { adShowing: { css: '.c' } } };
    const r = pickSelectors({ remote: null, cached, bundled });
    expect(r.source).toBe('cached');
    expect(r.data).toBe(cached);
  });
  it('falls back to bundled when remote and cached invalid', () => {
    const r = pickSelectors({ remote: null, cached: undefined, bundled });
    expect(r.source).toBe('bundled');
    expect(r.data).toBe(bundled);
  });
});

// JSON import 経路（同梱デフォルト）を実際に評価する唯一のテスト
describe('getSelectors (JSON import 経路)', () => {
  beforeEach(() => {
    let store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn((k) => Promise.resolve({ [k]: store[k] })),
      set: vi.fn((o) => { store = { ...store, ...o }; return Promise.resolve(); }),
    } } };
  });
  it('returns bundled selectors when storage cache is empty', async () => {
    const sels = await getSelectors();
    // 同梱 selectors.json の adShowing が読めること（import が壊れていれば throw / undefined）
    expect(sels.adShowing).toBeTruthy();
    expect(typeof sels.adShowing.css).toBe('string');
  });
  it('returns cached selectors when present and valid', async () => {
    globalThis.chrome.storage.local.set({ selectorsCache: valid });
    const sels = await getSelectors();
    expect(sels.adShowing.css).toBe('.x');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run tests/selectorLoader.test.js`
Expected: FAIL（export 無し）

- [ ] **Step 4: 最小実装（検証は validators.js から import し、JSON import は本ファイルに閉じ込める）**

```js
// extension/content/selectorLoader.js
import bundled from '../selectors.json';
import { isValidSelectors } from './validators.js';

// remote → cached → bundled の順で最初に妥当なものを採用
export function pickSelectors({ remote, cached, bundled: b }) {
  if (isValidSelectors(remote)) return { source: 'remote', data: remote };
  if (isValidSelectors(cached)) return { source: 'cached', data: cached };
  return { source: 'bundled', data: b };
}

const CACHE_KEY = 'selectorsCache';

// content 側: storage のキャッシュ → 無ければ同梱デフォルト
export async function getSelectors() {
  const got = await chrome.storage.local.get(CACHE_KEY);
  const { data } = pickSelectors({ remote: null, cached: got[CACHE_KEY], bundled });
  return data.selectors;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/selectorLoader.test.js`
Expected: PASS（5 件）。`getSelectors` テストが同梱 `selectors.json` の import を実際に評価する（Vitest は Vite 経由で `.json` を default import 可能）。

- [ ] **Step 6: Commit**

```bash
git add extension/content/selectorLoader.js extension/selectors.json tests/selectorLoader.test.js
git commit -m "feat: add selector loader with 3-stage fallback + bundled defaults"
```

### Task 4: adSkipper.js（広告判断）

> 設計書 §4.2 と整合: `decideAdAction` の戻り値は `'click-skip' | 'mute-and-wait' | 'none'` の3値。早送りは独立アクションにせず、`mute-and-wait` 適用時の best-effort 副作用に統合する（PoC 前提のため判断分岐を増やさない）。

**Files:**
- Create: `extension/content/adSkipper.js`
- Test: `tests/adSkipper.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/adSkipper.test.js
import { describe, it, expect } from 'vitest';
import { decideAdAction } from '../extension/content/adSkipper.js';

describe('decideAdAction', () => {
  it('returns none when no ad is showing', () => {
    expect(decideAdAction({ adShowing: false })).toBe('none');
  });
  it('clicks skip when skip button is present and enabled', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: true }))
      .toBe('click-skip');
  });
  it('mutes and waits when skip button present but still counting down', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: true, skipButtonEnabled: false }))
      .toBe('mute-and-wait');
  });
  it('mutes and waits for unskippable ad (no skip button)', () => {
    expect(decideAdAction({ adShowing: true, skipButtonPresent: false }))
      .toBe('mute-and-wait');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/adSkipper.test.js`
Expected: FAIL

- [ ] **Step 3: 最小実装**

```js
// extension/content/adSkipper.js

// 純粋: プレイヤー状態から取るべき広告対応を決める
export function decideAdAction(state) {
  if (!state.adShowing) return 'none';
  if (state.skipButtonPresent && state.skipButtonEnabled) return 'click-skip';
  return 'mute-and-wait';
}

// 薄い適用関数（手動確認）。video/document と現行 selectors を受けて副作用を起こす。
// fast-forward は best-effort（設計書 §4.2: 広告中シーク禁止の可能性あり、PoC は Task 13）。
export function applyAdAction(action, { doc, video, selectors }) {
  switch (action) {
    case 'click-skip': {
      const btn = doc.querySelector(selectors.skipButton.css);
      if (btn) btn.click();
      break;
    }
    case 'mute-and-wait': {
      if (video && !video.muted) video.muted = true;
      // best-effort 早送り（効かない環境では無視される）
      try { if (video && isFinite(video.duration)) video.currentTime = video.duration; } catch {}
      break;
    }
    default:
      break;
  }
}

// 広告終了時に拡張がミュートした分だけ解除する用（weMuted フラグは呼び出し側が管理）
export function unmuteIfNeeded(video, weMuted) {
  if (video && weMuted && video.muted) video.muted = false;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/adSkipper.test.js`
Expected: PASS（4 件）

- [ ] **Step 5: Commit**

```bash
git add extension/content/adSkipper.js tests/adSkipper.test.js
git commit -m "feat: add ad skip decision logic + apply helpers"
```

### Task 5: promptDismisser.js（ダイアログ判断）

> 優先順位の仕様: 「まだ視聴していますか？」を adblock ダイアログより**先に**判定する（再生継続が最優先のため）。両方同時に出ることは稀だが、その場合は still-watching を先に閉じる。

**Files:**
- Create: `extension/content/promptDismisser.js`
- Create: `tests/fixtures/still-watching-dialog.html`
- Create: `tests/fixtures/no-dialog.html`
- Create: `tests/fixtures/adblock-dialog.html`
- Test: `tests/promptDismisser.test.js`

- [ ] **Step 1: フィクスチャを作成**

`tests/fixtures/still-watching-dialog.html`:
```html
<body>
  <yt-confirm-dialog-renderer>
    <button id="confirm-button">はい</button>
  </yt-confirm-dialog-renderer>
</body>
```

`tests/fixtures/no-dialog.html`:
```html
<body><div id="player">playing</div></body>
```

`tests/fixtures/adblock-dialog.html`:
```html
<body>
  <tp-yt-paper-dialog>
    <button id="dismiss-button">閉じる</button>
  </tp-yt-paper-dialog>
</body>
```

- [ ] **Step 2: 失敗するテストを書く**

```js
// tests/promptDismisser.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findDismissTarget } from '../extension/content/promptDismisser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const selectors = {
  stillWatchingDialog:  { css: 'yt-confirm-dialog-renderer' },
  stillWatchingConfirm: { css: 'yt-confirm-dialog-renderer #confirm-button' },
  adblockDialog:        { css: 'tp-yt-paper-dialog' },
  adblockDialogClose:   { css: 'tp-yt-paper-dialog #dismiss-button' },
};

function docFrom(html) {
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
  return document;
}

describe('findDismissTarget', () => {
  it('returns the confirm button for a "still watching" dialog', () => {
    const target = findDismissTarget(docFrom(fixture('still-watching-dialog.html')), selectors);
    expect(target).not.toBeNull();
    expect(target.id).toBe('confirm-button');
  });
  it('returns the dismiss button for an adblock dialog', () => {
    const target = findDismissTarget(docFrom(fixture('adblock-dialog.html')), selectors);
    expect(target).not.toBeNull();
    expect(target.id).toBe('dismiss-button');
  });
  it('returns null when no dialog present', () => {
    const target = findDismissTarget(docFrom(fixture('no-dialog.html')), selectors);
    expect(target).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run tests/promptDismisser.test.js`
Expected: FAIL

- [ ] **Step 4: 最小実装**

```js
// extension/content/promptDismisser.js

// 純粋: 閉じるべきダイアログがあればクリック対象要素を返す。無ければ null。
export function findDismissTarget(root, selectors) {
  if (root.querySelector(selectors.stillWatchingDialog.css)) {
    const btn = root.querySelector(selectors.stillWatchingConfirm.css);
    if (btn) return btn;
  }
  if (root.querySelector(selectors.adblockDialog.css)) {
    const btn = root.querySelector(selectors.adblockDialogClose.css);
    if (btn) return btn;
  }
  return null;
}

// 薄い適用関数
export function dismissIfPresent(root, selectors) {
  const target = findDismissTarget(root, selectors);
  if (target) target.click();
  return !!target;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/promptDismisser.test.js`
Expected: PASS（3 件）

- [ ] **Step 6: Commit**

```bash
git add extension/content/promptDismisser.js tests/promptDismisser.test.js tests/fixtures/
git commit -m "feat: add prompt dismisser with dialog detection"
```

### Task 6: playlistController.js（終端ループ判断）

**Files:**
- Create: `extension/content/playlistController.js`
- Test: `tests/playlistController.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/playlistController.test.js
import { describe, it, expect } from 'vitest';
import { decideEndAction } from '../extension/content/playlistController.js';

describe('decideEndAction', () => {
  it('restarts when at playlist end and loop enabled', () => {
    expect(decideEndAction({ atPlaylistEnd: true, loopEnabled: true })).toBe('restart-playlist');
  });
  it('does nothing at end when loop disabled', () => {
    expect(decideEndAction({ atPlaylistEnd: true, loopEnabled: false })).toBe('none');
  });
  it('does nothing when not at end (YouTube auto-advances)', () => {
    expect(decideEndAction({ atPlaylistEnd: false, loopEnabled: true })).toBe('none');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/playlistController.test.js`
Expected: FAIL

- [ ] **Step 3: 最小実装**

```js
// extension/content/playlistController.js

// 純粋: プレイリスト終端での挙動を決める。途中は YouTube が自動で次へ進むので none。
export function decideEndAction(state) {
  if (state.atPlaylistEnd && state.loopEnabled) return 'restart-playlist';
  return 'none';
}

// 薄い適用関数群
export function clickNext(doc, selectors) {
  const btn = doc.querySelector(selectors.nextButton.css);
  if (btn) btn.click();
  return !!btn;
}
export function clickPrev(doc, selectors) {
  const btn = doc.querySelector(selectors.prevButton.css);
  if (btn) btn.click();
  return !!btn;
}
// 先頭復帰の具体手段は設計書 §9 の未決事項。暫定: index=1 へ再遷移。
export function restartPlaylist(loc) {
  const url = new URL(loc.href);
  url.searchParams.set('index', '1');
  loc.href = url.toString();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/playlistController.test.js`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**

```bash
git add extension/content/playlistController.js tests/playlistController.test.js
git commit -m "feat: add playlist end/loop decision + nav helpers"
```

### Task 7: adSnapshotLogger.js（広告 DOM 記録のトリム）

**Files:**
- Create: `extension/content/adSnapshotLogger.js`
- Test: `tests/adSnapshotLogger.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/adSnapshotLogger.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimSnapshots, captureAdDom, exportSnapshots, MAX_COUNT, MAX_CHARS_EACH }
  from '../extension/content/adSnapshotLogger.js';

const mk = (html) => ({ capturedAt: 't', url: 'u', region: 'player', html });

describe('trimSnapshots (純粋)', () => {
  it('keeps only the most recent MAX_COUNT entries', () => {
    const list = Array.from({ length: MAX_COUNT + 3 }, (_, i) => mk('x' + i));
    const out = trimSnapshots(list);
    expect(out).toHaveLength(MAX_COUNT);
    expect(out[out.length - 1].html).toBe('x' + (MAX_COUNT + 2)); // newest kept
  });
  it('truncates oversized html to MAX_CHARS_EACH (文字数上限)', () => {
    const big = mk('a'.repeat(MAX_CHARS_EACH + 100));
    const out = trimSnapshots([big]);
    expect(out[0].html.length).toBeLessThanOrEqual(MAX_CHARS_EACH);
  });
  it('truncates multibyte html by char count (バイト数ではない点を明示)', () => {
    const out = trimSnapshots([mk('あ'.repeat(MAX_CHARS_EACH + 50))]);
    expect(out[0].html.length).toBe(MAX_CHARS_EACH); // .length は code unit 数
  });
});

describe('captureAdDom + exportSnapshots (storage 経路・設計書 §4.5 の核)', () => {
  beforeEach(() => {
    let store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn((k) => Promise.resolve({ [k]: store[k] })),
      set: vi.fn((o) => { store = { ...store, ...o }; return Promise.resolve(); }),
    } } };
  });
  it('appends a snapshot and keeps at most MAX_COUNT (oldest dropped)', async () => {
    const node = { outerHTML: '<div>ad</div>' };
    for (let i = 0; i < MAX_COUNT + 2; i++) {
      await captureAdDom(node, { url: 'u' + i });
    }
    const out = await exportSnapshots();
    expect(out).toHaveLength(MAX_COUNT);
    expect(out[out.length - 1].url).toBe('u' + (MAX_COUNT + 1)); // newest kept
    expect(out[0].url).toBe('u2'); // oldest two dropped
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/adSnapshotLogger.test.js`
Expected: FAIL

- [ ] **Step 3: 最小実装**

> 注: `MAX_CHARS_EACH` は**文字数（code unit）上限**。バイト上限ではない（マルチバイトでは実バイト数が最大3倍になる点を許容。storage/Claude 入力サイズの粗い上限として十分）。`new Date().toISOString()` は副作用（時刻）だが `captureAdDom` は適用関数なので許容。純粋テスト対象は `trimSnapshots` のみ。

```js
// extension/content/adSnapshotLogger.js
export const MAX_COUNT = 5;
export const MAX_CHARS_EACH = 50_000; // 文字数上限（バイトではない）
const KEY = 'adSnapshots';

// 純粋: 直近 MAX_COUNT 件に絞り、各 html を MAX_CHARS_EACH 文字に切り詰める
export function trimSnapshots(list) {
  return list
    .slice(-MAX_COUNT)
    .map((s) => ({ ...s, html: s.html.slice(0, MAX_CHARS_EACH) }));
}

// 適用: 広告 DOM を storage.local に追記（push してから trim）
export async function captureAdDom(node, { url }) {
  const got = await chrome.storage.local.get(KEY);
  const list = got[KEY] || [];
  list.push({ capturedAt: new Date().toISOString(), url, region: 'player', html: node.outerHTML });
  await chrome.storage.local.set({ [KEY]: trimSnapshots(list) });
}

// エクスポート用に現在の蓄積を返す（popup から chrome.downloads で書き出す）
export async function exportSnapshots() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || [];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/adSnapshotLogger.test.js`
Expected: PASS（4 件）

- [ ] **Step 5: 全純粋ロジックのテストをまとめて緑にする**

Run: `npx vitest run`
Expected: PASS（全 24 件: validators 2 + storage 3 + selectorLoader 5 + adSkipper 4 + promptDismisser 3 + playlist 3 + adSnapshotLogger 4）

- [ ] **Step 6: Commit**

```bash
git add extension/content/adSnapshotLogger.js tests/adSnapshotLogger.test.js
git commit -m "feat: add ad-DOM snapshot logger with trimming + storage path test"
```

---

## Chunk 3: ランタイム配線（content.js / background.js）

> ここは DOM・chrome API への配線で自動テストが難しい。薄く保ち、Task 12 の手動確認チェックリストで検証する。

### Task 8: content.js（司令塔）

**Files:**
- Create: `extension/content/content.js`

- [ ] **Step 1: 司令塔を実装**

責務: ①起動時に `getSelectors()`／`getSettings()` 取得 ②`yt-navigate-finish` で曲ごと再初期化 ③MutationObserver ＋ 500ms ポーリングの二重監視で各ハンドラ呼び出し ④popup からのメッセージ（next/prev/loop/autoSkip/exportSnapshots）処理。各ハンドラは try/catch で囲みループを止めない。

**実装上の注意（レビュー指摘の反映）:**
- **observer リーク防止**: `MutationObserver` をモジュールスコープに保持し、`init()` 冒頭で前回分を `disconnect()`。`yt-navigate-finish` ごとに observer が増殖しないようにする。
- **observer のデバウンス**: 変異のたびに `tick()` 全実行は重いので、observer は `requestAnimationFrame` 1回に集約してから `tick()` を呼ぶ。
- **weMuted の厳密管理**: 「自分がミュートしたフレームだけ」フラグを立てる。`applyAdAction` 呼び出し前に `wasMutedBefore = video.muted` を取り、適用後に `video.muted && !wasMutedBefore` の時だけ `weMuted = true`。ユーザー自身のミュートは尊重する。
- **autoSkip OFF への切替リセット**: `setAutoSkip(false)` 受信時、`weMuted` なら強制 unmute し、`weMuted=false`・`lastAdShowing=false` にリセット（広告中の OFF でミュートが残る事故を防ぐ）。
- **終端ループの多重発火防止**: `restartPlaylist` を呼んだら `restarting=true` ガードを立て、`clearInterval(pollTimer)` で二重発火を止める。

```js
// extension/content/content.js
import { getSelectors } from './selectorLoader.js';
import { getSettings } from './storage.js';
import { decideAdAction, applyAdAction, unmuteIfNeeded } from './adSkipper.js';
import { dismissIfPresent } from './promptDismisser.js';
import { decideEndAction, clickNext, clickPrev, restartPlaylist } from './playlistController.js';
import { captureAdDom } from './adSnapshotLogger.js';

let selectors = null;
let settings = null;
let weMuted = false;
let lastAdShowing = false;
let pollTimer = null;
let observer = null;
let rafQueued = false;
let restarting = false;

function getVideo() { return document.querySelector('video'); }

function readAdState() {
  const adShowing = !!document.querySelector(selectors.adShowing.css);
  const skipBtn = document.querySelector(selectors.skipButton.css);
  return {
    adShowing,
    skipButtonPresent: !!skipBtn,
    skipButtonEnabled: !!skipBtn && !skipBtn.disabled,
  };
}

function tick() {
  try {
    if (!selectors || !settings || restarting) return;
    // 1) ダイアログ回避
    dismissIfPresent(document, selectors);
    // 2) 広告処理
    if (settings.autoSkip) {
      const adState = readAdState();
      const action = decideAdAction(adState);
      const video = getVideo();
      const wasMutedBefore = !!(video && video.muted);
      applyAdAction(action, { doc: document, video, selectors });
      // 自分がミュートしたフレームだけ weMuted を立てる
      if (video && video.muted && !wasMutedBefore) weMuted = true;
      // 広告開始エッジで実広告 DOM を記録
      if (adState.adShowing && !lastAdShowing) {
        const player = document.querySelector(selectors.adShowing.css);
        if (player) captureAdDom(player, { url: location.href });
      }
      // 広告終了エッジで自分のミュートだけ解除
      if (!adState.adShowing && lastAdShowing) {
        unmuteIfNeeded(video, weMuted);
        weMuted = false;
      }
      lastAdShowing = adState.adShowing;
    }
    // 3) 終端ループ
    const video = getVideo();
    if (video && video.ended) {
      const atEnd = !document.querySelector(selectors.nextButton.css);
      if (decideEndAction({ atPlaylistEnd: atEnd, loopEnabled: settings.loop }) === 'restart-playlist') {
        restarting = true;
        if (pollTimer) clearInterval(pollTimer); // 多重 restart 防止
        if (observer) observer.disconnect();
        restartPlaylist(location);
      }
    }
  } catch (e) {
    console.debug('[yt-ext] tick error', e);
  }
}

function scheduleTick() {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => { rafQueued = false; tick(); });
}

async function init() {
  const sel = await getSelectors();
  const set = await getSettings();
  // ここから同期セクション（await を挟まない）
  selectors = sel;
  settings = set;
  restarting = false;
  lastAdShowing = false; // 曲遷移で広告状態をリセット
  weMuted = false;
  if (pollTimer) clearInterval(pollTimer);
  if (observer) observer.disconnect();        // 前回 observer を破棄（リーク防止）
  pollTimer = setInterval(tick, 500);
  observer = new MutationObserver(scheduleTick); // 変異は rAF に集約
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// YouTube は SPA。曲遷移ごとに再初期化
document.addEventListener('yt-navigate-finish', () => { init(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'next': clickNext(document, selectors); break;
        case 'prev': clickPrev(document, selectors); break;
        case 'setLoop': settings.loop = msg.value; break;
        case 'setAutoSkip':
          settings.autoSkip = msg.value;
          if (!msg.value) { // OFF にしたら自分のミュートを解除し状態リセット
            unmuteIfNeeded(getVideo(), weMuted);
            weMuted = false;
            lastAdShowing = false;
          }
          break;
        case 'reloadSettings': settings = await getSettings(); break;
      }
      sendResponse({ ok: true });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true; // async response
});

init();
```

- [ ] **Step 2: ビルドが通ることを確認（Task 10 のビルドスクリプト前なら手動 esbuild）**

Run: `npx esbuild extension/content/content.js --bundle --format=iife --outfile=/tmp/content.check.js`
Expected: エラーなくバンドルできる（import 解決確認）

- [ ] **Step 3: Commit**

```bash
git add extension/content/content.js
git commit -m "feat: add content orchestrator (observer disconnect, strict weMuted, loop guard)"
```

### Task 9: background.js（service worker）

**Files:**
- Create: `extension/background.js`

- [ ] **Step 1: service worker を実装**

責務: ①`chrome.alarms` で毎日リモート `selectors.json` を fetch し検証して `chrome.storage.local.selectorsCache` を更新（失敗時は何もしない＝既存キャッシュ維持） ②起動時にも一度 refresh ③popup の「開始」メッセージで保存 URL のタブを開く（または既存タブにフォーカス）。

> **重要（MV3）**: `isValidSelectors` は **`validators.js`（JSON import を持たない）から import** する。`selectorLoader.js` は同梱 `selectors.json` を import するため、素の ESM service worker から import すると JSON モジュール解決でクラッシュする。SW は `validators.js` のみに依存させる。
>
> Phase 1 では `REMOTE_URL = ''` で `refreshSelectors` は即 return（no-op）が**正常**。リモートホスト先は設計書 §9 の未決事項で、Phase 2 着手時に確定する。

```js
// extension/background.js
import { isValidSelectors } from './content/validators.js'; // JSON import を持たない SW-safe モジュール

const ALARM = 'daily-selector-refresh';
// TODO(Phase 2 で確定): リモート selectors.json の raw URL。Phase 1 では空＝no-op が正常。
const REMOTE_URL = '';

async function refreshSelectors() {
  if (!REMOTE_URL) return; // Phase 1 は no-op
  try {
    const res = await fetch(REMOTE_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (isValidSelectors(json)) {
      await chrome.storage.local.set({ selectorsCache: json });
    }
  } catch (e) {
    console.debug('[yt-ext] selector refresh failed', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 * 24 });
  refreshSelectors();
});
chrome.runtime.onStartup.addListener(refreshSelectors);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refreshSelectors(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openPlaylist') {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
    return true; // この分岐のみ async channel を開く
  }
  return false; // 未処理メッセージは channel を開いたままにしない
});
```

- [ ] **Step 2: 構文チェック**

Run: `node --check extension/background.js`
Expected: エラーなし（注: import は `--check` では解決されないが構文は確認できる）

- [ ] **Step 3: SW スモークテスト（実機）— Chunk 3 のバグを Chunk 4 まで潜伏させない**

`npm run build`（Task 10 が未了ならここで先に build.mjs を作って実行）後、`chrome://extensions` に unpacked 読み込みし、**Service Worker のリンクをクリックして DevTools コンソールにエラーが出ていないこと**を確認（特に `validators.js` import 解決の成否＝B1 の検証）。
Expected: SW がエラーなく起動し、`Service Worker (アクティブ)` 表示

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "feat: add SW with daily refresh (validators-only import, scoped channel)"
```

---

## Chunk 4: popup・manifest・ビルド・手動検証

### Task 10: ビルドスクリプト（esbuild で content をバンドル）

**Files:**
- Create: `build.mjs`

- [ ] **Step 1: build.mjs を作成**

```js
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
```

- [ ] **Step 2: ビルド実行**

Run: `npm run build`
Expected: `built extension/dist/content.bundle.js` と表示され、ファイルが生成される

- [ ] **Step 3: Commit**

```bash
git add build.mjs
git commit -m "build: add esbuild bundling for content script"
```

### Task 11: popup（操作パネル）と manifest

**Files:**
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/manifest.json`

- [ ] **Step 1: popup.html を作成**

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { width: 240px; font-family: system-ui; padding: 12px; }
  input, button { width: 100%; margin: 4px 0; box-sizing: border-box; }
  .row { display: flex; gap: 4px; }
  .row button { width: 50%; }
  label { font-size: 13px; display: flex; align-items: center; gap: 6px; }
  #status { font-size: 12px; color: #666; margin-top: 8px; }
</style></head>
<body>
  <input id="url" placeholder="プレイリストURL" />
  <button id="save">URLを保存</button>
  <button id="start">▶ 開始</button>
  <div class="row"><button id="prev">⏮ 前へ</button><button id="next">⏭ 次へ</button></div>
  <label><input type="checkbox" id="loop"> 🔁 ループ</label>
  <label><input type="checkbox" id="autoSkip"> 自動スキップ</label>
  <button id="export">広告DOMをエクスポート</button>
  <div id="status"></div>
  <script type="module" src="popup.js"></script>
</body></html>
```

- [ ] **Step 2: popup.js を作成**

```js
// extension/popup.js
import { getSettings, setSetting } from './content/storage.js';
import { exportSnapshots } from './content/adSnapshotLogger.js';

const $ = (id) => document.getElementById(id);

async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) return chrome.tabs.sendMessage(tab.id, msg);
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
  chrome.runtime.sendMessage({ type: 'openPlaylist', url: s.playlistUrl });
};
$('next').onclick = () => sendToActiveTab({ type: 'next' });
$('prev').onclick = () => sendToActiveTab({ type: 'prev' });
$('loop').onchange = async (e) => { await setSetting('loop', e.target.checked); sendToActiveTab({ type: 'setLoop', value: e.target.checked }); };
$('autoSkip').onchange = async (e) => { await setSetting('autoSkip', e.target.checked); sendToActiveTab({ type: 'setAutoSkip', value: e.target.checked }); };
$('export').onclick = async () => {
  const data = await exportSnapshots();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: 'youtube-ad-snapshots.json', saveAs: false });
  $('status').textContent = `${data.length} 件エクスポート`;
};

load();
```

- [ ] **Step 3: manifest.json を作成**

```json
{
  "manifest_version": 3,
  "name": "YT Playlist Adfree Player",
  "version": "0.1.0",
  "description": "YouTube ネイティブプレイリストを広告/ダイアログ回避しつつ連続再生する自分用拡張",
  "permissions": ["storage", "tabs", "alarms", "downloads"],
  "host_permissions": ["*://*.youtube.com/*", "https://raw.githubusercontent.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["dist/content.bundle.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: ビルドして読み込み確認**

Run: `npm run build`
その後 Chrome の `chrome://extensions` で「デベロッパーモード」ON →「パッケージ化されていない拡張機能を読み込む」で `extension/` を選択。
Expected: エラーなく読み込まれ、popup が開く

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js extension/manifest.json
git commit -m "feat: add popup control panel and MV3 manifest"
```

### Task 12: 実 DOM 調査でセレクタ確定

**Files:**
- Modify: `extension/selectors.json`

- [ ] **Step 1: 実 YouTube でダイアログ系セレクタを確認**

YouTube のプレイリスト再生中に、DevTools で次の要素の実セレクタを確認し記録する:
- 「まだ視聴していますか？」ダイアログのコンテナと確定ボタン
- 「広告ブロッカー検出」ダイアログのコンテナと閉じる/無視ボタン
- スキップボタン（`.ytp-ad-skip-button` 系の最新クラス）
- 次へ/前へボタン

- [ ] **Step 2: selectors.json の暫定値を実測値に更新し version を上げる**

`stillWatchingDialog` / `stillWatchingConfirm` / `adblockDialog` / `adblockDialogClose` を実測セレクタに置換。`version` を `2026-05-29.1` 等へ更新。

- [ ] **Step 3: 再ビルドして手動確認**

Run: `npm run build`
Expected: 更新セレクタでダイアログが実際に閉じる

- [ ] **Step 4: Commit**

```bash
git add extension/selectors.json
git commit -m "fix: confirm real YouTube selectors via DOM inspection"
```

### Task 13: 早送り実効性 PoC ＆ 手動受け入れ確認

**Files:**
- Modify: `extension/content/adSkipper.js`（PoC 結果次第）

- [ ] **Step 1: 早送りの実効性を確認**

スキップ不可広告中に `applyAdAction('mute-and-wait', ...)` の `video.currentTime = video.duration` が効くかを実機確認。効かない場合は当該行を削除し「ミュート待機」を確定主動作とする（設計書 §4.2 / §9）。

- [ ] **Step 2: 受け入れチェックリストを手動実行**

- [ ] プレイリストURLを保存し「▶ 開始」で再生が始まる
- [ ] スキップ可能広告が自動でスキップされる
- [ ] スキップ不可広告が無音になる（早送りが効けば短縮も）
- [ ] 「まだ視聴していますか？」が自動で閉じる
- [ ] 次へ/前へボタンが動作する
- [ ] プレイリスト終端でループ ON なら先頭へ戻る（**1回だけ**遷移し、無限リロードしない）
- [ ] 「広告DOMをエクスポート」で JSON がダウンロードされる
- [ ] エクスポートした JSON の中身が広告プレイヤーのサブツリー HTML になっている（空/全ページでない・サイズが MAX_CHARS_EACH 以内）
- [ ] 自動スキップ OFF で広告処理が止まる
- [ ] **広告中に自動スキップを OFF にすると、拡張がかけたミュートが解除される**（ユーザー操作不能の無音が残らない）
- [ ] 自分で手動ミュートした状態で広告→広告終了しても、手動ミュートが勝手に解除されない
- [ ] 「▶ 開始」を連打しても破綻しない（タブが大量に開くのみ。Phase 1 では許容）
- [ ] 10曲以上を連続再生しても CPU 使用が増え続けない（observer リークが無いこと。DevTools の Performance/タスクマネージャで確認）

- [ ] **Step 3: PoC 結果を反映していれば Commit**

```bash
git add extension/content/adSkipper.js
git commit -m "fix: finalize ad fallback based on fast-forward PoC"
```

- [ ] **Step 4: 全テスト最終確認**

Run: `npx vitest run`
Expected: PASS（全件）

---

## 完了の定義（Phase 1）

- `npx vitest run` が全緑（純粋ロジックの単体テスト）
- `npm run build` で content バンドルが生成される
- Chrome に unpacked 読み込みでき、Task 13 の受け入れチェックリストが全て通る
- セレクタ更新が `selectors.json` 1ファイルの差し替えで完結する

Phase 2（毎朝の保守 Hook）は、この成果物の `selectors.json` 契約と広告DOMエクスポート（`youtube-ad-snapshots.json`）を入力として、別計画で構築する。

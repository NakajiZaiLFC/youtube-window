# YouTube プレイリスト連続再生＋広告自動回避 拡張機能 — 設計書

- **日付**: 2026-05-29
- **ステータス**: 承認済み（実装計画フェーズへ）
- **対象**: 自分用 Chrome 拡張（Brave でも動作）＋ 毎朝の自動保守 Hook

---

## 1. 目的とスコープ

自分があらかじめ作成しておいた **YouTube のネイティブプレイリスト1つ** を上から順に、
**広告なし・確認ダイアログなし・止まらず**連続再生する自分用ツールを作る。

加えて、YouTube の DOM 変更（いたちごっこ）に対し、**毎朝1回 Claude が自動でセレクタを点検・修復する保守 Hook** を備える。

### やること
1. 広告自動回避（スキップボタン即クリック／スキップ不可は無音で末尾へ早送り）
2. 確認ダイアログ自動回避（「まだ視聴していますか？」「広告ブロッカー検出」等を自動で閉じる）
3. プレイリスト制御（保存したプレイリストを開いて再生・次/前・終端ループ）
4. 毎朝の自動保守（セレクタの破損検出 → Claude による修復 → 検証ゲート → 自動更新 or 通知）

### やらないこと（YAGNI）
- YouTube 以外のサービス対応（対象は YouTube ネイティブプレイリスト1つのみ）
- 複数プレイリストの管理機能（プリセットは原則1つ。必要になったら別途）
- Chrome Web Store への公開（広告スキップ系は審査を通らない前提。**開発者モードで unpacked 読み込み**の自分用ツール）
- ネットワークレベルの広告ブロック（DOM 自動スキップ方式を採用。理由は §3）

### 前提・既知の制約（正直な現実）
- YouTube の広告回避は本質的に「いたちごっこ」。どの方式でも YouTube 改変時にセレクタ更新が必要になる。本設計は**その更新を自動化することで運用負担を下げる**もので、「永久に無保守で動く」ものではない。
- これは uBlock Origin と同種の**個人利用の広告ブロック**の範囲。YouTube 規約は広告ブロックを推奨していない。個人利用前提。
- 新規 Chrome 拡張は **Manifest V3** 必須。

---

## 2. 全体アーキテクチャ

2つのサブシステムが、契約ファイル `selectors.json` を介して疎結合に連携する。

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ Subsystem 1: Chrome 拡張   │        │ Subsystem 2: 保守 Hook     │
│ (ランタイム)               │        │ (Mac 毎朝 cron + Claude)   │
│                          │        │                          │
│  広告スキップ / ダイアログ   │  fetch │  検出 → 修復 → 検証 → 適用  │
│  回避 / プレイリスト制御 /   │◀───────│                          │
│  操作パネル                │ 毎日   │  commit & push           │
│                          │        │         │                │
│  adSnapshotLogger ────────┼────────┼────────▶ 実広告DOMを提供   │
└──────────────────────────┘  記録   └──────────────────────────┘
              │                                  │
              └──────────► selectors.json ◀──────┘
                       (GitHub でホスト・契約)
```

- **配信チャネル**: `selectors.json` を GitHub リポジトリ（または gist）でホスト。
- **拡張**は起動時＋毎日 `chrome.alarms` で raw URL を fetch → `chrome.storage` にキャッシュ → 取得失敗時は**同梱のデフォルト** `selectors.json` にフォールバック。
- **保守ジョブ**は `selectors.json` を書き換えて commit&push するだけ。→ 拡張の**再インストール・再読み込み不要**で更新が反映される。

---

## 3. 広告回避方式の決定（採用：DOM 自動スキップ）

| 方式 | 内容 | 採否 |
|------|------|------|
| **A. DOM 自動スキップ** | プレイヤー監視→スキップボタン即クリック／不可なら無音早送り | **採用** |
| B. ネットワークブロック | 広告リクエストを DNR で遮断 | 不採用（YouTube が広告レスポンス欠落を検出し再生停止。MV3 の DNR は制約多く脆い） |
| C. 外部ツール任せ | uBlock/Premium に任せ拡張は制御のみ | 不採用（「自己完結で広告なし」要件に反する） |

A を採用する理由: 自己完結で広告回避でき、YouTube の広告ブロック検出に最も引っかかりにくく、確認ダイアログ回避・プレイリスト制御と一体で実装できる。

---

## 4. Subsystem 1: Chrome 拡張

### 4.1 コンポーネント構成
```
manifest.json            MV3。host: *://*.youtube.com/*、permissions: storage, tabs, alarms, scripting
selectors.json           同梱デフォルト（契約ファイルのフォールバック）
popup.html / popup.js    操作パネル UI
background.js            サービスワーカー（タブ起動・メッセージ中継・alarms・設定永続化）
content/
  ├─ selectors.js        ※ selectorLoader 経由で取得した現行セレクタを保持・提供
  ├─ selectorLoader.js   毎日リモート selectors.json を fetch＋キャッシュ＋同梱フォールバック
  ├─ adSkipper.js        広告検出＆スキップのみ
  ├─ promptDismisser.js  確認ダイアログ処理のみ
  ├─ playlistController.js 開始/次/前/ループのみ
  ├─ adSnapshotLogger.js 広告検出時に実広告 DOM をスナップショット保存
  ├─ storage.js          設定の get/set ラッパ
  └─ content.js          上記を束ねる司令塔＋popup からのメッセージ処理
```
**設計原則**: 各モジュールは単一責務。DOM 依存部分は薄く保ち、判断ロジックは純粋関数化してテスト可能にする。すべてのセレクタは外部 `selectors.json` に集約し、コードにハードコードしない。

### 4.2 各モジュールの責務・インターフェース

- **selectorLoader.js**
  - 何をする: リモート `selectors.json` を起動時＋毎日 fetch、`chrome.storage` にキャッシュ、失敗時は同梱デフォルトを返す。
  - I/F: `getSelectors(): Promise<Selectors>` / `refresh(): Promise<void>`
  - 依存: `chrome.storage`, `fetch`, 同梱 `selectors.json`

- **adSkipper.js**
  - 何をする: プレイヤー状態から広告かを判定し、スキップ動作を決める純粋関数＋DOM 適用。
  - 判断（純粋関数）: `decideAdAction(state) -> 'click-skip' | 'fast-forward' | 'mute-only' | 'none'`
  - フォールバック階層: スキップボタン有→クリック / 広告中だがボタン無→`currentTime=duration` で早送り＋ミュート / それも無理→最低限ミュート
  - 依存: `selectors`（ad-showing, skip-button）, video 要素

- **promptDismisser.js**
  - 何をする: 「まだ視聴していますか？」「広告ブロッカー検出」等のダイアログを検出し対応ボタンをクリック。
  - I/F: `dismissIfPresent(): void`
  - 依存: `selectors`（dialog, confirm-button）

- **playlistController.js**
  - 何をする: 開始（保存URLへ遷移・自動再生）、次/前（`.ytp-next-button` 等）、終端ループ（先頭曲へ戻す）。
  - I/F: `start()` / `next()` / `prev()` / `setLoop(bool)` / `onVideoEnded()`
  - 依存: `selectors`（next/prev button, playlist 状態）, `chrome.tabs`

- **adSnapshotLogger.js**
  - 何をする: 広告検出時に関連 DOM 断片をスナップショットし保存（保守ジョブの検証材料）。重複・サイズを抑制（直近 N 件、要素サブツリーのみ）。
  - I/F: `captureAdDom(node): void`
  - 保存先: `chrome.storage.local`（保守ジョブが読める形式でエクスポート可能に）

- **content.js（司令塔）**
  - SPA 対策: `yt-navigate-finish` で曲ごとに再初期化。
  - 監視: **MutationObserver ＋ 500ms ポーリングの二重監視**（取りこぼし防止）。
  - 各ハンドラを try/catch で包み、失敗してもループは止めない（デバッグログのみ）。
  - popup からのメッセージ（next/prev/loop/enable）を受けて該当モジュールを呼ぶ。

### 4.3 操作パネル（popup）
- プレイリスト URL 入力＋保存（`chrome.storage`）
- ▶ 開始 / ⏭ 次へ / ⏮ 前へ
- 🔁 ループ ON/OFF（終端で先頭へ戻す）
- 自動スキップ ON/OFF
- 状態表示（再生中/広告スキップ中/セレクタ最終更新日 等）

### 4.4 データフロー
1. popup で URL 入力 → `chrome.storage` 保存
2. ▶ 開始 → background が保存 URL のタブを開く（自動再生）→ content.js ロード → 設定＋セレクタ取得 → 二重監視開始
3. content.js 常時: プレイヤー監視 → 広告/ダイアログ処理 → 流し続ける／広告検出時は adSnapshotLogger が DOM 記録
4. popup 操作 → メッセージ → content.js が該当動作

---

## 5. Subsystem 2: 自動保守 Hook（Mac 毎朝 cron + Claude）

### 5.1 構成
```
maintenance/
  ├─ run-maintenance.sh   cron から起動するオーケストレータ
  ├─ capture.mjs          Playwright ヘッドレスで YouTube を開き関連 DOM をスナップショット
  ├─ healthcheck.mjs      現行 selectors を DOM に当て pass/fail レポート（＝変化の検出）
  ├─ repair.mjs           失敗分の DOM 断片を Claude に渡し新セレクタ案を取得
  ├─ validate.mjs         新セレクタを検証（DOM マッチ＋可能なら実クリック動作確認）★ゲート
  ├─ apply.mjs            通れば selectors.json 更新→commit&push／ダメなら通知＋承認待ち
  └─ fixtures/            キャプチャ DOM ＋ 拡張が記録した広告 DOM
```

### 5.2 毎朝フロー
1. **Capture** — Playwright で YouTube を開き DOM 取得（ログイン状態は永続プロファイルで維持）。広告系は拡張が記録した実広告 DOM（`adSnapshotLogger` の出力）を使用。
2. **Detect** — 現行セレクタを当ててヘルスチェック。各セレクタは「≥1 要素にマッチ」「期待する role/text を持つ」等のアサーションを持つ。**全 pass なら即終了（Claude を呼ばない＝無料）**。
3. **Repair** — 壊れたセレクタだけ、その用途＋DOM 断片を Claude（Claude Code ヘッドレス `claude -p` または API）に渡し、新セレクタ案を取得。
4. **Validate（ゲート）** — 新案が「意図した要素だけにマッチ」かつ、可能なら実動作（次へボタンで曲が進む等）を確認。
5. **Apply** — 通れば `selectors.json` をバージョン更新・commit&push＋Obsidian にログ。**通らなければ自動適用せず** macOS 通知＋Claude の修正案を提示し、ワンクリック適用スクリプトで手動承認。

### 5.3 selectors.json スキーマ（契約）
```json
{
  "version": "2026-05-29.1",
  "updatedAt": "2026-05-29T07:00:00+09:00",
  "selectors": {
    "adShowing":   { "css": ".ad-showing",            "assert": "exists-during-ad" },
    "skipButton":  { "css": ".ytp-ad-skip-button",    "assert": "clickable-button" },
    "nextButton":  { "css": ".ytp-next-button",        "assert": "advances-video" },
    "prevButton":  { "css": ".ytp-prev-button",        "assert": "exists" },
    "stillWatchingDialog": { "css": "yt-confirm-dialog-renderer", "assert": "dialog" },
    "stillWatchingConfirm": { "css": "...confirm button...",      "assert": "clickable-button" },
    "adblockDialog": { "css": "tp-yt-paper-dialog...", "assert": "dialog" }
  }
}
```
各エントリは `css`（セレクタ）と `assert`（検証時の期待）を持つ。`assert` が healthcheck/validate の判定基準になる。

---

## 6. エラー処理・堅牢性

- **拡張**: 二重監視で取りこぼし防止／SPA 再初期化／全ハンドラ try/catch／フォールバック階層（クリック→早送り→ミュート）／セレクタ取得失敗時は同梱デフォルト。
- **保守 Hook**: 検証ゲートにより「黙って壊れる」ことはなく、直せなければ必ず通知で止まる／Detect で全 pass なら Claude 非呼び出しでコスト抑制／Playwright が bot 検出に当たった場合は永続プロファイル／保存セッションで緩和し、取得失敗時はその旨を通知。

## 7. テスト方針

- **拡張**: 判断ロジック（`decideAdAction` 等）を純粋関数化し、jsdom＋保存 HTML フィクスチャで単体テスト。DOM 適用部は薄く保つ。ライブ YouTube 用の手動確認チェックリストを別途用意。
- **保守 Hook**: healthcheck / validate を、保存済み DOM フィクスチャ（正常版・破損版）に対する単体テストで検証。repair（Claude 呼び出し）はモックで I/O 形状をテスト。
- `selectors.json` の各セレクタは出所・用途をコメント/メタで記録。

## 8. 段階構築

依存関係上、以下の順がスムーズ:

- **Phase 1: 拡張本体**（selectorLoader・adSnapshotLogger 込み）。これだけで、手動セレクタ更新で完結して動作する。
- **Phase 2: 保守 Hook**（capture→detect→repair→validate→apply）。Phase 1 の selectors.json 契約と adSnapshotLogger の出力に依存。

各 Phase は独立して spec → plan → 実装サイクルを回せる。

## 9. 未決事項 / フォローアップ

- `selectors.json` のホスト先（既存 GitHub リポジトリに同居か、専用リポジトリか）。
- Playwright のログインセッション運用（保存プロファイルの置き場所・認証情報の扱い）。
- 終端ループのプレイリスト先頭復帰の具体手段（URL `index=1` 再遷移 か プレイヤー操作か）。
- Claude 呼び出しの実体（Claude Code ヘッドレス `claude -p` か Anthropic API か）。

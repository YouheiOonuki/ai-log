# AI 会話ログ Markdown 変換

公開 URL: **https://yorozu-craft.com/ai-log/**（英語版 https://yorozu-craft.com/ai-log/en/ ）

ChatGPT・Claude の書き出し（zip・conversations.json）を、ブラウザの中で会話ごとの Markdown（frontmatter つき）に分ける。Obsidian の保管庫にそのまま入れられる。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。企画書は yorozu-plans の `docs/47_AI会話ログ.md`（K80）。

非公式のツールです。OpenAI・Anthropic とは関係ありません。

## 機能

- 入力: ChatGPT・Claude の書き出しの `.zip`（複数可・両方まとめて可）か、中の `conversations.json`。ドロップも可。「見本（架空の会話）で試す」
- zip は末尾の目次だけ読み、`conversations.json`（と分かれた `conversations-000.json` など）だけを展開しながら読む。画像・`user.json` などは読まない
- 大きな書き出し: JSON 全体を 1 本の文字列にせず、配列の要素（会話）ごとに切り出して読む（`calc.js` の `ArraySplitter`）。読み込みは Web Worker（`worker.js`）の中。Worker が作れないとき（`file://` で開いたときなど）は画面の中で同じ `engine.js` を動かす
- 出力: 会話ごとの Markdown の zip（無圧縮。65,535 件を超えたら ZIP64 の目次）、または全部を 1 つにまとめた Markdown
  - frontmatter: `title`・`source`（ChatGPT / Claude）・`id`・`created`・`updated`（端末のタイムゾーンの時刻＋時差）・`model`（あれば）・`messages`（発言の数）
  - 発言は `## ユーザー（日時）` の見出しか、Obsidian のコールアウト（`> [!question]`・`> [!note]`）。コードブロックは中身の ``` より長い囲みで残す
  - 画像・添付は名前だけ（`- 添付: \`report.pdf\``）。Claude の添付の抜き出し文（extracted_content）は入れない
  - ファイル名は「作った日 題名.md」。Windows で使えない `< > : " / \ | ? *`・制御文字、Obsidian のリンクを壊す `# ^ [ ]` は `_`。先頭の `.` と末尾の `.`・空白を取る。予約名（CON など）は後ろに `_`。題名は 60 文字・150 バイトまで。大文字小文字だけ違う名前は「 (2)」。フォルダは なし／年／年と月、出どころ別も選べる
- 絞り込み: 題名の言葉（全角半角・大小を区別しない）、作った日の期間、出どころ。一覧（新しい順に 100 件）で題名を押すと Markdown の見本
- 読めない所は落ちずに「ファイル名・何行目・何番目の会話・理由」を画面に出し、ほかは読み続ける
- **何も保存しない**（ファイルも設定も localStorage に書かない。会話は人に見せたくない中身なので端末に残さない）。そのため K123 の「消して戻す」ボタンは要らない。外へ送る道具（fetch・XMLHttpRequest・sendBeacon）を使わない（`tests/pages.test.js` で確かめる）

## 読む形式

OpenAI・Anthropic は書き出しの中身の仕様を公開していない（見つけられなかった）。手順は公式ヘルプ、形式は公開の変換器（MIT）の試料とコードで確かめた。出典と確認日は `constants.js` の `SOURCES`（`CHECKED = '2026-10-01'`）で、使い方ページの「確かめた先」にも出る。

| 出どころ | 読み方 | 確かめた先 |
|---|---|---|
| ChatGPT | 会話の配列（`{"conversations": [...]}` の形も読む）。`mapping` は発言の木で、`current_node` から `parent` をたどって根まで戻り、逆順にする（編集・再生成の古い枝は入れず、件数だけ注意に出す）。`current_node` が無ければ根から最後の子をたどる。時刻は epoch 秒。入れないもの: `system`、`metadata.is_visually_hidden_from_conversation`、`thoughts`・`reasoning_recap`・`tether_*`・`sonic_webpage`・`system_error`・`*_editable_context`、`recipient` が `all` でない assistant の発言（`code` は除く）、`execution_output`・`multimodal_text` 以外の `tool`。`code` と `execution_output` はコードブロック。`image_asset_pointer` の `asset_pointer`（`sediment://` などを外す）と `metadata.attachments[].name` は名前だけ。モデルは `model_slug`（会話）か最後の答えの `metadata.model_slug`、無ければ `default_model_slug` | mohamed-chs/convoviz `docs/dev/chatgpt-spec.md`（3 章の Golden Path、4 章の content_type、7 章の隠す発言）・`tests/conftest.py`・`convoviz/io/loaders.py`（分かれた形）、sugurutakahashi-1234/ai-chat-md-export `examples/chatgpt` |
| Claude | 会話の配列。`uuid`・`name`・`created_at`・`updated_at`・`chat_messages`。`sender` が `human` なら ユーザー。本文は `content` の `text` ブロック（`thinking`・`tool_result` は入れず、`tool_use` は名前だけ）、無ければ `text`（ツールの所に入る決まり文句 "This block is not supported on your current device yet." を消す）。`attachments[].file_name`・`files[].file_name` は名前だけ。枝は `current_leaf_message_uuid` から `parent_message_uuid` をたどる。無ければいちばん深い枝（同じ深さなら新しいほう、根が複数なら古い順につなぐ）、親の情報が無ければ `created_at` の順 | sugurutakahashi-1234/ai-chat-md-export `examples/claude`・`src/infrastructure/parsers/claude/schema.ts`、davidteren/claude_desktop_export_browser `test_current_branch.py`・`test_message_text.py`・`claude_chat_browser.py` |

## 試料とライセンス

本物の会話は 1 つも入れていない（ROADMAP 7.9.4。会話の全文は区分 1）。オーナーの試料（2 会話に切り詰めたもの）が届いたら、`tests/fixtures/owner/` に足して追加の検査に使う。

| 場所 | 中身 | 出どころとライセンス |
|---|---|---|
| `tests/fixtures/ai-chat-md-export/chatgpt-conversations.json`・`claude-conversations.json` | 架空の 2 会話ずつ（数学・コード・天気・料理）。そのまま写した | [sugurutakahashi-1234/ai-chat-md-export](https://github.com/sugurutakahashi-1234/ai-chat-md-export) の `examples/chatgpt/conversations.json`・`examples/claude/conversations.json`、コミット `e681a7e8d8658cdba03eb30924b2b71135f710c3`（2025-11-16）。**MIT License**、Copyright (c) 2025 Suguru Takahashi。全文は同じフォルダの `LICENSE` |
| `tests/fixtures/synthetic/*.json` | 手で作った架空の試料（枝分かれ・システム・考え・コード実行・画像・添付・知らない形・使えない文字の題名・分かれた形・壊れた JSON）。`make.cjs` で作り直せる | このリポジトリ（MIT）。形は次の資料に合わせた（コードもデータも写していない）: [mohamed-chs/convoviz](https://github.com/mohamed-chs/convoviz)（MIT、コミット `6c22e7398bdceb16c34c974512fc460f7bf642c6`、2026-09-13）の `docs/dev/chatgpt-spec.md`・`tests/conftest.py`、[davidteren/claude_desktop_export_browser](https://github.com/davidteren/claude_desktop_export_browser)（README に MIT とあるが LICENSE ファイルは無い。コミット `0191eaa6d8845b42f485f554e6de0f43845e3a3a`、2026-07-12）のテスト、ai-chat-md-export の `schema.ts` |
| `zip.js` | zip の読み書き | fitbit-export の `zip.js`（同じ作者・MIT）を写し、`readStream`（展開しながら読む）・`bytes`・ZIP64 の目次（65,535 件超）を足した |

## 開いた問い

1. 新しい書き出しの形（2026 年）: ChatGPT の `conversations-000.json` に分かれる条件、`{"conversations": [...]}` の形が今もあるか（convoviz のコードと資料だけで、実物は未確認）
2. ChatGPT の新しい content_type（`sonic_webpage` など）と Canvas（`canmore`。`textdocs/`）は入れていない。Canvas の文書を本文に入れるかは実物を見て決める
3. Claude の会話ごとのモデル名（`model` の欄があるか）。今は欄があれば読む。無ければ frontmatter に `model` を書かない
4. Claude の `current_leaf_message_uuid`・`parent_message_uuid`・`files_v2`・添付の欄名（`file_name`・`extracted_content`）は公開のコードと解説記事だけで確かめた
5. ChatGPT の書き出しの手順（設定 → データコントロール）とリンクの期限（24 時間）は、OpenAI のヘルプのページがこの環境から開けず（403）、検索結果の抜粋と公開の変換器の説明で確かめた
6. Claude Code の `.jsonl`（ObsidianClaudeLog の対象）は最初の版では扱わない（ROADMAP 7.9.4）

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 半年ごと・問い合わせのとき | 書き出しの形が変わっていないか（読めなかった所・知らない形の注意が出ていないか）。convoviz・ai-chat-md-export の更新 | `calc.js` の `GPT_HIDDEN`・`GPT_KNOWN`・`CLAUDE_KNOWN`・`fromChatGPT`・`fromClaude`、`constants.js`（`CHECKED`）、使い方の更新履歴 |
| 確認日から 12 か月まで | 公式ヘルプの手順 | `guide.html`・`en/guide.html`、`constants.js` |
| オーナーの試料が届いたとき | 試料で読み、開いた問い 1〜4 を確かめる | `tests/fixtures/owner/`、テスト |

形式や読み方を直したら、`guide.html`（と英語版）の「更新履歴」に日付と内容を 1 行足す。

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` / `en/index.html` | ツール本体（日本語 / 英語。同じ id・同じ main.js） |
| `guide.html` / `en/guide.html` | 使い方・書き出し方・Markdown の中身・よくある質問・ご利用上の注意・更新履歴 |
| `calc.js` | 形式の読み方・Markdown・ファイル名・絞り込み・大きな JSON の切り出し（純粋関数） |
| `engine.js` | 読み込みと書き出しの本体（Worker でも画面でも動く） |
| `worker.js` | Web Worker（engine.js を読み込むだけ） |
| `zip.js` | zip の読み書き（依存なし） |
| `text.js` | 画面の文（日本語・英語） |
| `constants.js` | 手順と形式の出典・確認日 |
| `main.js` | 画面の制御 |
| `screen.js` | 画面の部品（`details` の `summary` の状態表示） |
| `style.css` | 見た目（和紙風の配色、ダークモード対応） |
| `sw.js` / `manifest.webmanifest` | オフライン対応 |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（日英 4 URL。robots.txt はドメイン直下で管理） |
| `tests/*.test.js` | テスト（`node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに自動実行） |

## ライセンス

MIT License（`LICENSE`）。`tests/fixtures/ai-chat-md-export/` は上の表のとおり ai-chat-md-export の MIT License。

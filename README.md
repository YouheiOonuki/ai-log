# __TITLE__

公開 URL: **https://yorozu-craft.com/__REPO__/**

__DESCRIPTION__
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。

<!-- TEMPLATE-BEGIN -->
## テンプレートの使い方（`tools/init.mjs` を実行すると、この節は消えます）

yorozu-craft の新しいツールの雛形です。サイト共通の決まり（youheioonuki.github.io の README「ツールを追加するとき」）のうち、ファイルで守れるものは最初から入れてあります。

1. GitHub で「Use this template」→ リポジトリ名は短いローマ字＋種類（例: `loan-sim`）。URL になる
2. クローンして、初期化スクリプトを 1 回だけ実行する（Node 20 以上）

   ```sh
   node tools/init.mjs loan-sim "住宅ローン 返済シミュレーター" "毎月の返済額と総返済額をすぐ計算。" --pwa
   ```

   - `__REPO__`・`__TITLE__`・`__DESCRIPTION__`・日付を置き換える
   - `--pwa` を付けないと、オフライン対応の部分（`sw.js`・`manifest.webmanifest`・`PWA-BEGIN`〜`PWA-END`）を消す
   - README のこの節と `tools/init.mjs` 自身を消す
3. `node --test tests/*.test.js` が通ることを確かめてからコミット
4. 残りは youheioonuki.github.io の README「ツールを追加するとき」の手順どおり（Pages の公開と Enforce HTTPS、トップの一覧・robots.txt・URL 表への追加など）

最初から入っているもの:

| 決まり | 入っている場所 |
|-------|---------------|
| canonical・OGP・AdSense・Cloudflare ビーコン | `index.html`・`guide.html` の `<head>` と `</body>` 直前 |
| 共通ページへの相対リンク（`../about.html`・`../privacy-policy.html`） | 各ページのフッター |
| ツール配下の 404 | `404.html`（youheioonuki.github.io のものと同じ） |
| 保存キーの接頭辞 `<リポジトリ名>_`・try/catch | `main.js` の `store` |
| 共有 URL は `#s=` | `main.js` の `toShareHash` / `fromShareHash` |
| 保存内容を JSON ファイルに書き出し・読み込み（`{tool, version, exportedAt, data}`。読み込み時は `tool` を確かめ、正規化してから確認のうえ上書き） | `calc.js` の `backupFileName` / `buildBackup` / `parseBackup`、`main.js` の書き出し・読み込み、`index.html` のボタン、`tests/backup.test.js` |
| SW のキャッシュ名の接頭辞・自分のパスだけ扱う・`./sw.js` で登録 | `sw.js`・`main.js` |
| manifest の `id` は `/<リポジトリ名>/` | `manifest.webmanifest` |
| 使い方ページは `guide.html`（注意・データの扱い・根拠と確認日・更新履歴の節つき） | `guide.html` |
| 要望・不具合の報告フォーム（全ツール共通の Google フォーム。リポジトリ名が入った状態で開く） | `guide.html` の「ご利用上の注意・データの扱い」 |
| 時点のある値は値・出典・確認日をセットで 1 か所に | `constants.js`（テストで出典と確認日の書き忘れを検出） |
| 計算は画面から切り離した純粋関数＋テスト | `calc.js`・`tests/`・`.github/workflows/test.yml` |
| 端末のフォント・ダークモード | `style.css` |
| 画面の骨組み「入力 → 結果」（必須の入力 1 つの `fieldset` → 結果 → くわしく入れる `details` → 保存・書き出し → 使い方へのリンク） | `index.html`（各節にコメント） |
| 上端の固定バー・`summary` の状態表示・PC の 2 カラム・印刷で広告と固定バーを消す | `screen.js`・`style.css` の「画面の骨組み」・`main.js` の `bar` |
| MIT ライセンス | `LICENSE` |

画面の部品の使い方（yorozu-plans の `docs/SCREEN.md`。youheioonuki.github.io の README「ツールを追加するとき」25）:

- **必須の入力と結果**: `index.html` の `fieldset.card.req`（見出しは `legend`）の直後に `section.result-card`。大きな数字は `.result-big`、内訳は `details.rels`。入力と結果の間に段落や見出しを置かない
- **くわしく入れる**: 1 グループ 1 つの `<details class="card opt" id="opt-…">`。`summary` の中に `<span class="opt-state">` を置き、計算のたびに `YorozuScreen.detailsSummary({ 'opt-…': '今の状態' })`。道具で任意の項目が無ければ `.opts` ごと消す
- **固定バー**: `YorozuScreen.fixedBar({ bar, watch, jump, text })` の戻り値の `set('数字 1 つ')` を計算のたびに呼ぶ（空文字なら出さない）。結果が画面内にあれば出ない。印刷物では `watch` を印刷ボタンの行にし、バーの中身を `<button>`、`onClick` で印刷を呼ぶ
- **PC の 2 カラム**（制度の計算機だけ）: `<main class="app-main layout-2col">` と、固定バーに `fixbar-narrow` を足す
- **印刷**: `style.css` の `@media print` で固定バー・`.no-print`・広告（`ins.adsbygoogle` など）を消し、折りたたみの中は出す。印刷物のツールは用紙の CSS をこの下に足す
- 公開前に yorozu-plans の `tools/ui/measure_fold.cjs`（位置）と `tools/writing/measure.py`（字数）で「要修正」が無いことを確かめる

差し替えが必要なもの: `favicon.svg`・`apple-touch-icon.png`（180×180）・`og-image.png`（1200×630）は仮の絵なので、ツールに合わせて作り直す。
<!-- TEMPLATE-END -->

## 機能

- （できることを箇条書きで）
- 入力内容はこの端末のブラウザにだけ保存し、外部には送信しない

## 計算の仕様・根拠

（計算式、使っている値と出典。値は `constants.js` にまとめ、画面の「根拠と確認日」にも出す）

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| （例: 毎年4月ごろ） | （例: 料率の改定） | `constants.js`、`guide.html` の最終確認日 |

値や計算を直したら、`guide.html` の「更新履歴」に日付と内容を 1 行足す。

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` | ツール本体 |
| `guide.html` | 使い方・根拠と確認日・よくある質問・ご利用上の注意・更新履歴 |
| `calc.js` | 計算ロジック（画面から切り離した純粋関数） |
| `constants.js` | 時点のある値（値・出典・確認日） |
| `main.js` | 画面の制御・保存・共有リンク |
| `screen.js` | 画面の部品（上端の固定バー、`details` の `summary` の状態表示） |
| `style.css` | 見た目（和紙風の配色、ダークモード対応） |
| `sw.js` / `manifest.webmanifest` | オフライン対応（使う場合のみ） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（robots.txt はドメイン直下で管理） |
| `tests/*.test.js` | テスト（`node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに自動実行） |

## ライセンス

MIT License（`LICENSE`）。

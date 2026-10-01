# AI 会話ログ Markdown 変換

公開 URL: **https://yorozu-craft.com/ai-log/**

ChatGPT・Claude の書き出しを、会話ごとの Markdown に。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。

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

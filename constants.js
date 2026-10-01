// ===========================
// 書き出しの手順と形式について「どこで確かめたか」（出典と確認日）を 1 か所に持つ
// OpenAI・Anthropic は conversations.json の中身の仕様を公開していない（見つけられなかった）。
// 手順は公式ヘルプ（kind: official）、形式は公開の変換器（MIT）の試料とコード（kind: public-code）で確かめた。
// 確かめきれていない扱いは README「開いた問い」
// en は英語のページ（en/guide.html）に出す文。確認日と出典の先は上と同じ（url が無ければ上の url）
// ブラウザでは window.Constants、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var CHECKED = '2026-10-01';   // 下の出典をこの日に見て確かめた（youheioonuki.github.io の check-site が読む）

  var SOURCES = {
    claudeHelp: {
      label: 'Claude の書き出しの手順',
      value: 'Web 版かデスクトップ版の設定 → プライバシー → データをエクスポート。リンクはメールで届き、24 時間で切れる。iOS・Android のアプリからはできない',
      source: 'Claude ヘルプセンター「Export your Claude data」',
      url: 'https://support.claude.com/en/articles/9450526-how-can-i-export-my-claude-data',
      checked: CHECKED,
      kind: 'official',
      en: { label: 'How to export from Claude', value: 'Settings > Privacy > Export data on the web app or Claude Desktop. The link arrives by email and expires after 24 hours. Not available in the iOS or Android app', source: 'Claude Help Center: Export your Claude data' },
    },
    chatgptHelp: {
      label: 'ChatGPT の書き出しの手順',
      value: '設定 → データコントロール → エクスポート。リンクはメールで届き、24 時間で切れる（ヘルプのページはこの環境から開けず、検索結果の抜粋と公開の変換器の説明で確かめた）',
      source: 'OpenAI ヘルプ「How do I export my ChatGPT history and data?」',
      url: 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data',
      checked: CHECKED,
      kind: 'official',
      en: { label: 'How to export from ChatGPT', value: 'Settings > Data controls > Export. The link arrives by email and expires after 24 hours (checked from the search snippet and public converters; the help page itself did not open from our test machine)', source: 'OpenAI Help: How do I export my ChatGPT history and data?' },
    },
    chatgptFormat: {
      label: 'ChatGPT の conversations.json',
      value: '会話の配列。mapping は発言の木で、current_node から親をたどると画面の会話になる。時刻は epoch 秒。content_type は text・multimodal_text・code・execution_output ほか。分かれた形 conversations-000.json もある',
      source: '公開の変換器: mohamed-chs/convoviz（MIT、6c22e73、2026-09-13）の docs/dev/chatgpt-spec.md と tests/conftest.py',
      url: 'https://github.com/mohamed-chs/convoviz',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: 'ChatGPT conversations.json', value: 'An array of conversations. mapping is a tree of messages; walking parents from current_node gives the chat as shown. Times are epoch seconds. content_type includes text, multimodal_text, code and execution_output. Large exports may be split into conversations-000.json and so on', source: 'Public converter: mohamed-chs/convoviz (MIT, 6c22e73, 2026-09-13), docs/dev/chatgpt-spec.md and tests/conftest.py' },
    },
    claudeFormat: {
      label: 'Claude の conversations.json',
      value: '会話の配列。uuid・name・created_at・updated_at・chat_messages（sender は human か assistant、text と content の配列、attachments・files）。やり直しは parent_message_uuid の木',
      source: '公開の変換器: sugurutakahashi-1234/ai-chat-md-export（MIT、e681a7e、2025-11-16）の試料と schema.ts、davidteren/claude_desktop_export_browser（README に MIT、0191eaa、2026-07-12）のテスト',
      url: 'https://github.com/sugurutakahashi-1234/ai-chat-md-export',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: 'Claude conversations.json', value: 'An array of conversations: uuid, name, created_at, updated_at and chat_messages (sender human or assistant, text plus a content array, attachments and files). Retries form a tree through parent_message_uuid', source: 'Public converters: sugurutakahashi-1234/ai-chat-md-export (MIT, e681a7e, 2025-11-16) samples and schema.ts; davidteren/claude_desktop_export_browser (MIT per README, 0191eaa, 2026-07-12) tests' },
    },
    browser: {
      label: 'zip の展開に使うブラウザの機能',
      value: "DecompressionStream('deflate-raw'): Chrome・Edge 103、Firefox 113、Safari 16.4 から",
      source: 'MDN browser-compat-data 8.1.4（2026-10-01）',
      url: 'https://developer.mozilla.org/docs/Web/API/DecompressionStream',
      checked: CHECKED,
      kind: 'official',
      en: { label: 'Browser feature used to unzip', value: "DecompressionStream('deflate-raw'): Chrome and Edge 103, Firefox 113, Safari 16.4 and later", source: 'MDN browser-compat-data 8.1.4 (2026-10-01)' },
    },
  };

  var api = { CHECKED: CHECKED, SOURCES: SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Constants = api;
})(this);

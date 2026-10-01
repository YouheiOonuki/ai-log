// ===========================
// 画面に出す文（main.js が <html lang> で ja か en を選ぶ）
// 日本語（index.html）と英語（en/index.html）で同じ main.js・calc.js を使い、文だけをここで分ける
// Markdown の中の言葉（「ユーザー」「添付」など）は calc.js の LABELS（Web Worker でも使うため）
// ブラウザでは window.Text、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  /** 英語の複数形（1 だけ単数） */
  function pl(n, one, many) { return n + ' ' + (String(n) === '1' ? one : many); }
  function mb(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0); }

  var TEXT = {
    ja: {
      locale: 'ja-JP',
      count: function (n) { return n + ' 件'; },
      countOf: function (n, total) { return n + ' / ' + total + ' 件'; },
      sub: function (parts, range) { return parts.join('・') + (range ? '。' + range : ''); },
      range: function (from, to) { return from === to ? from : from + '〜' + to; },
      reading: '読み込み中…',
      progress: function (done, total, count) { return '読み込み中… ' + mb(done) + ' / ' + mb(total) + ' MB（会話 ' + count + ' 件）'; },
      building: '作っています…',
      failed: function (m) { return '読み込めませんでした: ' + m; },
      noConv: '会話が見つかりませんでした。下の「一覧と注意」を見てください。',
      none: '絞り込みに当たる会話がありません。',
      built: function (n) { return n + ' 件をダウンロードしました。'; },
      untitled: '無題',
      noDate: '日付なし',
      msgs: function (n) { return n + ' 発言'; },
      more: function (n) { return 'ほか ' + n + ' 件（絞り込むと出ます）'; },
      previewOf: function (path) { return path; },
      filterState: function (f, n, total) {
        var p = [];
        if (f.source !== 'all') p.push(f.source === 'chatgpt' ? 'ChatGPT' : 'Claude');
        if (f.from || f.to) p.push((f.from || '') + '〜' + (f.to || ''));
        if (f.q) p.push('「' + f.q + '」');
        return (p.length ? p.join('・') : 'すべて') + (total ? '（' + n + ' 件）' : '');
      },
      outState: function (o) {
        return (o.style === 'callout' ? 'コールアウト' : '見出し') + '・' + ({ none: 'フォルダなし', year: '年のフォルダ', month: '年と月のフォルダ' })[o.folder] + (o.bySource ? '・出どころ別' : '');
      },
      notes: {
        tz: function (tz) { return '日時は ' + tz + ' の時刻で書きます。'; },
        files: function (n) { return '読んだ JSON は ' + n + ' 個です。'; },
        dup: function (n) { return '同じ会話が ' + n + ' 件重なっていたので、新しいほうだけ残しました。'; },
        branch: function (n) { return '編集・再生成で分かれた発言 ' + n + ' 件は入れていません（最後に見ていた枝だけ）。'; },
        atts: function (n) { return '画像・添付 ' + n + ' 件は名前だけ書きます（中身は入りません）。'; },
        unknown: function (list) { return '知らない形の発言（' + list + '）は、中の文字だけ入れました。'; },
        errors: function (n) { return '読めなかった所 ' + n + ' 件:'; },
        errorItem: function (e, msg) { return e.file + (e.line ? ' の ' + e.line + ' 行目' : '') + (e.index != null ? '（' + (e.index + 1) + ' 番目の会話）' : '') + ': ' + msg; },
        moreErrors: function (n) { return 'ほか ' + n + ' 件'; },
      },
      err: null,   // 日本語は例外の message をそのまま出す
    },

    en: {
      locale: 'en-US',
      count: function (n) { return pl(n, 'chat', 'chats'); },
      countOf: function (n, total) { return n + ' of ' + pl(total, 'chat', 'chats'); },
      sub: function (parts, range) { return parts.join(', ') + (range ? '. ' + range : ''); },
      range: function (from, to) { return from === to ? from : from + ' to ' + to; },
      reading: 'Reading…',
      progress: function (done, total, count) { return 'Reading… ' + mb(done) + ' / ' + mb(total) + ' MB (' + pl(count, 'chat', 'chats') + ')'; },
      building: 'Building…',
      failed: function (m) { return 'Could not read the files: ' + m; },
      noConv: 'No chats found. See "List and notes" below.',
      none: 'No chats match the filter.',
      built: function (n) { return 'Downloaded ' + pl(n, 'chat', 'chats') + '.'; },
      untitled: 'Untitled',
      noDate: 'No date',
      msgs: function (n) { return pl(n, 'message', 'messages'); },
      more: function (n) { return 'and ' + n + ' more (use the filter to see them)'; },
      previewOf: function (path) { return path; },
      filterState: function (f, n, total) {
        var p = [];
        if (f.source !== 'all') p.push(f.source === 'chatgpt' ? 'ChatGPT' : 'Claude');
        if (f.from || f.to) p.push((f.from || '') + ' to ' + (f.to || ''));
        if (f.q) p.push('"' + f.q + '"');
        return (p.length ? p.join(', ') : 'All') + (total ? ' (' + n + ')' : '');
      },
      outState: function (o) {
        return (o.style === 'callout' ? 'Callouts' : 'Headings') + ', ' + ({ none: 'no folders', year: 'year folders', month: 'year and month folders' })[o.folder] + (o.bySource ? ', by source' : '');
      },
      notes: {
        tz: function (tz) { return 'Times are written in ' + tz + '.'; },
        files: function (n) { return pl(n, 'JSON file was', 'JSON files were') + ' read.'; },
        dup: function (n) { return pl(n, 'chat appeared', 'chats appeared') + ' twice; only the newer copy is kept.'; },
        branch: function (n) { return pl(n, 'message', 'messages') + ' from edited or regenerated branches ' + (n === 1 ? 'is' : 'are') + ' left out (only the branch you last viewed is kept).'; },
        atts: function (n) { return pl(n, 'image or attachment is', 'images or attachments are') + ' listed by name only (the files are not included).'; },
        unknown: function (list) { return 'Messages of unknown types (' + list + ') were kept as plain text.'; },
        errors: function (n) { return pl(n, 'part', 'parts') + ' could not be read:'; },
        errorItem: function (e, msg) { return e.file + (e.line ? ', line ' + e.line : '') + (e.index != null ? ' (chat #' + (e.index + 1) + ')' : '') + ': ' + msg; },
        moreErrors: function (n) { return 'and ' + n + ' more'; },
      },
      err: {
        notJson: 'not a JSON list of chats',
        badJson: 'broken JSON',
        truncated: 'the file ends too early',
        empty: 'the file is empty',
        noMapping: 'a ChatGPT chat without "mapping"',
        noMessages: 'a Claude chat without "chat_messages"',
        unknownShape: 'not a ChatGPT or Claude chat',
        noConversations: 'no conversations.json in this zip',
        notTarget: 'choose a .zip or .json file',
        notZip: 'not a zip file',
        badIndex: 'the zip index is damaged',
        badEntry: 'the zip contents are damaged',
        encrypted: 'password-protected zips cannot be read',
        method: function (n) { return 'compression method ' + n + ' is not supported'; },
        noDecompress: 'this browser cannot unzip files. Try the latest Chrome, Edge, Firefox or Safari',
      },
    },
  };

  /** 例外（calc.js・zip.js・engine.js）を画面の言語の文に。code が無い・日本語の画面なら message のまま */
  function errorText(t, e) {
    var m = e && e.code && t.err ? t.err[e.code] : null;
    if (typeof m === 'function') return m(e.arg);
    return m || (e && e.message ? e.message : String(e));
  }

  var api = { TEXT: TEXT, errorText: errorText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Text = api;
})(this);

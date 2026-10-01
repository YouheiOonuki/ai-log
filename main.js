// ===========================
// AI 会話ログ Markdown 変換 — 画面の制御
// 読み込みと書き出しは engine.js（Web Worker の worker.js の中。Worker が使えなければこの画面の中で同じものを動かす）、
// 形式の読み方は calc.js、画面の文は text.js（<html lang="en"> なら英語）。
// ファイルはこの端末の中で読むだけで、どこにも送らない（fetch も使わない）。ファイルも設定も localStorage に保存しない（会話は人に見せたくない中身なので、端末に残さない）
// ===========================
(function () {
  'use strict';
  var C = window.Calc;
  var EN = document.documentElement.lang === 'en';
  var T = window.Text.TEXT[EN ? 'en' : 'ja'];
  function $(id) { return document.getElementById(id); }
  var el = {
    result: $('result'), sub: $('result-sub'), dlRow: $('dl-row'), detail: $('detail'), notes: $('notes'), list: $('list'),
    preview: $('preview'), previewPath: $('preview-path'),
    q: $('q'), from: $('from'), to: $('to'), source: $('source'), style: $('style'), folder: $('folder'), bySource: $('by-source'),
  };
  var TZ = 'UTC';
  try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* 古いブラウザ */ }
  var state = { list: [], errors: [], stats: null, shown: [], busy: false };
  var LIST_MAX = 100;   // 一覧に出す件数（多いときは絞り込みで探す）

  // --- 本体（Web Worker）。作れないとき（file:// で開いたときなど）は画面の中で同じものを動かす ---
  var worker = null, local = null, pending = [];
  function onMessage(m) {
    if (m.type === 'progress') { text(el.sub, T.progress(m.done, m.total, m.count)); return; }
    if (m.type === 'loaded') { loaded(m); return; }
    if (m.type === 'built') { built(m); return; }
    if (m.type === 'preview') { showPreview(m); return; }
    if (m.type === 'failed') { state.busy = false; text(el.result, '—'); text(el.sub, T.failed(window.Text.errorText(T, m))); }
  }
  function useLocal() {
    if (!local) local = window.createEngine(C, window.Zip, function (m) { setTimeout(function () { onMessage(m); }, 0); });
    worker = null;
    var q = pending; pending = [];
    q.forEach(function (m) { local.handle(m); });
  }
  try {
    worker = new Worker(EN ? '../worker.js' : './worker.js');
    worker.onmessage = function (e) { pending = []; onMessage(e.data); };
    worker.onerror = function () { useLocal(); };   // 読み込めなかったら、送りかけた依頼を画面の中でやり直す
  } catch (e) { worker = null; }
  function send(m) {
    if (worker) { pending.push(m); worker.postMessage(m); }
    else { if (!local) useLocal(); local.handle(m); }
  }

  function text(e, t) { e.textContent = t; }
  function fmt(n) { return Number(n).toLocaleString(T.locale); }
  function li(parent, t) { var x = document.createElement('li'); x.textContent = t; parent.appendChild(x); return x; }

  function filter() { return { q: el.q.value.trim(), from: el.from.value || null, to: el.to.value || null, source: el.source.value }; }
  function outOpts() { return { lang: EN ? 'en' : 'ja', tz: TZ, style: el.style.value, folder: el.folder.value, bySource: el.bySource.checked }; }
  function syncSummary() {
    YorozuScreen.detailsSummary({
      'opt-filter': T.filterState(filter(), fmt(state.shown.length), state.list.length),
      'opt-out': T.outState(outOpts()),
    });
  }

  // --- 読み込み ---
  function run(files, sample) {
    if (state.busy || !files.length) return;
    state.busy = true;
    text(el.result, T.reading); text(el.sub, '');
    el.dlRow.hidden = true; el.preview.hidden = true; text(el.previewPath, '');
    send({ type: 'load', files: files, reset: true, sample: !!sample });
  }

  function loaded(m) {
    state.busy = false;
    state.list = m.list.map(function (s) {
      s.created = s.created != null ? new Date(s.created) : null;
      s.date = s.created ? C.localDate(s.created, TZ) : null;
      return s;
    });
    state.errors = m.errors; state.stats = m.stats;
    el.detail.hidden = false;
    // 注意（時刻・重なり・枝・添付・知らない形・読めなかった所）
    el.notes.innerHTML = '';
    var N = T.notes, st = m.stats;
    if (state.list.length) li(el.notes, N.tz(TZ));
    if (st.files > 1) li(el.notes, N.files(fmt(st.files)));
    if (st.duplicates) li(el.notes, N.dup(fmt(st.duplicates)));
    if (st.otherBranch) li(el.notes, N.branch(st.otherBranch));
    if (st.attachments) li(el.notes, N.atts(st.attachments));
    var unk = Object.keys(st.unknown || {});
    if (unk.length) li(el.notes, N.unknown(unk.slice(0, 5).join(', ')));
    if (m.errors.length) {
      var head = li(el.notes, N.errors(fmt(m.errors.length))), ul = document.createElement('ul');
      m.errors.slice(0, 10).forEach(function (e) { li(ul, N.errorItem(e, window.Text.errorText(T, e))); });
      if (m.errors.length > 10) li(ul, N.moreErrors(fmt(m.errors.length - 10)));
      head.appendChild(ul);
      el.detail.open = true;   // 読めなかったことは開いて見せる
    }
    // 期間の欄の既定の範囲（入力はしない）
    var ds = state.list.map(function (s) { return s.date; }).filter(Boolean).sort();
    if (ds.length) { el.from.min = el.to.min = ds[0]; el.from.max = el.to.max = ds[ds.length - 1]; }
    refresh();
  }

  function refresh() {
    var f = filter();
    state.shown = state.list.filter(function (s) { return C.matches(s, f, TZ); });
    syncSummary();
    var total = state.list.length, n = state.shown.length;
    if (!total) {
      text(el.result, '—');
      text(el.sub, T.noConv);
      el.dlRow.hidden = true;
    } else {
      text(el.result, n === total ? T.count(fmt(total)) : T.countOf(fmt(n), fmt(total)));
      var by = { chatgpt: 0, claude: 0 }, ds = [];
      state.shown.forEach(function (s) { by[s.source]++; if (s.date) ds.push(s.date); });
      ds.sort();
      var parts = [];
      if (by.chatgpt) parts.push('ChatGPT ' + fmt(by.chatgpt));
      if (by.claude) parts.push('Claude ' + fmt(by.claude));
      text(el.sub, n ? T.sub(parts, ds.length ? T.range(ds[0], ds[ds.length - 1]) : '') : T.none);
      el.dlRow.hidden = !n;
    }
    // 一覧（新しい順に LIST_MAX 件まで。押すと中身の見本）
    el.list.innerHTML = '';
    var sorted = state.shown.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    sorted.slice(0, LIST_MAX).forEach(function (s) {
      var x = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'linkbtn conv';
      b.textContent = (s.date || T.noDate) + '  ' + (s.title || T.untitled);
      b.addEventListener('click', function () { send({ type: 'preview', id: s.n, opts: outOpts() }); });
      var meta = document.createElement('span'); meta.className = 'conv-meta';
      meta.textContent = (s.source === 'chatgpt' ? 'ChatGPT' : 'Claude') + ' · ' + T.msgs(fmt(s.count));
      x.appendChild(b); x.appendChild(meta); el.list.appendChild(x);
    });
    if (sorted.length > LIST_MAX) li(el.list, T.more(fmt(sorted.length - LIST_MAX))).className = 'small';
  }

  function showPreview(m) {
    text(el.previewPath, T.previewOf(m.path));
    text(el.preview, m.text);
    el.preview.hidden = false;
  }

  // --- ダウンロード（この端末の中でファイルを作るだけ） ---
  function stamp() { var d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function save(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function build(combined) {
    if (state.busy || !state.shown.length) return;
    state.busy = true;
    text(el.sub, T.building);
    var o = outOpts(); o.combined = combined;
    var ids = state.shown.slice().sort(function (a, b) { return (a.created || 0) - (b.created || 0); }).map(function (s) { return s.n; });   // 古い順
    send({ type: 'build', ids: ids, opts: o });
  }
  function built(m) {
    state.busy = false;
    var name = 'ai-log-' + stamp() + (m.kind === 'zip' ? '.zip' : '.md');
    save(name, new Blob([m.bytes], { type: m.kind === 'zip' ? 'application/zip' : 'text/markdown' }));
    refresh();
    text(el.sub, T.built(fmt(m.count)));
  }
  $('dl-zip').addEventListener('click', function () { build(false); });
  $('dl-one').addEventListener('click', function () { build(true); });

  // --- ファイルを選ぶ・落とす ---
  function pickFiles(files) {
    var list = Array.prototype.slice.call(files || []);   // input.value = '' で FileList が空になる前に写す
    run(list);
  }
  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { pickFiles(this.files); this.value = ''; });
  $('try-sample').addEventListener('click', function () { run(C.makeSample(EN ? 'en' : 'ja'), true); });
  var zone = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('dragging'); }); });
  ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function () { zone.classList.remove('dragging'); }); });
  zone.addEventListener('drop', function (e) { e.preventDefault(); pickFiles(e.dataTransfer && e.dataTransfer.files); });

  // --- 絞り込み・書き方 ---
  var timer = null;
  el.q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(refresh, 200); });
  [el.from, el.to, el.source].forEach(function (x) { x.addEventListener('change', refresh); });
  [el.style, el.folder, el.bySource].forEach(function (x) { x.addEventListener('change', function () { syncSummary(); el.preview.hidden = true; text(el.previewPath, ''); }); });
  syncSummary();

  // オフライン対応（登録は './sw.js' だけ。scope: '/' を指定しない）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // 英語のページ（en/）からも、ツールの直下の sw.js を登録する（scope は /ai-log/ 全体）
    addEventListener('load', function () { navigator.serviceWorker.register(EN ? '../sw.js' : './sw.js').catch(function () {}); });
  }
})();

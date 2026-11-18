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
    preview: $('preview'), previewPath: $('preview-path'), mgrid: $('mgrid'), mgridTable: $('mgrid-table'), wgrid: $('wgrid'), wgridTable: $('wgrid-table'),
    dgrid: $('dgrid'), dgridSvg: $('dgrid-svg'), dgridDay: $('dgrid-day'), dgridPrev: $('dgrid-prev'), dgridNext: $('dgrid-next'),
    q: $('q'), from: $('from'), to: $('to'), source: $('source'), style: $('style'), folder: $('folder'), bySource: $('by-source'),
  };
  var TZ = 'UTC';
  try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* 古いブラウザ */ }
  // wh: 曜日 × 時刻の表で押した升 { dow, hour }。day: 1 日ごとの升目で絞り込んだ日、cursor: その升目で選んでいる日（どちらも "YYYY-MM-DD"）、days: 読んだ記録全部の日ごとの数（段の年と濃さの境）
  var state = { list: [], errors: [], stats: null, shown: [], busy: false, wh: null, day: null, cursor: null, days: null };
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
      if (s.created) { var w = C.weekHour(s.created, TZ); s.dow = w.dow; s.hour = w.hour; }   // 曜日 × 時刻の表（描き直しのたびに出し直さない）
      return s;
    });
    state.errors = m.errors; state.stats = m.stats; state.wh = null; state.day = null;
    state.days = C.dayCounts(state.list, TZ);
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
    state.cursor = ds.length ? ds[ds.length - 1] : null;   // 1 日ごとの升目は、いちばん新しい会話の日を選んだ形で開く
    refresh();
    window.yzUsed?.();
  }

  function refresh() {
    var f = filter(); f.wh = state.wh; f.day = state.day;
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
    renderGrid();
    renderWeekGrid();
    renderDayGrid();
  }

  // --- 年 × 月の升目（数は calc.js の monthCounts）。升を押すと期間の欄にその月の初めと終わりが入り、もう一度押すと外れる ---
  /** 期間の欄がちょうど 1 か月なら "YYYY-MM"、ほかは null */
  function pickedMonth() {
    var f = el.from.value, t = el.to.value;
    if (!f || !t) return null;
    var r = C.monthRange(+f.slice(0, 4), +f.slice(5, 7));
    return r.from === f && r.to === t ? f.slice(0, 7) : null;
  }
  function renderGrid() {
    var f = filter(); f.from = f.to = null; f.wh = state.wh; f.day = state.day;   // 期間のほかを掛ける（押した月のほかの月が消えないように）
    var g = C.monthCounts(state.list.filter(function (s) { return C.matches(s, f, TZ); }), TZ), pick = pickedMonth();
    var tb = el.mgridTable;
    tb.innerHTML = '';
    el.mgrid.hidden = !g.years.length;
    if (!g.years.length) return;
    var head = tb.createTHead().insertRow();
    head.appendChild(document.createElement('td'));
    for (var m = 1; m <= 12; m++) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = String(m); head.appendChild(th); }
    var body = tb.createTBody();
    g.years.forEach(function (yr) {
      var tr = body.insertRow(), th = document.createElement('th');
      th.scope = 'row'; th.textContent = String(yr.year); tr.appendChild(th);
      yr.months.forEach(function (n, i) {
        var td = tr.insertCell(), key = yr.year + '-' + String(i + 1).padStart(2, '0');
        if (!n && key !== pick) return;   // 0 件の月は空の升
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'lv' + C.monthLevel(n, g.max);
        b.textContent = n ? fmt(n) : '';
        if (!n) b.setAttribute('aria-label', '0');
        b.setAttribute('aria-pressed', String(key === pick));
        b.dataset.month = key;
        td.appendChild(b);
      });
    });
  }
  el.mgridTable.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-month]');
    if (!b) return;
    var key = b.dataset.month;
    if (pickedMonth() === key) { el.from.value = ''; el.to.value = ''; }
    else { var r = C.monthRange(+key.slice(0, 4), +key.slice(5, 7)); el.from.value = r.from; el.to.value = r.to; }
    refresh();
    var again = el.mgridTable.querySelector('button[data-month="' + key + '"]');
    if (again) again.focus();
  });

  // --- 曜日 × 時刻の表（数は calc.js の weekHourCounts。行は月曜〜日曜、列は 0〜23 時）。升を押すとその曜日・その時刻だけに絞り、もう一度押すと外す ---
  var DOW = [0, 1, 2, 3, 4, 5, 6].map(function (i) {   // 曜日の短い名前（2024-01-01 は月曜）
    return new Intl.DateTimeFormat(T.locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  });
  function renderWeekGrid() {
    var f = filter(), pick = state.wh;   // 押した升のほかの絞り込みを掛ける（押した升のほかの升が消えないように）
    f.day = state.day;
    var shown = state.list.filter(function (s) { return C.matches(s, f, TZ); });
    var g = C.weekHourCounts(shown, TZ), tb = el.wgridTable;
    tb.innerHTML = '';
    el.wgrid.hidden = !g.max && !pick;
    if (el.wgrid.hidden) return;
    var head = tb.createTHead().insertRow();
    head.appendChild(document.createElement('td'));
    for (var h = 0; h < 24; h++) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = String(h); head.appendChild(th); }
    var body = tb.createTBody();
    g.rows.forEach(function (row, d) {
      var tr = body.insertRow(), th = document.createElement('th');
      th.scope = 'row'; th.textContent = DOW[d]; tr.appendChild(th);
      row.forEach(function (n, hr) {
        var td = tr.insertCell(), on = !!pick && pick.dow === d && pick.hour === hr;
        if (!n && !on) return;   // 0 件の升は押せない（空の升）
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'lv' + C.monthLevel(n, g.max);
        b.setAttribute('aria-label', fmt(n));
        b.setAttribute('aria-pressed', String(on));
        b.dataset.dow = d; b.dataset.hour = hr;
        td.appendChild(b);
      });
    });
  }
  el.wgridTable.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-dow]');
    if (!b) return;
    var d = +b.dataset.dow, hr = +b.dataset.hour;
    state.wh = state.wh && state.wh.dow === d && state.wh.hour === hr ? null : { dow: d, hour: hr };
    refresh();
    var again = el.wgridTable.querySelector('button[data-dow="' + d + '"][data-hour="' + hr + '"]');
    if (again) again.focus();
  });

  // --- 1 日ごとの升目（数は calc.js の dayCounts。年ごとに 1 段、横が週・縦が曜日〈月曜が上〉）。升を押すとその日だけに絞り、もう一度押すと外す ---
  // 升は小さい（390 幅で 5 px 刻み）ので、押す所の大きさの対象にしない。フォーカスは升目に 1 つで、↑ ↓ で 1 日・← → で 1 週、Enter・Space で絞り込み。
  // 下の行に選んでいる日と数、その左右に前の日・次の日（44 px）。絞り込んでいる間は、選ぶ日を動かすと絞り込みもその日に動く（指で升を押し直さなくてよいように）
  var DG = { label: 36, top: 16, gap: 6 };   // 段の左の年の幅・上の月の高さ・段と段の間（px）
  var dgGeom = null;
  function dgBounds() { var ys = state.days.years; return { first: ys[0].year + '-01-01', last: ys[ys.length - 1].year + '-12-31' }; }
  function renderDayGrid() {
    var all = state.days;
    el.dgrid.hidden = !all || !all.years.length;
    if (el.dgrid.hidden) { dgGeom = null; return; }
    var f = filter(); f.wh = state.wh;   // 押した日のほかの絞り込みを掛ける（押した日のほかの日が消えないように）。段の年と濃さの境は読んだ記録全部から
    var g = C.dayCounts(state.list.filter(function (s) { return C.matches(s, f, TZ); }), TZ), by = {};
    g.years.forEach(function (y) { by[y.year] = y.days; });
    var cols = Math.max.apply(null, all.years.map(function (y) { return C.weekCols(y.year); }));
    var p = Math.max(4, Math.floor((el.dgrid.clientWidth - DG.label) / cols)), sz = p - 1, band = 7 * p + DG.gap;
    var w = DG.label + cols * p, h = DG.top + all.years.length * band - DG.gap;
    dgGeom = { p: p, band: band };
    var y0 = all.years[0].year, out = [];
    for (var m = 1; m <= 12; m++) out.push('<text x="' + (DG.label + C.dayCell(y0 + '-' + String(m).padStart(2, '0') + '-01').col * p) + '" y="11">' + m + '</text>');
    all.years.forEach(function (yr, i) {
      var top = DG.top + i * band, days = by[yr.year], j1 = C.jan1(yr.year);
      out.push('<text x="' + (DG.label - 6) + '" y="' + (top + 3.5 * p + 4) + '" text-anchor="end">' + yr.year + '</text>');
      for (var d = 0; d < yr.days.length; d++) {
        var k = d + j1;
        out.push('<rect class="d' + C.monthLevel(days ? days[d] : 0, all.max) + '" x="' + (DG.label + Math.floor(k / 7) * p) + '" y="' + (top + (k % 7) * p) + '" width="' + sz + '" height="' + sz + '"/>');
      }
    });
    function ring(s, cls) {
      var c = C.dayCell(s), i = c.year - y0;
      return '<rect class="' + cls + '" x="' + (DG.label + c.col * p - 1) + '" y="' + (DG.top + i * band + c.row * p - 1) + '" width="' + (sz + 2) + '" height="' + (sz + 2) + '"/>';
    }
    var b = dgBounds();
    if (state.day && state.day >= b.first && state.day <= b.last) out.push(ring(state.day, 'pick'));
    if (state.cursor < b.first || state.cursor > b.last) state.cursor = b.last;
    out.push(ring(state.cursor, 'cur'));
    var svg = el.dgridSvg;
    svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = out.join('');
    var cc = C.dayCell(state.cursor), n = by[cc.year] ? by[cc.year][cc.doy] : 0;
    text(el.dgridDay, state.cursor + ' · ' + T.count(fmt(n)));   // 区切りは一覧の行（出どころ · 発言の数）と同じ
    el.dgridDay.className = state.day === state.cursor ? 'on' : '';
    el.dgridPrev.disabled = state.cursor <= b.first;
    el.dgridNext.disabled = state.cursor >= b.last;
  }
  /** 押した所（升目の中の位置）にいちばん近い日 */
  function dayFromPoint(x, y) {
    var ys = state.days.years, p = dgGeom.p, i = Math.max(0, Math.min(ys.length - 1, Math.floor((y - DG.top + DG.gap / 2) / dgGeom.band)));
    var yr = ys[i].year, row = Math.max(0, Math.min(6, Math.floor((y - DG.top - i * dgGeom.band) / p)));
    var col = Math.max(0, Math.min(C.weekCols(yr) - 1, Math.floor((x - DG.label) / p)));
    return C.dayAt(yr, col, row);
  }
  /** 升目の動きで上の表が伸び縮みしても、触っている所（升目・前の日・次の日）が指の下から動かないように */
  function keepInPlace(target, fn) {
    var before = target.getBoundingClientRect().top;
    fn();
    var d = target.getBoundingClientRect().top - before;
    if (d) window.scrollBy(0, d);
  }
  function toggleDay(target) {
    keepInPlace(target, function () { state.day = state.day === state.cursor ? null : state.cursor; refresh(); });
  }
  /** 選ぶ日を n 日動かす。升目の外（最初の段の 1 月 1 日より前・最後の段の 12 月 31 日より後）へは動かない */
  function moveDay(n, target) {
    var to = C.addDays(state.cursor, n), b = dgBounds();
    if (to < b.first || to > b.last) return;
    state.cursor = to;
    if (state.day) keepInPlace(target, function () { state.day = to; refresh(); });
    else renderDayGrid();
  }
  el.dgridSvg.addEventListener('click', function (e) {
    if (!dgGeom) return;
    var r = el.dgridSvg.getBoundingClientRect();
    state.cursor = dayFromPoint(e.clientX - r.left, e.clientY - r.top);
    toggleDay(el.dgridSvg);
  });
  el.dgridSvg.addEventListener('keydown', function (e) {
    var step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (step) { e.preventDefault(); moveDay(step, el.dgridSvg); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDay(el.dgridSvg); }
  });
  el.dgridPrev.addEventListener('click', function () { moveDay(-1, el.dgridPrev); });
  el.dgridNext.addEventListener('click', function () { moveDay(1, el.dgridNext); });
  var dgResize = null;
  addEventListener('resize', function () { clearTimeout(dgResize); dgResize = setTimeout(function () { if (state.days) renderDayGrid(); }, 100); });

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

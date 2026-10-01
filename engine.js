// ===========================
// AI 会話ログ Markdown 変換 — 読み込みと書き出しの本体（Web Worker の中で動く。Worker が使えないときは画面の中で同じものを動かす）
// 画面（main.js）とはメッセージでやり取りする:
//   画面 → { type: 'load', files: [File|{path,text}], tz }           ファイルを読む（zip は目次だけ読み、conversations*.json だけ展開しながら読む）
//   画面 → { type: 'build', ids, opts }                               選んだ会話を zip（会話ごとの Markdown）か 1 つの Markdown にする
//   画面 → { type: 'preview', id, opts }                              会話 1 つの Markdown（画面の見本）
//   本体 → { type: 'progress', done, total, count } / { type: 'loaded', list, errors, stats } / { type: 'built', name, bytes } / { type: 'preview', text }
// ファイルはこの端末の中で読むだけで、どこにも送らない（fetch・XMLHttpRequest を使わない）
// ===========================
(function (root) {
  'use strict';

  function createEngine(Calc, Zip, post) {
    var convs = [];        // 共通の形の会話（読み込んだ順）

    var LINE_CODES = { notJson: 1, badJson: 1, truncated: 1, empty: 1 };   // これらの例外は arg に行番号を持つ
    function errOf(file, e, line, index) {
      var code = e && e.code || 'badJson';
      return {
        file: file, line: line || (LINE_CODES[code] && e && e.arg) || null, index: index == null ? null : index,
        code: code, arg: e && e.arg != null && !LINE_CODES[code] ? e.arg : null, message: e && e.message || String(e),
      };
    }

    /** バイトのストリームを UTF-8 の文字列の断片にして splitter に渡す。進み具合は圧縮後のバイト数で数える */
    function pump(stream, onText, onBytes) {
      var reader = stream.getReader(), dec = new TextDecoder('utf-8');
      function next() {
        return reader.read().then(function (r) {
          if (r.done) { var tail = dec.decode(); if (tail) onText(tail); return; }
          onBytes(r.value.length);
          onText(dec.decode(r.value, { stream: true }));
          return next();
        });
      }
      return next();
    }

    /** 1 つの JSON（conversations.json）を読む。会話ごとに共通の形にし、読めない会話は「何行目」を残して続ける */
    function readJson(name, open, state) {
      var splitter = new Calc.ArraySplitter(function (item, line, index) {
        var obj = item;
        if (typeof item === 'string') {
          try { obj = JSON.parse(item); } catch (e) { state.errors.push(errOf(name, Calc.fail('badJson', 'JSON として読めません'), line + Calc.lineOfError(item, e), index)); return; }
        }
        try {
          var c = Calc.normalize(obj, state.stats);
          c.file = name; c.line = line;
          state.found.push(c);
        } catch (e) { state.errors.push(errOf(name, e, line, index)); }
      });
      return open().then(function (stream) {
        return pump(stream, function (t) { splitter.push(t); }, function (n) { state.done += n; state.tick(); });
      }).then(function () { splitter.end(); }).catch(function (e) { state.errors.push(errOf(name, e, LINE_CODES[e && e.code] ? e.arg || splitter.line : null)); });
    }

    function load(files) {
      var state = { found: [], errors: [], stats: Calc.newStats(), done: 0, total: 0, last: 0, jsonFiles: 0, tick: null };
      state.tick = function () {
        var now = Date.now();
        if (now - state.last > 150) { state.last = now; post({ type: 'progress', done: state.done, total: state.total, count: state.found.length }); }
      };
      var jobs = [];   // { name, size, open }
      return files.reduce(function (p, f) {
        return p.then(function () {
          var name = f.path || f.webkitRelativePath || f.relPath || f.name || '';
          if (typeof f.text === 'string') {   // 見本（文字列）
            jobs.push({ name: name, size: f.text.length, open: function () { return Promise.resolve(new Blob([f.text]).stream()); } });
            return;
          }
          if (/\.zip$/i.test(name)) {
            return Zip.readIndex(f).then(function (entries) {
              var hit = entries.filter(function (en) { return Calc.isConversationsFile(en.name); });
              if (!hit.length) state.errors.push(errOf(name, Calc.fail('noConversations', 'zip の中に conversations.json がありません')));
              hit.forEach(function (en) {
                jobs.push({ name: name + ' › ' + en.name, size: en.compSize, open: function () { return Zip.readStream(f, en).then(function (r) { return r.stream; }); } });
              });
            }, function (e) { state.errors.push(errOf(name, e)); });
          }
          if (/\.json$/i.test(name)) {
            jobs.push({ name: name, size: f.size, open: function () { return Promise.resolve(f.stream()); } });
            return;
          }
          state.errors.push(errOf(name, Calc.fail('notTarget', '.zip か .json を選んでください')));
        });
      }, Promise.resolve()).then(function () {
        state.total = jobs.reduce(function (s, j) { return s + (j.size || 0); }, 0);
        return jobs.reduce(function (p, j) { return p.then(function () { state.jsonFiles++; return readJson(j.name, j.open, state); }); }, Promise.resolve());
      }).then(function () {
        // 同じ会話（出どころと ID が同じ）が 2 回あれば、更新の新しいほうを残す（同じ書き出しを 2 回選んだときなど）
        var at = {}, dup = 0, merged = [];
        convs.concat(state.found).forEach(function (c) {
          var k = c.id ? c.source + ':' + c.id : null;
          if (k && at[k] != null) {
            dup++;
            if ((c.updated || 0) >= (merged[at[k]].updated || 0)) merged[at[k]] = c;
            return;
          }
          if (k) at[k] = merged.length;
          merged.push(c);
        });
        convs = merged;
        convs.forEach(function (c, i) { c.n = i; });
        var other = 0, atts = 0;
        convs.forEach(function (c) { other += c.otherBranch || 0; c.messages.forEach(function (m) { atts += m.attachments.length; }); });
        post({
          type: 'loaded',
          list: convs.map(summary),
          errors: state.errors,
          stats: { files: state.jsonFiles, duplicates: dup, otherBranch: other, attachments: atts, unknown: state.stats.unknown },
        });
      });
    }

    function summary(c) {
      return { n: c.n, source: c.source, title: c.title, created: c.created ? c.created.getTime() : null, updated: c.updated ? c.updated.getTime() : null, count: c.messages.length, model: c.model };
    }

    function pick(ids) { return (ids || []).map(function (i) { return convs[i]; }).filter(Boolean); }

    function build(ids, o) {
      var list = pick(ids), enc = new TextEncoder();
      if (o.combined) {
        var bytes = enc.encode(Calc.toCombinedMarkdown(list, o));
        post({ type: 'built', kind: 'md', bytes: bytes, count: list.length }, [bytes.buffer]);
        return;
      }
      var paths = Calc.filePaths(list, o);
      var zip = Zip.makeZip(list.map(function (c, i) { return { name: paths[i], bytes: enc.encode(Calc.toMarkdown(c, o)) }; }));
      post({ type: 'built', kind: 'zip', bytes: zip, count: list.length }, [zip.buffer]);
    }

    function handle(msg) {
      try {
        if (msg.type === 'load') {
          if (msg.reset) convs = [];
          return load(msg.files || []).catch(function (e) { post({ type: 'failed', code: e && e.code, message: e && e.message || String(e) }); });
        }
        if (msg.type === 'clear') { convs = []; return; }
        if (msg.type === 'build') return build(msg.ids, msg.opts);
        if (msg.type === 'preview') {
          var c = convs[msg.id];
          var text = c ? Calc.toMarkdown(c, msg.opts) : '';
          post({ type: 'preview', id: msg.id, text: text.length > 20000 ? text.slice(0, 20000) + '\n…' : text, path: c ? Calc.filePaths([c], msg.opts)[0] : '' });
        }
      } catch (e) { post({ type: 'failed', code: e && e.code, message: e && e.message || String(e) }); }
    }
    return { handle: handle };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createEngine: createEngine };
  else root.createEngine = createEngine;
})(this);

// ===========================
// AI 会話ログ Markdown 変換 — 読み方と書き方（画面から切り離した純粋関数）
// - ChatGPT と Claude の書き出し（conversations.json）を、共通の形 { source, id, title, created, updated, model, messages } にそろえる
// - 会話 1 つを frontmatter つきの Markdown に、ファイル名を Windows・macOS で使える形にする
// - 大きな JSON を丸ごと文字列にしないで、配列の要素（会話）ごとに切り出す（ArraySplitter）
// 形式は公式の仕様書が無いので、公開の変換器（MIT）の試料とコードで確かめた（constants.js の SOURCES、README「読む形式」）。
// DOM・localStorage・fetch に触らない。ブラウザ（画面と Web Worker）では self.Calc、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  // --- 例外（画面の言語ごとの文は text.js の err[code]。message は日本語のまま） ---
  function fail(code, message, arg) { var e = new Error(message); e.code = code; if (arg != null) e.arg = arg; return e; }

  // --- 時刻 ---
  /** epoch 秒（ChatGPT。小数あり）か ISO 文字列（Claude）を Date に。読めなければ null */
  function toDate(v) {
    if (v == null || v === '') return null;
    var d = typeof v === 'number' ? new Date(v * 1000) : /^\d+(\.\d+)?$/.test(String(v)) ? new Date(Number(v) * 1000) : new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }
  var fmtCache = {};
  /** Date をそのタイムゾーンの { y, mo, d, h, mi, s, offset } に（offset は "+09:00" の形） */
  function partsIn(date, tz) {
    var key = tz || '';
    var f = fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
    var p = {};
    f.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    var off = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    var sign = off < 0 ? '-' : '+', a = Math.abs(off);
    return { y: p.year, mo: p.month, d: p.day, h: String(+p.hour % 24).padStart(2, '0'), mi: p.minute, s: p.second, offset: sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0') };
  }
  /** "2025-01-15"（そのタイムゾーンの日付） */
  function localDate(date, tz) { var p = partsIn(date, tz); return p.y + '-' + p.mo + '-' + p.d; }
  /** "2025-01-15 09:00" */
  function localTime(date, tz) { var p = partsIn(date, tz); return p.y + '-' + p.mo + '-' + p.d + ' ' + p.h + ':' + p.mi; }
  /** "2025-01-15T09:00:00+09:00"（frontmatter 用。Obsidian のプロパティで日時として読める） */
  function isoLocal(date, tz) { var p = partsIn(date, tz); return p.y + '-' + p.mo + '-' + p.d + 'T' + p.h + ':' + p.mi + ':' + p.s + p.offset; }

  // =====================================================================
  // 大きな JSON 配列を、要素ごとの文字列に切り出す
  // conversations.json は「会話の配列」1 つ。全体を 1 本の文字列にして JSON.parse すると、100MB の書き出しで
  // 文字列とオブジェクトの両方が同時にメモリに載る。ここでは少しずつ受け取り、要素（会話）が閉じたら 1 つずつ渡す。
  // 文字列の中の { } [ ] は数えない（"..." とエスケープを追う）。改行の数で、要素が始まった行を覚える
  // depth: 0 配列の外 / 1 配列の直下 / 1.5 直下の要素が文字列・数 / 2 以上 要素（オブジェクト・配列）の中
  // =====================================================================
  function ArraySplitter(onItem) {
    this.onItem = onItem;   // function (textOrObject, startLine, index)
    this.depth = 0; this.inStr = false; this.esc = false;
    this.mode = null;       // null（まだ何も来ていない）/ 'array' / 'object'（{"conversations":[...]} の形。全体を読んでから分ける）/ 'done'
    this.line = 1; this.itemLine = 1; this.pending = []; this.count = 0; this.whole = [];
  }
  ArraySplitter.prototype.push = function (chunk) {
    var i = 0, n = chunk.length, start = this.depth >= 1.5 ? 0 : -1;
    if (this.mode === 'done') {
      if (/\S/.test(chunk.replace(/\ufeff/g, ''))) throw fail('badJson', 'JSON の配列の後ろに余計な文字があります', this.line);
      return;
    }
    if (this.mode === null) {
      while (i < n) {
        var c0 = chunk.charCodeAt(i);
        if (c0 === 10) this.line++;
        if (c0 === 0x20 || c0 === 9 || c0 === 10 || c0 === 13 || c0 === 0xfeff) { i++; continue; }
        if (c0 === 0x5b) { this.mode = 'array'; this.depth = 1; i++; break; }               // [
        if (c0 === 0x7b) { this.mode = 'object'; break; }                                    // {
        throw fail('notJson', 'JSON の配列ではありません', this.line);
      }
      if (this.mode === null) return;
    }
    if (this.mode === 'object') { this.whole.push(i ? chunk.slice(i) : chunk); return; }
    for (; i < n; i++) {
      var c = chunk.charCodeAt(i);
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === 0x5c) this.esc = true;          // \
        else if (c === 0x22) this.inStr = false;        // "
        continue;
      }
      if (c === 10) { this.line++; continue; }
      if (c === 0x22) {                                 // "
        this.inStr = true;
        if (this.depth === 1) { start = i; this.itemLine = this.line; this.depth = 1.5; }
        continue;
      }
      if (c === 0x7b || c === 0x5b) {                   // { [
        if (this.depth === 1) { start = i; this.itemLine = this.line; this.depth = 2; }
        else this.depth = Math.floor(this.depth) + 1;
        continue;
      }
      if (c === 0x7d || c === 0x5d) {                   // } ]
        if (this.depth <= 1.5) {
          if (this.depth === 1.5) { this.emit(chunk.slice(start, i)); start = -1; }
          if (c === 0x5d) {
            this.depth = 0; this.mode = 'done';
            if (/\S/.test(chunk.slice(i + 1))) throw fail('badJson', 'JSON の配列の後ろに余計な文字があります', this.line);
            return;
          }
          throw fail('badJson', 'JSON の括弧が合いません', this.line);
        }
        this.depth--;
        if (this.depth === 1) { this.emit(chunk.slice(start, i + 1)); start = -1; }
        continue;
      }
      if (c === 0x2c && this.depth === 1.5) { this.emit(chunk.slice(start, i)); this.depth = 1; start = -1; }  // 文字列の要素（会話ではない）
    }
    if (this.depth >= 1.5 && start >= 0) this.pending.push(chunk.slice(start));
  };
  ArraySplitter.prototype.emit = function (tail) {
    var text = this.pending.length ? this.pending.join('') + tail : tail;
    this.pending = [];
    this.onItem(text, this.itemLine, this.count++);
  };
  ArraySplitter.prototype.end = function () {
    if (this.mode === 'object') {
      var all = this.whole.join(''); this.whole = [];
      var obj;
      try { obj = JSON.parse(all); } catch (e) { throw fail('badJson', 'JSON として読めません', 1 + lineOfError(all, e)); }
      var list = obj && (obj.conversations || obj.chats);
      if (!Array.isArray(list)) throw fail('notJson', 'JSON の配列ではありません', 1);
      for (var k = 0; k < list.length; k++) this.onItem(list[k], 1, this.count++);   // 文字列ではなくオブジェクトのまま渡す
      return;
    }
    if (this.mode === null) throw fail('empty', 'ファイルが空です', this.line);
    if (this.mode !== 'done') throw fail('truncated', 'ファイルが途中で終わっています', this.line);
  };
  /** JSON.parse の例外から、テキストの何行目か（0 始まりの差）を出す。分からなければ 0 */
  function lineOfError(text, e) {
    var msg = e && e.message || '';
    var m = /line (\d+)/.exec(msg);
    if (m) return +m[1] - 1;
    m = /position (\d+)/.exec(msg);
    if (!m) return 0;
    var pos = Math.min(+m[1], text.length), n = 0;
    for (var i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  // =====================================================================
  // 形式の見分け
  // =====================================================================
  function detect(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (c.mapping && typeof c.mapping === 'object') return 'chatgpt';
    if (Array.isArray(c.chat_messages)) return 'claude';
    return null;
  }

  /** コードを囲む ``` を、中身にある ``` より長くする（中身のコードブロックを壊さない） */
  function fence(code, lang) {
    code = String(code == null ? '' : code);
    var longest = 2, m, re = /`{3,}/g;
    while ((m = re.exec(code))) longest = Math.max(longest, m[0].length);
    var f = new Array(longest + 2).join('`');
    lang = lang && lang !== 'unknown' ? String(lang).replace(/[^\w+#.-]/g, '') : '';
    return f + lang + '\n' + code.replace(/\n+$/, '') + '\n' + f;
  }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } }); return out; }

  // =====================================================================
  // ChatGPT（conversations.json の要素 1 つ）
  // mapping は「発言の木」。編集・再生成で枝が分かれる。current_node（画面で最後に見ていた枝の先）から親をたどって根まで戻り、逆順にする。
  // current_node が無い試料（ai-chat-md-export の examples）では、根から「最後の子」をたどる
  // =====================================================================
  // 画面に出ない内部の発言（convoviz の docs/dev/chatgpt-spec.md 7 章「Identifying Hidden Messages」の考え方）
  var GPT_HIDDEN = { thoughts: 1, reasoning_recap: 1, tether_browsing_display: 1, tether_quote: 1, sonic_webpage: 1, system_error: 1, user_editable_context: 1, model_editable_context: 1 };
  var GPT_KNOWN = { text: 1, multimodal_text: 1, code: 1, execution_output: 1 };

  function gptPath(c) {
    var map = c.mapping, leaf = null, guard = {};
    if (c.current_node && map[c.current_node]) leaf = c.current_node;
    else {
      // 根（親が無いか、親が mapping に無い）から、最後の子をたどる
      var ids = Object.keys(map), node = null;
      for (var i = 0; i < ids.length; i++) { var p = map[ids[i]] && map[ids[i]].parent; if (!p || !map[p]) { node = ids[i]; break; } }
      while (node && !guard[node]) {
        guard[node] = 1; leaf = node;
        var kids = (map[node].children || []).filter(function (k) { return map[k]; });
        node = kids.length ? kids[kids.length - 1] : null;
      }
      guard = {};
    }
    var path = [];
    for (var id = leaf; id && map[id] && !guard[id]; id = map[id].parent) { guard[id] = 1; path.push(id); }
    return path.reverse();
  }

  function gptMessage(m, stats) {
    if (!m || typeof m !== 'object') return null;
    var role = m.author && m.author.role, md = m.metadata || {}, content = m.content || {}, ct = content.content_type;
    if (md.is_visually_hidden_from_conversation) return null;
    if (role === 'system') return null;
    if (GPT_HIDDEN[ct]) return null;
    var recipient = m.recipient;
    if (role === 'assistant' && recipient && recipient !== 'all' && ct !== 'code') return null;   // ツールへの内部の呼び出し
    if (role === 'tool' && ct !== 'execution_output' && ct !== 'multimodal_text') return null;
    var texts = [], atts = [];
    if (ct === 'code') texts.push(fence(content.text || '', content.language));
    else if (ct === 'execution_output') texts.push(fence(content.text || '', ''));
    else if (Array.isArray(content.parts)) {
      content.parts.forEach(function (p) {
        if (typeof p === 'string') { if (p) texts.push(p); return; }
        if (!p || typeof p !== 'object') return;
        if (p.content_type === 'image_asset_pointer' || p.asset_pointer) atts.push(String(p.asset_pointer || '').replace(/^[a-z-]+:\/\//, ''));
        else if (typeof p.text === 'string' && p.text) texts.push(p.text);   // 音声の書き起こしなど
      });
    } else if (typeof content.text === 'string') texts.push(content.text);
    if (ct && !GPT_KNOWN[ct]) stats.unknown[ct] = (stats.unknown[ct] || 0) + 1;
    (Array.isArray(md.attachments) ? md.attachments : []).forEach(function (a) { if (a && typeof a === 'object') atts.push(a.name || a.id); });
    var text = texts.join('\n\n');
    atts = uniq(atts.map(function (x) { return x == null ? '' : String(x); }));
    if (!text.trim() && !atts.length) return null;
    return {
      role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'tool',
      time: toDate(m.create_time), text: text, attachments: atts, tools: [], model: md.model_slug || null,
    };
  }

  function fromChatGPT(c, stats) {
    if (!c || typeof c.mapping !== 'object' || !c.mapping) throw fail('noMapping', 'mapping（発言の木）がありません');
    var path = gptPath(c), onPath = {}, messages = [], model = null;
    path.forEach(function (id) { onPath[id] = 1; });
    path.forEach(function (id) {
      var x = gptMessage(c.mapping[id].message, stats);
      if (x) { messages.push(x); if (x.role === 'assistant' && x.model) model = x.model; }
    });
    var other = 0;
    Object.keys(c.mapping).forEach(function (id) { if (!onPath[id] && c.mapping[id] && c.mapping[id].message) other++; });
    var times = messages.map(function (x) { return x.time; }).filter(Boolean);
    return {
      source: 'chatgpt',
      id: String(c.conversation_id || c.id || ''),
      title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : null,
      created: toDate(c.create_time) || times[0] || null,
      updated: toDate(c.update_time) || times[times.length - 1] || null,
      model: c.model_slug || model || c.default_model_slug || null,
      messages: messages, otherBranch: other,
    };
  }

  // =====================================================================
  // Claude（conversations.json の要素 1 つ）
  // chat_messages は発言の配列。枝（やり直し・編集）があると parent_message_uuid で木になる。
  // current_leaf_message_uuid があればそこから親をたどる。無ければ「いちばん深い枝」（davidteren/claude_desktop_export_browser の
  // get_current_branch と同じ考え方。根が複数なら古い順につなぐ）。親の情報が無ければ created_at の順
  // =====================================================================
  var CLAUDE_PLACEHOLDER = 'This block is not supported on your current device yet.';
  var CLAUDE_KNOWN = { text: 1, thinking: 1, redacted_thinking: 1, tool_use: 1, tool_result: 1, token_budget: 1 };

  function timeOf(m) { var d = toDate(m && m.created_at); return d ? d.getTime() : 0; }

  function claudeOrder(list, leafId) {
    var byId = {}, hasParent = false;
    list.forEach(function (m) { if (m.uuid) byId[m.uuid] = m; });
    list.forEach(function (m) { if (m.parent_message_uuid && byId[m.parent_message_uuid] && m.parent_message_uuid !== m.uuid) hasParent = true; });
    var guard = {}, path = [];
    if (leafId && byId[leafId] && hasParent) {
      for (var m = byId[leafId]; m && !guard[m.uuid]; m = byId[m.parent_message_uuid]) { guard[m.uuid] = 1; path.push(m); }
      return path.reverse();
    }
    if (!hasParent) {
      return list.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return (timeOf(a[0]) - timeOf(b[0])) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
    }
    var key = function (x) { return x.uuid || ('#' + list.indexOf(x)); };
    var kids = {}, roots = [];
    list.forEach(function (x) {
      var p = x.parent_message_uuid;
      if (p && byId[p] && p !== x.uuid) (kids[p] = kids[p] || []).push(x); else roots.push(x);
    });
    // 深さ（葉までの発言の数）を、再帰を使わずに後ろから数える。循環は途中で切る
    var depth = {}, best = {}, state = {};
    function measure(r) {
      var stack = [[r, false]];
      while (stack.length) {
        var top = stack.pop(), node = top[0], id = key(node);
        if (!top[1]) {
          if (state[id] === 2) continue;
          state[id] = 1; stack.push([node, true]);
          (kids[node.uuid] || []).forEach(function (k) { if (state[key(k)] !== 1) stack.push([k, false]); });
        } else {
          var b = null;
          (kids[node.uuid] || []).forEach(function (k) {
            if (state[key(k)] !== 2) return;
            // 深いほう。同じ深さなら新しいほう（やり直した後の発言）
            if (!b || depth[key(k)] > depth[key(b)] || (depth[key(k)] === depth[key(b)] && timeOf(k) > timeOf(b))) b = k;
          });
          depth[id] = 1 + (b ? depth[key(b)] : 0); best[id] = b; state[id] = 2;
        }
      }
    }
    roots.sort(function (a, b) { return timeOf(a) - timeOf(b); });
    roots.forEach(function (r) {
      if (guard[key(r)]) return;
      measure(r);
      for (var n = r; n && !guard[key(n)]; n = best[key(n)]) { guard[key(n)] = 1; path.push(n); }
    });
    return path;
  }

  function claudeMessage(m, stats) {
    if (!m || typeof m !== 'object') return null;
    var who = m.sender || m.role;
    var texts = [], tools = [];
    if (Array.isArray(m.content)) {
      m.content.forEach(function (b) {
        if (!b || typeof b !== 'object') return;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) texts.push(b.text.replace(/^\n+|\n+$/g, ''));
        else if (b.type === 'tool_use' && b.name) tools.push(String(b.name));
        if (b.type && !CLAUDE_KNOWN[b.type]) stats.unknown[b.type] = (stats.unknown[b.type] || 0) + 1;
      });
    } else if (typeof m.content === 'string' && m.content.trim()) texts.push(m.content);
    if (!texts.length && typeof m.text === 'string') {
      // 平らにした text には、ツールなどの所に決まった文（CLAUDE_PLACEHOLDER）が入っているので消す
      var t = m.text.split(CLAUDE_PLACEHOLDER).join('').replace(/```[^\n]*\n\s*```/g, '').trim();
      if (t) texts.push(t);
    }
    var atts = [];
    [m.attachments, m.files, m.files_v2].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (a) { if (a && typeof a === 'object') atts.push(a.file_name || a.name || a.file_uuid); });
    });
    atts = uniq(atts.map(function (x) { return x == null ? '' : String(x); }));
    var text = texts.join('\n\n');
    if (!text.trim() && !atts.length && !tools.length) return null;
    return { role: who === 'human' || who === 'user' ? 'user' : 'assistant', time: toDate(m.created_at), text: text, attachments: atts, tools: uniq(tools), model: null };
  }

  function fromClaude(c, stats) {
    if (!c || !Array.isArray(c.chat_messages)) throw fail('noMessages', 'chat_messages（発言の一覧）がありません');
    var list = c.chat_messages.filter(function (m) { return m && typeof m === 'object'; });
    var ordered = claudeOrder(list, c.current_leaf_message_uuid);
    var messages = [];
    ordered.forEach(function (m) { var x = claudeMessage(m, stats); if (x) messages.push(x); });
    var times = messages.map(function (x) { return x.time; }).filter(Boolean);
    return {
      source: 'claude',
      id: String(c.uuid || ''),
      title: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null,
      created: toDate(c.created_at) || times[0] || null,
      updated: toDate(c.updated_at) || times[times.length - 1] || null,
      model: typeof c.model === 'string' && c.model ? c.model : null,   // 会話ごとのモデル名があれば（README 開いた問い）
      messages: messages, otherBranch: list.length - ordered.length,
    };
  }

  /** 要素 1 つ（会話）を共通の形に。形が分からなければ例外（code: unknownShape） */
  function normalize(c, stats) {
    var kind = detect(c);
    if (kind === 'chatgpt') return fromChatGPT(c, stats);
    if (kind === 'claude') return fromClaude(c, stats);
    throw fail('unknownShape', 'ChatGPT・Claude の会話の形ではありません');
  }
  function newStats() { return { unknown: {} }; }

  // =====================================================================
  // Markdown
  // =====================================================================
  var LABELS = {
    ja: { user: 'ユーザー', tool: 'ツール', attachment: '添付', toolUse: '使ったツール', untitled: '無題', noDate: '日付なし', combined: 'AI 会話ログ',
      source: '出どころ', created: '作成', updated: '更新', model: 'モデル', count: '発言の数', id: 'ID', sep: '、', open: '（', close: '）' },
    en: { user: 'User', tool: 'Tool', attachment: 'Attachment', toolUse: 'Tools used', untitled: 'Untitled', noDate: 'no-date', combined: 'AI chat log',
      source: 'Source', created: 'Created', updated: 'Updated', model: 'Model', count: 'Messages', id: 'ID', sep: ', ', open: ' (', close: ')' },
  };
  var SOURCE_NAME = { chatgpt: 'ChatGPT', claude: 'Claude' };
  function yamlStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'; }

  function speaker(conv, m, L) { return m.role === 'user' ? L.user : m.role === 'tool' ? L.tool : SOURCE_NAME[conv.source]; }
  function bodyOf(m, L) {
    var out = m.text || '';
    if (m.tools && m.tools.length) out += (out ? '\n\n' : '') + '*' + L.toolUse + ': ' + m.tools.join(L.sep) + '*';
    if (m.attachments.length) out += (out ? '\n\n' : '') + m.attachments.map(function (a) { return '- ' + L.attachment + ': `' + a.replace(/`/g, "'") + '`'; }).join('\n');
    return out;
  }
  var CALLOUT = { user: 'question', assistant: 'note', tool: 'example' };

  /** 会話の本文（見出しから下）。level は会話の見出しの深さ（1 なら # 題名、発言は ##） */
  function bodyMarkdown(conv, o, level) {
    var L = LABELS[o.lang] || LABELS.ja, h = new Array(level + 1).join('#'), out = [];
    out.push(h + ' ' + (conv.title || L.untitled), '');
    conv.messages.forEach(function (m) {
      var who = speaker(conv, m, L) + (m.time ? L.open + localTime(m.time, o.tz) + L.close : '');
      var body = bodyOf(m, L);
      if (o.style === 'callout') {
        out.push('> [!' + CALLOUT[m.role] + '] ' + who);
        body.split('\n').forEach(function (line) { out.push(line ? '> ' + line : '>'); });
        out.push('');
      } else {
        out.push(h + '# ' + who, '', body, '');
      }
    });
    return out.join('\n');
  }

  /** 会話 1 つ → frontmatter つきの Markdown */
  function toMarkdown(conv, o) {
    var L = LABELS[o.lang] || LABELS.ja, fm = ['---'];
    fm.push('title: ' + yamlStr(conv.title || L.untitled));
    fm.push('source: ' + SOURCE_NAME[conv.source]);
    if (conv.id) fm.push('id: ' + yamlStr(conv.id));
    if (conv.created) fm.push('created: ' + isoLocal(conv.created, o.tz));
    if (conv.updated) fm.push('updated: ' + isoLocal(conv.updated, o.tz));
    if (conv.model) fm.push('model: ' + yamlStr(conv.model));
    fm.push('messages: ' + conv.messages.length);
    fm.push('---', '');
    return fm.join('\n') + bodyMarkdown(conv, o, 1).replace(/\n+$/, '') + '\n';
  }

  /** 会話の束 → 1 つの Markdown（frontmatter は全体で 1 つ。会話ごとの情報は題名の下に箇条書き） */
  function toCombinedMarkdown(convs, o) {
    var L = LABELS[o.lang] || LABELS.ja, out = ['---', 'title: ' + yamlStr(L.combined), 'conversations: ' + convs.length];
    var ds = convs.map(function (c) { return c.created; }).filter(Boolean).sort(function (a, b) { return a - b; });
    if (ds.length) out.push('from: ' + localDate(ds[0], o.tz), 'to: ' + localDate(ds[ds.length - 1], o.tz));
    out.push('---', '');
    convs.forEach(function (c) {
      var body = bodyMarkdown(c, o, 1).split('\n');
      var meta = ['- ' + L.source + ': ' + SOURCE_NAME[c.source]];
      if (c.created) meta.push('- ' + L.created + ': ' + localTime(c.created, o.tz));
      if (c.updated) meta.push('- ' + L.updated + ': ' + localTime(c.updated, o.tz));
      if (c.model) meta.push('- ' + L.model + ': ' + c.model);
      meta.push('- ' + L.count + ': ' + c.messages.length);
      if (c.id) meta.push('- ' + L.id + ': ' + c.id);
      out.push(body[0], '', meta.join('\n'), '', body.slice(2).join('\n').replace(/\n+$/, ''), '');
    });
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }

  // =====================================================================
  // ファイル名（Windows・macOS・Obsidian で使える形）
  // - Windows で使えない < > : " / \ | ? * と制御文字、Obsidian のリンクを壊す # ^ [ ] を _ に
  // - 先頭の . （macOS で隠しファイル）と末尾の . と空白（Windows で消える）を取る
  // - CON・PRN・AUX・NUL・COM1〜9・LPT1〜9（Windows の予約名）は後ろに _
  // - 題名は 60 文字・UTF-8 で 150 バイトまで（日付と「 (2)」と .md を足しても 255 バイトに収まる）
  // - 大文字・小文字だけ違う名前は同じとみなして「 (2)」を付ける（Windows と macOS の既定は区別しない）
  // =====================================================================
  var RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  function utf8Len(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; } else n += 3; } return n; }
  function safeName(title, maxChars, maxBytes) {
    maxChars = maxChars || 60; maxBytes = maxBytes || 150;
    var s = String(title == null ? '' : title);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[\u0000-\u001f\u007f<>:"\/\\|?*#^\[\]]/g, '_').replace(/\s+/g, ' ').trim();
    var chars = Array.from(s), out = '', bytes = 0;
    for (var i = 0; i < chars.length && i < maxChars; i++) {
      var b = utf8Len(chars[i]);
      if (bytes + b > maxBytes) break;
      out += chars[i]; bytes += b;
    }
    out = out.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    if (RESERVED.test(out)) out += '_';
    return out;
  }

  /**
   * 会話ごとのファイルのパス（zip の中）。o.folder: 'none' / 'year' / 'month'、o.bySource: 出どころのフォルダ（ChatGPT/・Claude/）
   * @returns {string[]} convs と同じ順
   */
  function filePaths(convs, o) {
    var L = LABELS[o.lang] || LABELS.ja, used = {};
    return convs.map(function (c) {
      var date = c.created ? localDate(c.created, o.tz) : null;
      var dir = o.bySource ? SOURCE_NAME[c.source] + '/' : '';
      if (o.folder === 'year' || o.folder === 'month') {
        dir += (date ? date.slice(0, 4) : L.noDate) + '/';
        if (o.folder === 'month' && date) dir += date.slice(0, 7) + '/';
      }
      var base = (date ? date + ' ' : '') + (safeName(c.title) || L.untitled);
      var name = dir + base, n = 1;
      while (used[(name + '.md').toLowerCase()]) { n++; name = dir + base + ' (' + n + ')'; }
      used[(name + '.md').toLowerCase()] = 1;
      return name + '.md';
    });
  }

  // =====================================================================
  // 絞り込み（期間は作成日。キーワードは題名。空白で区切った語をすべて含むもの。全角・半角と大文字・小文字を区別しない）
  // =====================================================================
  function fold(s) { s = String(s || ''); return (s.normalize ? s.normalize('NFKC') : s).toLowerCase(); }
  function matches(conv, f, tz) {
    if (f.source && f.source !== 'all' && conv.source !== f.source) return false;
    if (f.from || f.to) {
      if (!conv.created) return false;
      var d = conv.date || localDate(conv.created, tz);   // date は前もって出した "YYYY-MM-DD"（画面で毎回出し直さないため）
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
    }
    var terms = fold(f.q).split(/\s+/).filter(Boolean);
    if (terms.length) {
      var t = fold(conv.title);
      for (var i = 0; i < terms.length; i++) if (t.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }

  /** 書き出しの中の、会話が入っているファイルか（ChatGPT は conversations-000.json のように分かれることがある） */
  function isConversationsFile(path) { return /(^|\/)conversations(-\d+)?\.json$/i.test(String(path).replace(/\\/g, '/')); }

  // =====================================================================
  // 見本（架空の会話。画面の「見本で試す」）。本物の会話は含めない
  // =====================================================================
  function makeSample(lang) {
    var en = lang === 'en', t0 = Date.UTC(2026, 0, 10, 1, 0, 0) / 1000;
    function node(id, parent, children, role, text, dt, extra) {
      var m = role ? { id: id, author: { role: role }, create_time: t0 + dt, content: { content_type: 'text', parts: [text] }, metadata: extra || {}, recipient: 'all' } : null;
      return { id: id, parent: parent, children: children, message: m };
    }
    var S = en ? {
      t1: 'Sample: curry shopping list', u1: 'Make a shopping list for curry for four (this is a sample chat).', old: '(The answer before regenerating. It is not exported.)',
      a1: '- 2 onions\n- 1 carrot\n- 2 potatoes\n- 300 g meat\n- 1 box of curry roux', u2: 'Make it a CSV so I can count in a spreadsheet.', csv: '```csv\nitem,qty\nonion,2\ncarrot,1\n```',
      t2: 'Sample: packing list', h1: 'What should I pack for one night away? (this is a sample chat)', att: 'itinerary.txt', a2: 'Clothes, a toothbrush, a charger and your usual medicine.',
    } : {
      t1: '見本: カレーの買い物リスト', u1: '4 人分のカレーの買い物リストを作って（これは見本の会話です）', old: '（作り直す前の答え。書き出しには入りません）',
      a1: '- 玉ねぎ 2 個\n- にんじん 1 本\n- じゃがいも 2 個\n- 肉 300 g\n- カレールウ 1 箱', u2: '表計算で数えたいので CSV にして', csv: '```csv\n品目,数\n玉ねぎ,2\nにんじん,1\n```',
      t2: '見本: 旅行の持ち物', h1: '1 泊の旅行の持ち物は？（これは見本の会話です）', att: 'しおり.txt', a2: '着替え・歯ブラシ・充電器・いつもの薬です。',
    };
    var gpt = [{
      title: S.t1, conversation_id: 'sample-gpt-1', create_time: t0, update_time: t0 + 300, current_node: 'a2',
      mapping: {
        r: node('r', null, ['u1'], null),
        u1: node('u1', 'r', ['a1b', 'a1'], 'user', S.u1, 0),
        a1b: node('a1b', 'u1', [], 'assistant', S.old, 30, { model_slug: 'sample-model' }),
        a1: node('a1', 'u1', ['u2'], 'assistant', S.a1, 60, { model_slug: 'sample-model' }),
        u2: node('u2', 'a1', ['a2'], 'user', S.u2, 120),
        a2: node('a2', 'u2', [], 'assistant', S.csv, 180, { model_slug: 'sample-model' }),
      },
    }];
    var claude = [{
      uuid: 'sample-claude-1', name: S.t2, created_at: '2026-02-03T00:00:00Z', updated_at: '2026-02-03T00:05:00Z',
      chat_messages: [
        { uuid: 'm1', sender: 'human', created_at: '2026-02-03T00:00:00Z', text: S.h1, content: [{ type: 'text', text: S.h1 }], attachments: [{ file_name: S.att }], files: [] },
        { uuid: 'm2', sender: 'assistant', created_at: '2026-02-03T00:00:20Z', text: S.a2, content: [{ type: 'text', text: S.a2 }], attachments: [], files: [] },
      ],
    }];
    return [{ path: 'chatgpt/conversations.json', text: JSON.stringify(gpt) }, { path: 'claude/conversations.json', text: JSON.stringify(claude) }];
  }

  var api = {
    fail: fail, toDate: toDate, localDate: localDate, localTime: localTime, isoLocal: isoLocal,
    ArraySplitter: ArraySplitter, lineOfError: lineOfError, detect: detect, normalize: normalize, newStats: newStats,
    fromChatGPT: fromChatGPT, fromClaude: fromClaude, fence: fence,
    LABELS: LABELS, toMarkdown: toMarkdown, toCombinedMarkdown: toCombinedMarkdown,
    safeName: safeName, utf8Len: utf8Len, filePaths: filePaths, matches: matches, isConversationsFile: isConversationsFile, makeSample: makeSample,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);

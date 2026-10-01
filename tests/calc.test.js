// 読み方と書き方のテスト: node --test tests/*.test.js
// 試料は 2 種類（README「試料とライセンス」）:
//   tests/fixtures/ai-chat-md-export/ … sugurutakahashi-1234/ai-chat-md-export（MIT）の examples をそのまま写したもの
//   tests/fixtures/synthetic/        … 公開の変換器の資料に合わせて手で作った架空の試料（make.cjs）
// どちらにも本物の会話は無い
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../calc.js');
const K = require('../constants.js');

const FX = path.join(__dirname, 'fixtures');
const read = (p) => fs.readFileSync(path.join(FX, p), 'utf8');
const TZ = 'Asia/Tokyo';
const O = { lang: 'ja', tz: TZ, style: 'heading' };

/** 文字列を size 文字ずつ splitter に入れ、[行, 要素] を返す */
function split(text, size) {
  const out = [];
  const s = new C.ArraySplitter((t, line, i) => out.push({ t, line, i }));
  for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
  s.end();
  return out;
}
function load(file) {
  const st = C.newStats();
  return { list: split(read(file), 4096).map((x) => C.normalize(typeof x.t === 'string' ? JSON.parse(x.t) : x.t, st)), st };
}

test('constants: すべての出典に url・確認日・英語の文', () => {
  assert.match(K.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  for (const [k, s] of Object.entries(K.SOURCES)) {
    assert.ok(s.label && s.value && s.source && s.url && s.checked && s.kind, k);
    assert.ok(s.en && s.en.label && s.en.value && s.en.source, k);
  }
});

test('ArraySplitter: どこで区切って渡しても同じ要素・同じ行（文字列の中の括弧・エスケープは数えない）', () => {
  const text = '﻿[\n {"a": "x]}{[\\"", "b": [1, {"c": 2}]},\n\n {"d": "\\\\"},\n "str", 5\n]\n';
  const want = split(text, text.length);
  assert.deepEqual(want.map((x) => [x.line, x.t]), [[2, '{"a": "x]}{[\\"", "b": [1, {"c": 2}]}'], [4, '{"d": "\\\\"}'], [5, '"str"']]);
  for (const n of [1, 2, 3, 7, 13]) assert.deepEqual(split(text, n).map((x) => [x.line, x.t]), want.map((x) => [x.line, x.t]), 'size ' + n);
});

test('ArraySplitter: {"conversations": [...]} の形も読む。配列でない・途中で切れた・空は行つきで断る', () => {
  const obj = split('{"conversations": [{"uuid": "a"}, {"uuid": "b"}]}', 5);
  assert.deepEqual(obj.map((x) => x.t.uuid), ['a', 'b']);
  assert.throws(() => split('\n\n"abc"', 3), (e) => e.code === 'notJson' && e.arg === 3);
  assert.throws(() => split('[\n{"a":1},\n{"b":', 4), (e) => e.code === 'truncated' && e.arg === 3);
  assert.throws(() => split('  \n ', 2), (e) => e.code === 'empty');
  assert.throws(() => split('[{"a":1}] x', 2), (e) => e.code === 'badJson');
});

test('lineOfError: JSON.parse の例外から何行目かを出す', () => {
  const t = '{\n"a": 1\n"b": 2}';
  let err; try { JSON.parse(t); } catch (e) { err = e; }
  assert.equal(C.lineOfError(t, err), 2);   // 0 始まりの差（3 行目）
});

test('ai-chat-md-export の試料（ChatGPT）: current_node が無くても根から順にたどる', () => {
  const { list } = load('ai-chat-md-export/chatgpt-conversations.json');
  assert.deepEqual(list.map((c) => [c.source, c.title, c.messages.length]), [['chatgpt', 'Math Question', 4], ['chatgpt', 'Code Help', 4]]);
  const c = list[0];
  assert.equal(c.created.toISOString(), '2025-01-15T00:00:00.000Z');   // create_time 1736899200（epoch 秒）
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(c.messages[0].text, 'What is the square root of 144?');
  // コードブロックはそのまま残る
  assert.ok(list[1].messages[1].text.includes('```python\ntext = "hello"'));
});

test('ai-chat-md-export の試料（Claude）: 題名・日時・発言の順', () => {
  const { list } = load('ai-chat-md-export/claude-conversations.json');
  assert.deepEqual(list.map((c) => [c.source, c.id, c.title, c.messages.length]), [['claude', 'conv-weather-123', 'Weather Chat', 4], ['claude', 'conv-recipe-456', 'Recipe Help', 4]]);
  assert.deepEqual(list[0].messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(list[0].updated.toISOString(), '2025-01-14T09:35:00.000Z');
});

test('ChatGPT の枝: current_node から根へ。編集・再生成の古い枝・システム・考え・見えない発言は入れない', () => {
  const { list, st } = load('synthetic/chatgpt-conversations.json');
  const c = list[0];
  const all = c.messages.map((m) => m.text).join('\n');
  for (const no of ['OLD', 'hidden system prompt', 'HIDDEN']) assert.ok(!all.includes(no), no);
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(c.otherBranch, 3);   // 入れなかった枝の発言 a1old・u2old・a2old（sys・th・hid は枝の上なので数えない）
  assert.equal(c.model, 'model-b');  // 最後の答えのモデル
  // 画像（asset_pointer）と添付（metadata.attachments）は名前だけ
  assert.deepEqual(c.messages[2].attachments, ['file_00000000abc', 'report.pdf']);
  // コード実行: 中に ``` があっても壊れない囲み、出力はコードブロック
  assert.equal(c.messages[3].text, '````python\nprint("hi")\n```inner```\n````');
  assert.equal(c.messages[4].text, '```\nhi\n```');
  // 時刻なし・題名なし・知らない content_type は中の文字だけ
  assert.equal(list[1].title, null);
  assert.equal(list[1].created, null);
  assert.equal(list[1].messages[1].text, 'Text in an unknown type');
  assert.equal(st.unknown.future_type_x, 1);
});

test('Claude の枝: current_leaf_message_uuid から親へ。thinking・tool_result は入れず、ツール名と添付の名前だけ', () => {
  const { list } = load('synthetic/claude-conversations.json');
  const c = list[0];
  assert.deepEqual(c.messages.map((m) => m.text), ['Hello', 'Let me check.\n\nDone.\n\n```bash\necho ok\n```', 'Thanks', 'You are welcome.', 'Bye']);
  assert.equal(c.otherBranch, 2);
  assert.deepEqual(c.messages[0].attachments, ['notes.txt', 'photo.png']);
  assert.deepEqual(c.messages[1].tools, ['web_search']);
  const md = C.toMarkdown(c, O);
  for (const no of ['SECRET EXTRACTED TEXT', 'HIDDEN THINKING', 'RAW TOOL OUTPUT', 'OLD']) assert.ok(!md.includes(no), no);
  // 古い形（text だけ・親なし）: created_at で並べ直し、ツールの決まり文句を消す
  assert.deepEqual(list[1].messages.map((m) => m.text), ['First (question)', 'Second (answer)', 'After tool']);
  assert.equal(list[1].title, null);
});

test('Claude の枝: current_leaf が無ければいちばん深い枝。同じ深さなら新しいほう。根が複数なら古い順につなぐ', () => {
  const m = (uuid, parent, min, text) => ({ uuid, parent_message_uuid: parent, sender: 'human', created_at: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString(), text });
  const c = C.fromClaude({ uuid: 'x', chat_messages: [
    m('r', null, 0, 'r'), m('a', 'r', 1, 'a'), m('b', 'a', 2, 'b'), m('c', 'b', 3, 'c'),
    m('x', 'a', 9, 'x-shallow-newer'),
    m('y', 'c', 4, 'y-old'), m('z', 'c', 5, 'z-new'),
    m('r2', 'missing-parent', 7, 'r2'), m('s2', 'r2', 8, 's2'),
  ] }, C.newStats());
  assert.deepEqual(c.messages.map((x) => x.text), ['r', 'a', 'b', 'c', 'z-new', 'r2', 's2']);
  // 循環しても止まる
  const loop = C.fromClaude({ uuid: 'l', current_leaf_message_uuid: 'p', chat_messages: [m('p', 'q', 1, 'p'), m('q', 'p', 0, 'q')] }, C.newStats());
  assert.deepEqual(loop.messages.map((x) => x.text), ['q', 'p']);
});

test('形の見分け: ChatGPT・Claude 以外は unknownShape', () => {
  assert.equal(C.detect({ mapping: {} }), 'chatgpt');
  assert.equal(C.detect({ chat_messages: [] }), 'claude');
  assert.throws(() => C.normalize({ something: 1 }, C.newStats()), (e) => e.code === 'unknownShape');
  assert.throws(() => C.normalize([1, 2], C.newStats()), (e) => e.code === 'unknownShape');
});

test('toMarkdown: frontmatter（題名・出どころ・ID・日時・モデル・発言の数）と見出し', () => {
  const { list } = load('synthetic/chatgpt-conversations.json');
  const md = C.toMarkdown(list[0], O);
  assert.ok(md.startsWith([
    '---',
    'title: "Branch test: edit and regenerate"',
    'source: ChatGPT',
    'id: "gpt-branch-0001"',
    'created: 2026-01-01T09:00:00+09:00',
    'updated: 2026-01-01T09:10:00+09:00',
    'model: "model-b"',
    'messages: 6',
    '---',
    '# Branch test: edit and regenerate',
    '',
    '## ユーザー（2026-01-01 09:00）',
    '',
    'First question',
  ].join('\n')), md);
  assert.ok(md.includes('- 添付: `report.pdf`'));
  // 題名の " と \ は YAML でエスケープ
  const q = C.toMarkdown({ source: 'claude', id: 'q', title: 'a "b" \\ c', created: null, updated: null, model: null, messages: [] }, O);
  assert.ok(q.includes('title: "a \\"b\\" \\\\ c"'));
  // 英語の画面では英語の言葉
  assert.ok(C.toMarkdown(list[0], { ...O, lang: 'en' }).includes('## User (2026-01-01 09:00)'));
});

test('toMarkdown: コールアウト（Obsidian）。コードブロックも各行に > が付く', () => {
  const { list } = load('synthetic/claude-conversations.json');
  const md = C.toMarkdown(list[0], { ...O, style: 'callout' });
  assert.ok(md.includes('> [!question] ユーザー（2026-02-01 09:00）\n> Hello\n>\n> - 添付: `notes.txt`'));
  assert.ok(md.includes('> ```bash\n> echo ok\n> ```'));
  assert.ok(md.includes('> *使ったツール: web_search*'));
});

test('toCombinedMarkdown: frontmatter は 1 つ、会話ごとに # 題名と情報の箇条書き', () => {
  const a = load('ai-chat-md-export/claude-conversations.json').list;
  const md = C.toCombinedMarkdown(a, O);
  assert.equal(md.match(/^---$/gm).length, 2);
  assert.ok(md.startsWith('---\ntitle: "AI 会話ログ"\nconversations: 2\nfrom: 2025-01-14\nto: 2025-01-17\n---\n'));
  assert.ok(md.includes('# Weather Chat\n\n- 出どころ: Claude\n- 作成: 2025-01-14 18:30'));
  assert.equal(md.match(/^# /gm).length, 2);
});

test('safeName: Windows・macOS・Obsidian で使えない文字、予約名、長さ', () => {
  assert.equal(C.safeName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), 'a_b_c_d_e_f_g_h_i_j_k_l_m_n');
  assert.equal(C.safeName('  ..隠し.  '), '隠し');
  assert.equal(C.safeName('CON'), 'CON_');
  assert.equal(C.safeName('lpt1.txt'), 'lpt1.txt_');
  assert.equal(C.safeName('改行\nと\tタブ'), '改行_と_タブ');
  const long = C.safeName('あ'.repeat(100));
  assert.equal(long, 'あ'.repeat(50));            // 150 バイト（3 バイト × 50）で止まる
  assert.equal(C.safeName('a'.repeat(100)).length, 60);
  const emoji = C.safeName('😀'.repeat(60));       // サロゲートペアを途中で切らない
  assert.equal(emoji, '😀'.repeat(37));
  assert.equal(C.utf8Len(emoji), 148);
  assert.equal(C.safeName('ｶﾞ'.normalize('NFD')), 'ｶﾞ'.normalize('NFC'));
});

test('filePaths: 日付＋題名、年・月のフォルダ、出どころのフォルダ、大文字小文字だけ違う名前の重なり', () => {
  const d = new Date('2025-12-31T16:00:00Z');   // 日本時間 2026-01-01 01:00
  const convs = [
    { source: 'chatgpt', title: 'Hello', created: d },
    { source: 'chatgpt', title: 'hello', created: d },
    { source: 'claude', title: null, created: null },
    { source: 'claude', title: 'Hello', created: d },
  ];
  assert.deepEqual(C.filePaths(convs, { ...O, folder: 'none' }), ['2026-01-01 Hello.md', '2026-01-01 hello (2).md', '無題.md', '2026-01-01 Hello (3).md']);
  assert.deepEqual(C.filePaths(convs, { ...O, folder: 'month', bySource: true }), ['ChatGPT/2026/2026-01/2026-01-01 Hello.md', 'ChatGPT/2026/2026-01/2026-01-01 hello (2).md', 'Claude/日付なし/無題.md', 'Claude/2026/2026-01/2026-01-01 Hello.md']);
  assert.deepEqual(C.filePaths(convs, { ...O, lang: 'en', folder: 'year', tz: 'UTC' }), ['2025/2025-12-31 Hello.md', '2025/2025-12-31 hello (2).md', 'no-date/Untitled.md', '2025/2025-12-31 Hello (3).md']);
});

test('matches: 期間（作成日・タイムゾーン）、題名の言葉（全角半角・大小を区別しない）、出どころ', () => {
  const c = { source: 'claude', title: 'Ｐｙｔｈｏｎ の質問', created: new Date('2025-12-31T16:00:00Z') };
  assert.ok(C.matches(c, { from: '2026-01-01', to: '2026-01-01' }, TZ));
  assert.ok(!C.matches(c, { from: '2026-01-01' }, 'UTC'));
  assert.ok(C.matches(c, { q: 'python 質問' }, TZ));
  assert.ok(!C.matches(c, { q: 'python 回答' }, TZ));
  assert.ok(!C.matches(c, { source: 'chatgpt' }, TZ));
  assert.ok(C.matches(c, { source: 'all' }, TZ));
  assert.ok(!C.matches({ ...c, created: null }, { from: '2020-01-01' }, TZ));
});

test('isConversationsFile: conversations.json と分かれた conversations-000.json だけ', () => {
  for (const ok of ['conversations.json', 'export/conversations.json', 'conversations-000.json', 'a\\conversations-12.json']) assert.ok(C.isConversationsFile(ok), ok);
  for (const no of ['shared_conversations.json', 'user.json', 'conversations.json.bak', 'my-conversations.json']) assert.ok(!C.isConversationsFile(no), no);
});

test('時刻: タイムゾーンのずれ（夏時間）と epoch 秒の小数', () => {
  assert.equal(C.isoLocal(new Date('2026-07-01T12:00:00Z'), 'America/New_York'), '2026-07-01T08:00:00-04:00');
  assert.equal(C.isoLocal(new Date('2026-01-01T12:00:00Z'), 'America/New_York'), '2026-01-01T07:00:00-05:00');
  assert.equal(C.isoLocal(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata'), '2026-01-01T05:30:00+05:30');
  assert.equal(C.toDate(1736899200.789).toISOString(), '2025-01-15T00:00:00.789Z');
  assert.equal(C.toDate('2025-01-14T09:30:00.000Z').getTime(), Date.UTC(2025, 0, 14, 9, 30));
  assert.equal(C.toDate('not a date'), null);
  assert.equal(C.toDate(null), null);
});

test('見本: 2 つのファイル、架空の会話（作り直す前の答えは入らない）', () => {
  for (const lang of ['ja', 'en']) {
    const files = C.makeSample(lang);
    assert.equal(files.length, 2);
    const st = C.newStats();
    const convs = files.flatMap((f) => JSON.parse(f.text).map((x) => C.normalize(x, st)));
    assert.deepEqual(convs.map((c) => c.messages.length), [4, 2]);
    assert.ok(!convs[0].messages.some((m) => /作り直す前|before regenerating/.test(m.text)));
  }
});

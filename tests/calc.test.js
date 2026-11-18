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

test('monthCounts: 見本の会話は 2026 年の 1 月と 2 月に 1 件ずつ', () => {
  for (const lang of ['ja', 'en']) {
    const st = C.newStats();
    const convs = C.makeSample(lang).flatMap((f) => JSON.parse(f.text).map((x) => C.normalize(x, st)));
    const g = C.monthCounts(convs, TZ);
    assert.deepEqual(g.years, [{ year: 2026, months: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }], lang);
    assert.equal(g.max, 1);
  }
});

test('monthCounts: 年をまたぐ（古い年が上、間の年は 0 の行）・月の終わりの 23:59 と次の月の 0:00', () => {
  const at = (s) => ({ created: new Date(s) });
  const g = C.monthCounts([
    at('2026-04-15T12:00:00Z'), at('2024-12-31T23:59:59Z'), at('2026-03-31T23:59:00Z'), at('2026-04-01T00:00:00Z'),
  ], 'UTC');
  assert.deepEqual(g.years.map((y) => y.year), [2024, 2025, 2026]);
  assert.equal(g.years[0].months[11], 1);
  assert.deepEqual(g.years[1].months, Array(12).fill(0));
  assert.deepEqual(g.years[2].months.slice(2, 4), [1, 2]);
  assert.equal(g.max, 2);
  // epoch ミリ秒でも、前もって出した date でも同じ
  assert.equal(C.monthCounts([{ created: Date.UTC(2026, 3, 1) }], 'UTC').years[0].months[3], 1);
  assert.equal(C.monthCounts([{ created: new Date(0), date: '2026-05-02' }], 'UTC').years[0].months[4], 1);
});

test('monthCounts: タイムゾーンで月が変わる（端末の時刻で数える）', () => {
  const c = [{ created: new Date('2026-01-31T16:00:00Z') }];   // 東京では 2 月 1 日 1:00
  assert.equal(C.monthCounts(c, 'UTC').years[0].months[0], 1);
  assert.equal(C.monthCounts(c, 'Asia/Tokyo').years[0].months[0], 0);
  assert.equal(C.monthCounts(c, 'Asia/Tokyo').years[0].months[1], 1);
  const ny = [{ created: new Date('2026-03-01T03:00:00Z') }];   // New York では 2 月 28 日
  assert.equal(C.monthCounts(ny, 'America/New_York').years[0].months[1], 1);
});

test('monthCounts: 0 件・作った日の無い会話は数えない', () => {
  assert.deepEqual(C.monthCounts([], TZ), { years: [], max: 0 });
  assert.deepEqual(C.monthCounts(null, TZ), { years: [], max: 0 });
  assert.deepEqual(C.monthCounts([{ created: null }, { created: undefined }], TZ), { years: [], max: 0 });
  const g = C.monthCounts([{ created: null }, { created: new Date('2026-06-10T00:00:00Z') }], 'UTC');
  assert.equal(g.years[0].months.reduce((a, b) => a + b, 0), 1);
});

test('weekHourCounts: 升の数の合計 ＝ 作った日時の在る会話の数（試料と、日時の無い会話を混ぜたもの）', () => {
  const st = C.newStats();
  const convs = ['synthetic/chatgpt-conversations.json', 'synthetic/claude-conversations.json', 'ai-chat-md-export/chatgpt-conversations.json', 'ai-chat-md-export/claude-conversations.json']
    .flatMap((f) => JSON.parse(read(f)).map((x) => C.normalize(x, st)))
    .concat([{ created: null }, { created: undefined }]);
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    const g = C.weekHourCounts(convs, tz);
    assert.equal(g.rows.length, 7);
    assert.ok(g.rows.every((r) => r.length === 24));
    assert.equal(g.rows.flat().reduce((a, b) => a + b, 0), convs.filter((c) => c.created).length, tz);
    assert.equal(g.max, Math.max(...g.rows.flat()));
  }
  assert.deepEqual(C.weekHourCounts([], TZ).max, 0);
  assert.deepEqual(C.weekHourCounts(null, TZ).rows.flat(), Array(168).fill(0));
});

test('weekHour: 週の始まりは月曜（0）、日曜は 6。23 時と 0 時・日曜と月曜の境', () => {
  const w = (s, tz) => C.weekHour(new Date(s), tz);
  assert.deepEqual(w('2026-01-04T23:59:59Z', 'UTC'), { dow: 6, hour: 23 });   // 2026-01-04 は日曜
  assert.deepEqual(w('2026-01-05T00:00:00Z', 'UTC'), { dow: 0, hour: 0 });
  assert.deepEqual(w('2026-01-10T12:00:00Z', 'UTC'), { dow: 5, hour: 12 });   // 土曜
});

test('weekHour: タイムゾーンで曜日と時刻が変わる（端末の時刻で数える）', () => {
  const w = (s, tz) => C.weekHour(new Date(s), tz);
  assert.deepEqual(w('2026-01-04T15:00:00Z', 'UTC'), { dow: 6, hour: 15 });
  assert.deepEqual(w('2026-01-04T15:00:00Z', 'Asia/Tokyo'), { dow: 0, hour: 0 });   // 東京では月曜 0 時
  assert.deepEqual(w('2026-01-04T14:59:59Z', 'Asia/Tokyo'), { dow: 6, hour: 23 });
  assert.deepEqual(w('2026-01-05T03:00:00Z', 'America/New_York'), { dow: 6, hour: 22 });   // New York では日曜 22 時
});

test('weekHourCounts: 夏時間の在る時間帯（New York。2026-03-08 に 2 時が無く、2026-11-01 に 1 時が 2 回）', () => {
  const ny = 'America/New_York';
  const at = (s) => ({ created: new Date(s) });
  const spring = C.weekHourCounts([at('2026-03-08T06:30:00Z'), at('2026-03-08T07:30:00Z')], ny);   // 1:30 EST と 3:30 EDT（日曜）
  assert.equal(spring.rows[6][1], 1);
  assert.equal(spring.rows[6][2], 0);
  assert.equal(spring.rows[6][3], 1);
  const fall = C.weekHourCounts([at('2026-11-01T05:30:00Z'), at('2026-11-01T06:30:00Z')], ny);   // 1:30 EDT と 1:30 EST（日曜）
  assert.equal(fall.rows[6][1], 2);
  assert.equal(fall.max, 2);
});

test('weekHourCounts: 前もって出した dow・hour があればそれを使う、epoch ミリ秒でも数える', () => {
  assert.equal(C.weekHourCounts([{ created: new Date(0), dow: 2, hour: 7 }], 'UTC').rows[2][7], 1);
  assert.equal(C.weekHourCounts([{ created: Date.UTC(2026, 0, 5, 9) }], 'UTC').rows[0][9], 1);
});

test('matches: 月の升と曜日 × 時刻の升を両方押した一覧 ＝ 両方に合う会話', () => {
  const at = (s) => ({ title: 'x', source: 'claude', created: new Date(s) });
  const list = [
    at('2026-01-05T09:10:00Z'),   // 1 月・月曜 9 時 … 両方に合う
    at('2026-01-12T09:59:00Z'),   // 1 月・月曜 9 時 … 両方に合う
    at('2026-01-05T10:00:00Z'),   // 1 月・月曜 10 時
    at('2026-02-02T09:00:00Z'),   // 2 月・月曜 9 時
    at('2026-01-06T09:00:00Z'),   // 1 月・火曜 9 時
    { title: 'x', source: 'claude', created: null },
  ];
  const f = { from: '2026-01-01', to: '2026-01-31', wh: { dow: 0, hour: 9 } };
  const got = list.filter((c) => C.matches(c, f, 'UTC'));
  const want = list.filter((c) => c.created && C.matches(c, { from: f.from, to: f.to }, 'UTC') && C.matches(c, { wh: f.wh }, 'UTC'));
  assert.deepEqual(got, want);
  assert.equal(got.length, 2);
  assert.equal(list.filter((c) => C.matches(c, { wh: f.wh }, 'UTC')).length, 3);
  assert.equal(list.filter((c) => C.matches(c, { wh: f.wh }, 'Asia/Tokyo')).length, 0);   // 東京では月曜 18 時
});

/** 1 万件・5 年分の試料（2021〜2025 年。200 件に 1 件は作った日時が無い → 50 件）。乱数は固定の式 */
function tenThousand() {
  const out = [], t0 = Date.UTC(2021, 0, 1), span = Date.UTC(2026, 0, 1) - t0;
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 10000; i++) out.push({ title: 't' + (i % 7), source: i % 3 ? 'claude' : 'chatgpt', created: i % 200 === 199 ? null : new Date(t0 + Math.floor(rnd() * span)) });
  return out;
}

test('dayCounts: 升の合計 ＝ 作った日時の在る会話の数（1 万件の試料で 9,950。fixtures と日時の無い会話を混ぜたもの）', () => {
  const big = tenThousand();
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    const g = C.dayCounts(big, tz);
    assert.equal(g.years.reduce((a, y) => a + y.days.reduce((b, n) => b + n, 0), 0), 9950, tz);
    assert.equal(g.max, Math.max(...g.years.flatMap((y) => y.days)));
    assert.ok(g.years.every((y) => y.days.length === C.daysInYear(y.year)));
  }
  const g = C.dayCounts(big, 'UTC');
  assert.deepEqual(g.years.map((y) => y.year), [2021, 2022, 2023, 2024, 2025]);
  const st = C.newStats();
  const convs = ['synthetic/chatgpt-conversations.json', 'synthetic/claude-conversations.json', 'ai-chat-md-export/chatgpt-conversations.json', 'ai-chat-md-export/claude-conversations.json']
    .flatMap((f) => JSON.parse(read(f)).map((x) => C.normalize(x, st)))
    .concat([{ created: null }, { created: undefined }]);
  const h = C.dayCounts(convs, TZ);
  assert.equal(h.years.reduce((a, y) => a + y.days.reduce((b, n) => b + n, 0), 0), convs.filter((c) => c.created).length);
  assert.deepEqual(C.dayCounts([], TZ), { years: [], max: 0 });
  assert.deepEqual(C.dayCounts(null, TZ).years, []);
});

test('dayCounts: 間の年は 0 の段で入る、前もって出した date があればそれを使う', () => {
  const g = C.dayCounts([{ created: new Date(0), date: '2022-03-04' }, { created: Date.UTC(2024, 0, 1) }], 'UTC');
  assert.deepEqual(g.years.map((y) => y.year), [2022, 2023, 2024]);
  assert.equal(g.years[0].days[C.dayCell('2022-03-04').doy], 1);
  assert.ok(g.years[1].days.every((n) => n === 0));
  assert.equal(g.years[2].days[0], 1);
});

test('dayCell・addDays: 年をまたぐ週（12 月 31 日は前の年の段の最後の列、1 月 1 日は次の年の段の最初の列）', () => {
  // 2025-12-31 は水曜、2026-01-01 は木曜
  assert.deepEqual(C.dayCell('2025-12-31'), { year: 2025, doy: 364, col: 52, row: 2 });
  assert.deepEqual(C.dayCell('2026-01-01'), { year: 2026, doy: 0, col: 0, row: 3 });
  assert.deepEqual(C.dayCell('2026-01-05'), { year: 2026, doy: 4, col: 1, row: 0 });   // 次の月曜は次の列の上
  assert.equal(C.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(C.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(C.addDays('2025-12-29', 7), '2026-01-05');
  assert.equal(C.dayAt(2026, 0, 0), '2026-01-01');     // 1 月 1 日より前の升は、その年の 1 月 1 日
  assert.equal(C.dayAt(2026, 52, 6), '2026-12-31');    // 12 月 31 日（木曜）より後の升は、その年の 12 月 31 日
  assert.equal(C.dayAt(2026, 1, 0), '2026-01-05');
});

test('dayCell・addDays・weekCols: うるう年（2 月 29 日・12 月 31 日が 366 日目、1 月 1 日が日曜のうるう年だけ 54 列）', () => {
  assert.equal(C.daysInYear(2024), 366);
  assert.equal(C.daysInYear(2025), 365);
  assert.equal(C.daysInYear(2000), 366);
  assert.equal(C.daysInYear(2100), 365);
  assert.equal(C.dayCell('2024-02-29').doy, 59);
  assert.equal(C.dayCell('2024-12-31').doy, 365);
  assert.equal(C.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(C.addDays('2023-02-28', 1), '2023-03-01');
  assert.equal(C.weekCols(2026), 53);
  assert.equal(C.weekCols(2024), 53);
  assert.equal(C.weekCols(2012), 54);   // 2012-01-01 は日曜
  assert.equal(C.dayCounts([{ created: Date.UTC(2024, 1, 29, 12) }], 'UTC').years[0].days[59], 1);
});

test('dayCounts・addDays: 夏時間の日（New York。2026-03-08 は 23 時間、2026-11-01 は 25 時間）も 1 日として数え、1 日ずつ動く', () => {
  const ny = 'America/New_York', at = (s) => ({ created: new Date(s) });
  const g = C.dayCounts([at('2026-03-08T05:30:00Z'), at('2026-03-08T07:30:00Z'), at('2026-03-09T03:59:00Z'), at('2026-03-09T04:00:00Z')], ny);
  const doy = C.dayCell('2026-03-08').doy;
  assert.equal(g.years[0].days[doy], 3);       // 00:30 EST・03:30 EDT・23:59 EDT は 3 月 8 日
  assert.equal(g.years[0].days[doy + 1], 1);   // 00:00 EDT は 3 月 9 日
  const f = C.dayCounts([at('2026-11-01T04:30:00Z'), at('2026-11-01T05:30:00Z'), at('2026-11-01T06:30:00Z'), at('2026-11-02T04:59:00Z')], ny);
  assert.equal(f.years[0].days[C.dayCell('2026-11-01').doy], 4);   // 00:30 EDT・1:30 EDT・1:30 EST・23:59 EST
  assert.equal(C.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(C.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(C.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(C.addDays('2026-11-02', -1), '2026-11-01');
});

test('matches: 日・月・曜日 × 時刻の 3 つの絞り込みを掛けた一覧 ＝ 手で数えた数（1 万件の試料、3 通り）', () => {
  const big = tenThousand();
  // 手で数える: calc.js を使わず、UTC の Date の値だけで
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const hand = (day, from, to, wh) => big.filter((c) => {
    if (!c.created) return false;
    const s = dayOf(c.created);
    return (!day || s === day) && (!from || (s >= from && s <= to)) && (!wh || ((c.created.getUTCDay() + 6) % 7 === wh.dow && c.created.getUTCHours() === wh.hour));
  }).length;
  const busiest = Object.entries(big.reduce((a, c) => { if (c.created) { const s = dayOf(c.created); a[s] = (a[s] || 0) + 1; } return a; }, {})).sort((a, b) => b[1] - a[1])[0][0];
  const wd = new Date(busiest + 'T00:00:00Z'), whOfBusiest = { dow: (wd.getUTCDay() + 6) % 7, hour: big.find((c) => c.created && dayOf(c.created) === busiest).created.getUTCHours() };
  const cases = [
    { day: busiest, from: busiest.slice(0, 8) + '01', to: C.monthRange(+busiest.slice(0, 4), +busiest.slice(5, 7)).to, wh: null },   // 日と、その日の月
    { day: busiest, from: busiest.slice(0, 8) + '01', to: C.monthRange(+busiest.slice(0, 4), +busiest.slice(5, 7)).to, wh: whOfBusiest },   // 3 つとも合う
    { day: busiest, from: '2021-01-01', to: '2021-01-31', wh: whOfBusiest },   // 日と月が食い違う（0 件、ただし日が 2021 年 1 月なら 1 件以上）
  ];
  const got = cases.map((k) => big.filter((c) => C.matches(c, { day: k.day, from: k.from, to: k.to, wh: k.wh }, 'UTC')).length);
  assert.deepEqual(got, cases.map((k) => hand(k.day, k.from, k.to, k.wh)));
  assert.ok(got[0] >= got[1] && got[1] >= 1);
  assert.equal(big.filter((c) => C.matches(c, { day: busiest }, 'UTC')).length, hand(busiest));
  assert.equal(big.filter((c) => C.matches(c, { day: '2030-01-01' }, 'UTC')).length, 0);
});

test('matches: 日の絞り込みは端末のタイムゾーンの日付で、作った日時の無い会話は外れる', () => {
  const c = { title: 'x', source: 'claude', created: new Date('2026-01-04T15:30:00Z') };
  assert.ok(C.matches(c, { day: '2026-01-04' }, 'UTC'));
  assert.ok(C.matches(c, { day: '2026-01-05' }, 'Asia/Tokyo'));
  assert.ok(!C.matches(c, { day: '2026-01-04' }, 'Asia/Tokyo'));
  assert.ok(!C.matches({ title: 'x', source: 'claude', created: null }, { day: '2026-01-04' }, 'UTC'));
  assert.ok(C.matches({ title: 'x', source: 'claude', created: new Date(0), date: '2026-02-02' }, { day: '2026-02-02' }, 'UTC'));   // 前もって出した date を使う
});

test('monthLevel: 0 件は 0、ほかは最多の月に対して 1〜4', () => {
  assert.equal(C.monthLevel(0, 10), 0);
  assert.equal(C.monthLevel(0, 0), 0);
  assert.deepEqual([1, 2, 3, 5, 6, 8, 10].map((n) => C.monthLevel(n, 10)), [1, 1, 2, 2, 3, 4, 4]);
  assert.equal(C.monthLevel(1, 1), 4);
});

test('monthRange: 月の初めと終わり（閏年の 2 月・12 月）。その期間の絞り込みの件数 ＝ 升の数', () => {
  assert.deepEqual(C.monthRange(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(C.monthRange(2026, 2), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(C.monthRange(2026, 4), { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual(C.monthRange(2026, 12), { from: '2026-12-01', to: '2026-12-31' });
  const list = ['2026-03-31T23:59:00Z', '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z', '2026-05-01T00:00:00Z'].map((s) => ({ source: 'claude', title: 'x', created: new Date(s) }));
  const n = C.monthCounts(list, 'UTC').years[0].months[3];
  assert.equal(n, 2);
  assert.equal(list.filter((c) => C.matches(c, C.monthRange(2026, 4), 'UTC')).length, n);
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

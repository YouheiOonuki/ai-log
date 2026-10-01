// 読み込みと書き出しの本体（engine.js）のテスト: node --test tests/*.test.js
// 画面の Web Worker と同じものを Node で動かす（File・Blob・DecompressionStream は Node 20 以上にある）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const C = require('../calc.js');
const Z = require('../zip.js');
const { createEngine } = require('../engine.js');

const FX = path.join(__dirname, 'fixtures');
const file = (p, name) => new File([fs.readFileSync(path.join(FX, p))], name || path.basename(p));
const O = { lang: 'ja', tz: 'Asia/Tokyo', style: 'heading', folder: 'none', bySource: false };

/** エンジンを作り、送ったメッセージへの返事（progress 以外）を待つ */
function engine() {
  const out = [];
  let wake = null;
  const e = createEngine(C, Z, (m) => { if (m.type !== 'progress') { out.push(m); if (wake) wake(); } });
  return {
    async send(m) {
      const n = out.length;
      const done = new Promise((ok) => { wake = () => { if (out.length > n) ok(); }; });
      await e.handle(m);
      if (out.length === n) await done;
      return out[out.length - 1];
    },
  };
}

/** deflate で圧縮した zip（書き出しの zip の形） */
function deflateZip(files) {
  const enc = new TextEncoder(), parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = enc.encode(f.text), data = zlib.deflateRawSync(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(Z.crc32(raw), 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(Z.crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    parts.push(loc, Buffer.from(name), data); cen.push(c, Buffer.from(name));
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, e]));
}

test('zip（ChatGPT の分かれた形）と JSON をまとめて読み、同じ会話は 1 つに', async () => {
  const zip = deflateZip([
    { name: 'conversations-000.json', text: fs.readFileSync(path.join(FX, 'synthetic/conversations-000.json'), 'utf8') },
    { name: 'conversations-001.json', text: fs.readFileSync(path.join(FX, 'synthetic/conversations-001.json'), 'utf8') },
    { name: 'user.json', text: '{"email":"never-read@example.com"}' },
    { name: 'shared_conversations.json', text: '[{"id":"x"}]' },
    { name: 'file-abc-image.png', text: 'not read' },
  ]);
  const e = engine();
  const r = await e.send({ type: 'load', files: [new File([zip], 'chatgpt-export.zip'), file('synthetic/chatgpt-conversations.json'), file('synthetic/claude-conversations.json')] });
  assert.equal(r.type, 'loaded');
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.files, 4);          // zip の中の 2 つ＋ JSON 2 つ（user.json などは読まない）
  assert.equal(r.stats.duplicates, 2);     // zip と JSON の両方にある 2 会話
  assert.deepEqual(r.list.map((s) => [s.source, s.title, s.count]), [
    ['chatgpt', 'Branch test: edit and regenerate', 6], ['chatgpt', null, 2],
    ['chatgpt', 'CON: a/b\\c *?"<>|#^[x].', 1], ['chatgpt', 'CON: a/b\\c *?"<>|#^[x].', 1],
    ['claude', 'Claude branch test', 5], ['claude', null, 3],
  ]);
});

test('読めない所は「どのファイルの何行目・何番目の会話」を残して、ほかは読み続ける', async () => {
  const e = engine();
  const r = await e.send({ type: 'load', files: [file('synthetic/broken-conversations.json'), new File(['hello'], 'not.zip'), new File(['x'], 'memo.txt'), new File(['[{"a":1}'], 'cut.json')] });
  assert.deepEqual(r.list.map((s) => s.title), ['ok', 'ok3']);
  assert.deepEqual(r.errors.map((x) => [x.file, x.line, x.index, x.code]), [
    ['not.zip', null, null, 'notZip'],
    ['memo.txt', null, null, 'notTarget'],
    ['broken-conversations.json', 9, 1, 'badJson'],        // 2 番目の会話の 9 行目でカンマが抜けている
    ['broken-conversations.json', 12, 2, 'unknownShape'],  // 3 番目は会話の形ではない
    ['cut.json', 1, 0, 'unknownShape'],                   // 閉じた要素 {"a":1} は会話の形ではない
    ['cut.json', 1, null, 'truncated'],                    // 配列が閉じないまま終わっている
  ]);
});

test('conversations.json の無い zip は理由を出す', async () => {
  const e = engine();
  const r = await e.send({ type: 'load', files: [new File([deflateZip([{ name: 'user.json', text: '{}' }])], 'other.zip')] });
  assert.deepEqual(r.errors.map((x) => [x.file, x.code]), [['other.zip', 'noConversations']]);
  assert.deepEqual(r.list, []);
});

test('zip の往復: 書き出した zip を読み戻すと、会話ごとの Markdown がそのまま入っている', async () => {
  const e = engine();
  const r = await e.send({ type: 'load', files: [file('synthetic/claude-conversations.json'), file('ai-chat-md-export/chatgpt-conversations.json')] });
  const ids = r.list.map((s) => s.n);
  const b = await e.send({ type: 'build', ids, opts: { ...O, folder: 'year', bySource: true } });
  assert.equal(b.kind, 'zip');
  const blob = new Blob([b.bytes]);
  const idx = await Z.readIndex(blob);
  assert.deepEqual(idx.map((x) => x.name), [
    'Claude/2026/2026-02-01 Claude branch test.md', 'Claude/2026/2026-02-01 無題.md',
    'ChatGPT/2025/2025-01-15 Math Question.md', 'ChatGPT/2025/2025-01-16 Code Help.md',
  ]);
  const md = await Z.readText(blob, idx[3]);
  assert.ok(md.startsWith('---\ntitle: "Code Help"\nsource: ChatGPT\ncreated: 2025-01-16T13:00:00+09:00\n'));
  assert.ok(md.includes('```python\ntext = "hello"\nreversed_text = text[::-1]'));
  // 1 つにまとめた形
  const one = await e.send({ type: 'build', ids: [ids[2], ids[3]], opts: { ...O, combined: true } });
  assert.equal(one.kind, 'md');
  const text = new TextDecoder().decode(one.bytes);
  assert.ok(text.startsWith('---\ntitle: "AI 会話ログ"\nconversations: 2\n'));
  // 見本（画面の一覧で押したとき）
  const p = await e.send({ type: 'preview', id: ids[0], opts: O });
  assert.equal(p.path, '2026-02-01 Claude branch test.md');
  assert.ok(p.text.includes('# Claude branch test'));
});

test('見本（文字列の { path, text }）も同じ道で読める', async () => {
  const e = engine();
  const r = await e.send({ type: 'load', files: C.makeSample('ja') });
  assert.deepEqual(r.list.map((s) => [s.source, s.count]), [['chatgpt', 4], ['claude', 2]]);
  assert.equal(r.stats.otherBranch, 1);
  assert.equal(r.stats.attachments, 1);
});

test('大きめの書き出し（会話 3,000 件・約 9MB の deflate zip）を要素ごとに読む', async () => {
  const many = [];
  for (let i = 0; i < 3000; i++) {
    many.push({
      title: 'Synthetic ' + i, conversation_id: 'syn-' + i, create_time: 1767225600 + i * 3600, update_time: 1767225600 + i * 3600 + 60, current_node: 'b',
      mapping: {
        r: { id: 'r', parent: null, children: ['a'], message: null },
        a: { id: 'a', parent: 'r', children: ['b'], message: { id: 'a', author: { role: 'user' }, create_time: 1767225600 + i * 3600, content: { content_type: 'text', parts: ['q'.repeat(1000) + ' "]}{[' + i] }, metadata: {} } },
        b: { id: 'b', parent: 'a', children: [], message: { id: 'b', author: { role: 'assistant' }, create_time: 1767225600 + i * 3600 + 5, content: { content_type: 'text', parts: ['```\ncode ' + i + '\n```\n' + 'x'.repeat(1500)] }, metadata: { model_slug: 'm' } } },
      },
    });
  }
  const text = JSON.stringify(many);
  assert.ok(text.length > 8e6);
  const e = engine();
  const t0 = Date.now();
  const r = await e.send({ type: 'load', files: [new File([deflateZip([{ name: 'conversations.json', text }])], 'big.zip')] });
  const ms = Date.now() - t0;
  assert.equal(r.list.length, 3000);
  assert.deepEqual(r.errors, []);
  assert.equal(r.list[2999].title, 'Synthetic 2999');
  assert.ok(ms < 20000, ms + ' ms');
});

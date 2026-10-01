// zip の読み書きのテスト: node --test tests/*.test.js
// 圧縮した zip は Node の zlib（deflateRawSync）で組み立てて、ブラウザと同じ DecompressionStream で読む
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Z = require('../zip.js');

// 最小の zip を組み立てる（zip64: true なら 32 ビットの欄を 0xFFFFFFFF にして ZIP64 の拡張と EOCD64 に本当の値を書く）
function buildZip(files, opt) {
  opt = opt || {};
  const enc = new TextEncoder(), locals = [], cens = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = enc.encode(f.text);
    const data = f.store ? raw : zlib.deflateRawSync(raw), method = f.store ? 0 : 8, crc = Z.crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
    const extra = opt.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (opt.zip64) {
      extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(raw.length), 4); extra.writeBigUInt64LE(BigInt(data.length), 12); extra.writeBigUInt64LE(BigInt(off), 20);
    }
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(45, 4); cen.writeUInt16LE(45, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(opt.zip64 ? 0xffffffff : data.length, 20); cen.writeUInt32LE(opt.zip64 ? 0xffffffff : raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(extra.length, 30);
    cen.writeUInt32LE(opt.zip64 ? 0xffffffff : off, 42);
    locals.push(loc, Buffer.from(name), data);
    cens.push(cen, Buffer.from(name), extra);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(cens), tail = [];
  if (opt.zip64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(files.length), 24); e64.writeBigUInt64LE(BigInt(files.length), 32);
    e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(off), 48);
    const loc64 = Buffer.alloc(20);
    loc64.writeUInt32LE(0x07064b50, 0); loc64.writeBigUInt64LE(BigInt(off + cd.length), 8); loc64.writeUInt32LE(1, 16);
    tail.push(e64, loc64);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 8); eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : cd.length, 12); eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : off, 16);
  return new Blob([Buffer.concat(locals.concat([cd], tail, [eocd]))]);
}

const FILES = [
  { name: 'conversations.json', text: JSON.stringify([{ uuid: 'x', name: '見本', chat_messages: [] }]) },
  { name: 'user.json', text: '{"id":"sample"}', store: true },
  { name: '日本語のフォルダ/メモ.txt', text: 'あいうえお'.repeat(500) },
];

test('crc32: 既知の値', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('readIndex / readText: 圧縮（deflate）と無圧縮、UTF-8 の名前', async () => {
  const blob = buildZip(FILES);
  const idx = await Z.readIndex(blob);
  assert.deepEqual(idx.map((e) => e.name), FILES.map((f) => f.name));
  assert.deepEqual(idx.map((e) => e.method), [8, 0, 8]);
  for (let i = 0; i < FILES.length; i++) assert.equal(await Z.readText(blob, idx[i]), FILES[i].text);
});

test('readIndex: ZIP64 の目次（2GB を超える書き出しの形）も読める', async () => {
  const blob = buildZip(FILES, { zip64: true });
  const idx = await Z.readIndex(blob);
  assert.equal(idx.length, 3);
  assert.equal(idx[2].size, new TextEncoder().encode(FILES[2].text).length);
  assert.equal(await Z.readText(blob, idx[2]), FILES[2].text);
});

test('makeZip: 書いた zip を読み戻せる（Markdown の束）', async () => {
  const files = [{ name: 'ChatGPT/2026/2026-01-11 見本.md', text: '---\ntitle: "見本"\n---\n# 見本\n' }, { name: 'Claude/無題.md', text: '# 無題\n' }];
  const bytes = Z.makeZip(files, new Date(2026, 0, 11, 7, 30));
  const blob = new Blob([bytes]);
  const idx = await Z.readIndex(blob);
  assert.deepEqual(idx.map((e) => [e.name, e.method]), [['ChatGPT/2026/2026-01-11 見本.md', 0], ['Claude/無題.md', 0]]);
  assert.equal(await Z.readText(blob, idx[1]), files[1].text);
  // CRC は書いた中身と合う
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(14, true), Z.crc32(new TextEncoder().encode(files[0].text)));
});

test('zip でないもの・壊れたものは理由つきで断る', async () => {
  await assert.rejects(Z.readIndex(new Blob(['hello'])), /zip ではありません/);
  await assert.rejects(Z.readIndex(new Blob(['x'.repeat(100)])), /zip ではありません/);
  const blob = buildZip(FILES);
  const idx = await Z.readIndex(blob);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { encrypted: true })), /パスワード/);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { method: 12 })), /圧縮方式/);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { offset: 5 })), /壊れています/);
});

test('readStream: 展開しながら少しずつ読める（大きな conversations.json 用）', async () => {
  const big = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ uuid: 'c' + i, name: '会話 ' + i, chat_messages: [{ sender: 'human', text: 'x'.repeat(200) }] })));
  const blob = buildZip([{ name: 'conversations.json', text: big }]);
  const [en] = await Z.readIndex(blob);
  const r = await Z.readStream(blob, en);
  const reader = r.stream.getReader(), dec = new TextDecoder();
  let out = '', chunks = 0;
  for (;;) { const x = await reader.read(); if (x.done) break; chunks++; out += dec.decode(x.value, { stream: true }); }
  out += dec.decode();
  assert.equal(out, big);
  assert.ok(chunks >= 1);
  assert.equal(r.compSize, en.compSize);
});

test('makeZip: bytes を渡しても同じ（engine.js は TextEncoder で先に変換して渡す）', async () => {
  const text = '# 見本\n';
  const a = Z.makeZip([{ name: 'a.md', text }], new Date(2026, 0, 1));
  const b = Z.makeZip([{ name: 'a.md', bytes: new TextEncoder().encode(text) }], new Date(2026, 0, 1));
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test('makeZip: 65,535 件を超えると ZIP64 の目次になり、読み戻せる', async () => {
  const files = Array.from({ length: 70000 }, (_, i) => ({ name: 'c/' + i + '.md', text: '' + i }));
  const blob = new Blob([Z.makeZip(files, new Date(2026, 0, 1))]);
  const idx = await Z.readIndex(blob);
  assert.equal(idx.length, 70000);
  assert.equal(await Z.readText(blob, idx[69999]), '69999');
});

// バックアップファイル（書き出し・読み込み）のテスト: node --test tests/*.test.js
// README「ツールを追加するとき」20（決定 D31）
const test = require('node:test');
const assert = require('node:assert/strict');
const { backupFileName, buildBackup, parseBackup } = require('../calc.js');

const TOOL = '__REPO__';
const DATA = { draft: { amount: '1234' } };
const REQUIRED = ['draft'];

test('backupFileName: <ツール名>-backup-YYYYMMDD.json（端末の日付）', () => {
  assert.equal(backupFileName(TOOL, new Date(2026, 8, 24, 23, 59)), TOOL + '-backup-20260924.json');
  assert.equal(backupFileName(TOOL, new Date(2027, 0, 5)), TOOL + '-backup-20270105.json');
});

test('buildBackup: tool・version・exportedAt・data の形', () => {
  const b = buildBackup(TOOL, DATA, new Date('2026-09-24T01:02:03Z'));
  assert.deepEqual(Object.keys(b), ['tool', 'version', 'exportedAt', 'data']);
  assert.equal(b.tool, TOOL);
  assert.equal(b.version, 1);
  assert.equal(b.exportedAt, '2026-09-24T01:02:03.000Z');
  assert.deepEqual(b.data, DATA);
});

test('parseBackup: 書き出したファイルはそのまま読める', () => {
  const r = parseBackup(JSON.stringify(buildBackup(TOOL, DATA)), TOOL, REQUIRED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, DATA);
});

test('parseBackup: ほかのツールのファイルは断る', () => {
  const r = parseBackup(JSON.stringify(buildBackup('other-tool', DATA)), TOOL, REQUIRED);
  assert.equal(r.ok, false);
  assert.match(r.error, /ほかのツール（other-tool）/);
});

test('parseBackup: 壊れた JSON・JSON でないものは断る', () => {
  for (const text of ['{"tool": "' + TOOL, '', 'こんにちは', 'null', '[]', '123']) {
    const r = parseBackup(text, TOOL, REQUIRED);
    assert.equal(r.ok, false, text);
    assert.match(r.error, /読み取れませんでした/);
  }
});

test('parseBackup: 項目が欠けている・形が違うものは断る', () => {
  const ok = buildBackup(TOOL, DATA);
  const cases = [
    Object.assign({}, ok, { tool: undefined }),
    Object.assign({}, ok, { version: undefined }),
    Object.assign({}, ok, { version: '1' }),
    Object.assign({}, ok, { data: undefined }),
    Object.assign({}, ok, { data: [] }),
    Object.assign({}, ok, { data: 'x' }),
  ];
  REQUIRED.forEach((k) => {
    const data = Object.assign({}, DATA);
    delete data[k];
    cases.push(Object.assign({}, ok, { data }));
  });
  cases.forEach((c, i) => {
    const r = parseBackup(JSON.stringify(c), TOOL, REQUIRED);
    assert.equal(r.ok, false, 'case ' + i);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  });
});

test('parseBackup: 新しい版の形式は、その旨を伝えて断る', () => {
  const r = parseBackup(JSON.stringify(Object.assign(buildBackup(TOOL, DATA), { version: 2 })), TOOL, REQUIRED);
  assert.equal(r.ok, false);
  assert.match(r.error, /新しい版/);
});

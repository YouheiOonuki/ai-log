// 使い方などのページに書いた「最終確認日」が、その日付の元の値（constants.js の CHECKED など）と同じか（yorozu-plans ROADMAP 7.256 の 3・7.271、D668）。
// 正本は youheioonuki.github.io の tools/common/guide-date.test.js。このファイルは repo の値を持たない。
// repo の値は、同じフォルダの guide-date.values.json だけが持つ:
//   html     … 日付を HTML に手で書いたページ → 元の値。"ファイル#名前.名前"（repo の最上位から。require で読む）か、
//              "ファイル#oldest:名前"（値の木の中のその名前の日付のうち、いちばん古いもの）。
//              1 つなら、ページの中の日付が全部その値。配列なら、ページの中の順に 1 つずつ
//   drawn    … 日付を HTML に持たず、ページの script が値から描くページ → { "src": "<script src> の値", "values": "値のファイル", "ids": ["描く先の id"] }
//   notTied  … 日付を書いているが、値のファイルに相手が無いページ → 理由
//   skipDirs … ページを探さないフォルダ（node_modules・tests・test・tools・.git・.github のほかに）
// 日付を書いたページが増えて、どれにも無いと落ちる。repo だけの確かめは、同じフォルダの別のテストに置く。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'guide-date.values.json'), 'utf8'));
const KEYS = ['html', 'drawn', 'notTied', 'skipDirs'];
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'tools', '.git', '.github', ...(V.skipDirs || [])]);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 今日は日本時間で数える（UTC だと 0〜9 時に当日の確認日で落ちる）
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// テンプレートのまま（tools/init.mjs が在り、CHECKED が置き換える前の印か、作った日の仮の値）なら、描く確かめは仮の日付で動かす
const TEMPLATE_DATES = ['__DATE__', '2026-11-22'];
const IS_TEMPLATE = fs.existsSync(path.join(ROOT, 'tools', 'init.mjs'));

// "ファイル#名前.名前" の値。"ファイル#oldest:名前" は、値の木の中のその名前の日付のうち、いちばん古いもの
function valueOf(ref) {
  const [file, keys = 'CHECKED'] = ref.split('#');
  const tree = require(path.join(ROOT, file));
  const oldest = /^oldest:(\w+)$/.exec(keys);
  if (oldest) {
    const cs = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (typeof o[oldest[1]] === 'string') cs.push(o[oldest[1]]);
      Object.values(o).forEach(walk);
    })(tree);
    return cs.sort()[0];
  }
  return keys.split('.').reduce((o, k) => (o == null ? o : o[k]), tree);
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 表示の文字（2026-11-12・2026年11月12日・2026 年 11 月 12 日・November 12, 2026）を ISO に
function isoOf(s) {
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[3]}-${pad(MONTHS.indexOf(m[1]) + 1)}-${pad(m[2])}`;
  return null;
}
// 確認日の印: 「最終確認日」「Checked」「Last checked」の直後（dt/dd を挟んでよい）、または id・data-v に checked を持つ要素
const LABEL = /(?:最終確認日は?|[Ll]ast checked|Checked|\(checked)[ :：]?(?:<\/?d[td]>\s*)*$/;
const MARK = /\b(?:id|data-v)="[^"]*[cC]hecked"/;
const DATE = '\\d{4}-\\d{2}-\\d{2}|\\d{4} ?年 ?\\d{1,2} ?月 ?\\d{1,2} ?日|[A-Z][a-z]+ \\d{1,2}, \\d{4}';
// ページの中の確認日を順に返す。{ iso, shown }。空の要素（実行時に書く）は数えない
function datesIn(h) {
  const out = [];
  const re = new RegExp(`<(time|span)\\b([^>]*)>([^<]*)</\\1>|(?:最終確認日は?|[Ll]ast checked)[ :：]?(${DATE})`, 'g');
  for (const m of h.matchAll(re)) {
    if (m[4]) { out.push({ iso: isoOf(m[4]), shown: m[4] }); continue; }
    const before = h.slice(Math.max(0, m.index - 40), m.index);
    if (!MARK.test(m[2]) && !LABEL.test(before)) continue;
    const dt = (m[2].match(/\bdatetime="([^"]*)"/) || [])[1];
    if (m[1] === 'time') { if (dt) out.push({ iso: dt, shown: m[3] }); continue; }
    if (m[3]) out.push({ iso: isoOf(m[3]), shown: m[3] });
  }
  return out;
}

// script を動かすための最小の DOM（描く先の id と、script が作る要素）
function el() {
  return {
    children: [], dataset: {}, style: {}, href: '', textContent: '', dateTime: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this[k] = v; },
  };
}
function runScript(h, valuesFile, from, to) {
  const body = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => /\bCHECKED\b/.test(s));
  assert.ok(body, 'CHECKED を描く script が無い');
  const byId = {}, other = {};   // 確認日を描く先（空の <time id>）と、script が触るそのほかの要素
  for (const m of h.matchAll(/<time datetime="" id="([^"]+)"><\/time>/g)) byId[m[1]] = el();
  const document = {
    getElementById: (id) => byId[id] || (other[id] ||= el()),
    querySelector: () => el(),
    createElement: () => el(),
    createTextNode: (t) => ({ textContent: t }),
  };
  const window = {};
  const ctx = vm.createContext({ window, document });
  let src = read(valuesFile);
  if (from !== undefined) src = src.replace(`'${from}'`, `'${to}'`);
  vm.runInContext(src, Object.assign(ctx, { module: undefined }));
  window.Constants = ctx.Constants; // 値のファイルは this に Constants を置く（ブラウザでは window）
  vm.runInContext(body, ctx);
  return byId;
}

const html = V.html || {};
const drawn = V.drawn || {};
const notTied = V.notTied || {};

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = d ? `${d}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) {
      const h = read(p);
      if (datesIn(h).length || /<time datetime="" id="[^"]*"><\/time>/.test(h) && /最終確認日|Last checked/.test(h)) pages.push(p);
    }
  }
})('');

test('値のファイルは決まった名前だけを、決まった形で持つ', () => {
  for (const k of Object.keys(V)) assert.ok(KEYS.includes(k), `guide-date.values.json の名前 ${k}`);
  for (const [p, w] of Object.entries(html)) assert.ok(typeof w === 'string' || (Array.isArray(w) && w.length && w.every((x) => typeof x === 'string')), `html の ${p}`);
  for (const [p, w] of Object.entries(drawn)) {
    assert.deepEqual(Object.keys(w).sort(), ['ids', 'src', 'values'], `drawn の ${p}`);
    assert.ok(Array.isArray(w.ids) && w.ids.length, `drawn の ${p} の ids`);
  }
  for (const [p, why] of Object.entries(notTied)) assert.ok(typeof why === 'string' && why, `notTied の ${p} に理由が無い`);
  assert.ok(Object.keys(html).length + Object.keys(drawn).length > 0, '確かめるページが 1 つも無い');
});

test('日付を書いたページは全部 html・drawn・notTied のどれかにある（増えたらここに足す）', () => {
  assert.deepEqual(pages.sort(), [...Object.keys(html), ...Object.keys(drawn), ...Object.keys(notTied)].sort());
});

for (const [p, want] of Object.entries(html)) {
  test(`${p} の確認日が元の値と同じ`, () => {
    const ds = datesIn(read(p));
    assert.ok(ds.length > 0, `${p} に日付が無い`);
    for (const x of ds) assert.equal(isoOf(x.shown), x.iso, `${p}: 日付「${x.shown}」が読めないか、datetime ${x.iso} と違う`);
    const w = (Array.isArray(want) ? want : ds.map(() => want)).map(valueOf);
    for (const x of w) {
      assert.match(String(x), ISO);
      assert.ok(x <= today(), `${x} が今日 ${today()} より先`);
    }
    assert.deepEqual(ds.map((x) => x.iso), w);
  });
}

for (const [p, { src, values, ids }] of Object.entries(drawn)) {
  test(`${p} は手書きの日付を持たず、${values} を読み込んで CHECKED を描く`, () => {
    const h = read(p);
    assert.deepEqual(datesIn(h).map((x) => x.shown), [], `${p} に手で書いた日付が在る`);
    assert.ok(h.includes(`<script src="${src}"></script>`), `${p} が ${src} を読み込んでいない`);
    const real = valueOf(`${values}#CHECKED`);
    const asTemplate = IS_TEMPLATE && TEMPLATE_DATES.includes(real);
    if (!asTemplate) {
      assert.match(real, ISO);
      assert.ok(real <= today(), `${real} が今日 ${today()} より先`);
    }
    const checked = asTemplate ? '2000-01-02' : real;
    const got = asTemplate ? runScript(h, values, real, checked) : runScript(h, values);
    assert.deepEqual(Object.keys(got).sort(), [...ids].sort());
    const [y, m, d] = checked.split('-').map(Number);
    for (const id of ids) {
      assert.equal(got[id].dateTime, checked, `${p} #${id}`);
      assert.equal(got[id].textContent, `${y}年${m}月${d}日`, `${p} #${id}`);
    }
  });
}

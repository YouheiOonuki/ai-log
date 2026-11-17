// ページに書いた「最終確認日」が constants.js の確認日と同じか（Q-276、yorozu-plans の QUEUE 2026-11-17 夜。otasuke の tests/guide-date.test.js と同じ目的）。
// 日付は HTML に手で書いてあり、constants.js にも同じ日付がある（check-site はこちらを読む）。片方だけ直すとずれるので、ここで突き合わせる。
// 比べる相手はページごとに EXPECT に書く（既定は constants.js の CHECKED）。日付を書いたページが増えたら、EXPECT に無いと落ちる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../constants.js');

const ROOT = path.join(__dirname, '..');
const EXPECT = { 'guide.html': () => K.CHECKED, 'en/guide.html': () => K.CHECKED, 'index.html': () => K.CHECKED };

const pad = (n) => String(n).padStart(2, '0');
// 「最終確認日」「Last checked」の直後（40 字以内）の日付を全部、ISO にして返す。<time> は datetime と表示も返す
function datesIn(h) {
  const out = [];
  for (const m of h.matchAll(/(?:最終確認日|Last checked)([\s\S]{0,60})/g)) {
    const s = m[1];
    const t = s.match(/^[^<。.]*<time datetime="([^"]*)">([^<]*)<\/time>/);
    if (t) { if (t[1]) out.push({ iso: t[1], shown: t[2] }); continue; }
    const a = s.match(/^[^。<]{0,8}?(\d{4})-(\d{2})-(\d{2})/);
    if (a) { out.push({ iso: `${a[1]}-${a[2]}-${a[3]}` }); continue; }
    const b = s.match(/^[^。<]{0,8}?(\d{4}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日/);
    if (b) out.push({ iso: `${b[1]}-${pad(b[2])}-${pad(b[3])}` });
  }
  return out;
}
const shownOk = (iso, shown) => {
  const [y, m, d] = iso.split('-').map(Number);
  const en = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return [iso, `${y}年${m}月${d}日`, en].includes(shown);
};

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'tools', '.github'].includes(e.name)) continue;
    const p = d ? `${d}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html') && datesIn(fs.readFileSync(path.join(ROOT, p), 'utf8')).length) pages.push(p);
  }
})('');

test('日付を書いたページは全部 EXPECT にある（増えたらここに足す）', () => {
  assert.deepEqual(pages.sort(), Object.keys(EXPECT).sort());
});

for (const [p, want] of Object.entries(EXPECT)) {
  test(`${p} の最終確認日が constants.js と同じ`, () => {
    const ds = datesIn(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    assert.ok(ds.length > 0, `${p} に日付が無い`);
    const w = want();
    assert.match(w, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ds[0].iso, w);
    for (const x of ds) if (x.shown !== undefined) assert.ok(shownOk(x.iso, x.shown), `${p}: datetime ${x.iso} と表示「${x.shown}」が違う`);
  });
}

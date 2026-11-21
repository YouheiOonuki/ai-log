// screen.js の固定バー（fixedBar）のテスト。バーが見えている間、ボタンに字が入っていること（Q-727: 学年早見表で、
// 出た直後の 50 ms ほど字の無いボタンが見え、axe の button-name に数えられた）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function setup() {
  const seen = [];   // バーの hidden が変わるたびに、そのときの字を残す
  const textEl = { textContent: '' };
  const bar = {
    _hidden: true,
    get hidden() { return this._hidden; },
    set hidden(v) { this._hidden = v; seen.push({ hidden: v, text: textEl.textContent }); },
    setAttribute() {},
    addEventListener() {},
  };
  const els = { fixbar: bar, print: {}, 'fixbar-text': textEl };
  let observe;
  const timers = [];
  const win = {
    IntersectionObserver: function (cb) { observe = cb; this.observe = function () {}; },
  };
  win.window = win;
  win.document = { getElementById: (id) => els[id] };
  win.setTimeout = (fn) => { timers.push(fn); };
  vm.runInNewContext(SRC, win);
  const fb = win.YorozuScreen.fixedBar({ bar: 'fixbar', watch: 'print', text: 'fixbar-text', onClick() {} });
  return { fb, bar, textEl, seen, scrollOut: () => observe([{ isIntersecting: false }]), flush: () => { while (timers.length) timers.shift()(); } };
}

test('バーは字を入れてから見せる（見えている間ボタンの字が空にならない）', () => {
  const s = setup();
  s.fb.set('印刷する（2026年度の学年早見表）');
  s.scrollOut();
  assert.equal(s.bar.hidden, false);
  assert.deepEqual(s.seen.filter((x) => x.hidden === false), [{ hidden: false, text: '印刷する（2026年度の学年早見表）' }]);
  assert.equal(s.textEl.textContent, '印刷する（2026年度の学年早見表）');
  s.flush();
  assert.equal(s.textEl.textContent, '印刷する（2026年度の学年早見表）');
});

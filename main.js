// ===========================
// __TITLE__ — 画面の制御
// 計算は calc.js（純粋関数）、時点のある値は constants.js に置く
// ===========================
(function () {
  'use strict';

  // --- ブラウザへの保存（README「ツールを追加するとき」12） ---
  // キーは必ず "__REPO___" で始める。全ツールが同じオリジンで localStorage を共有しているため
  var KEY_PREFIX = '__REPO___';
  var store = {
    get: function (name, fallback) {
      try {
        var v = localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }   // 保存できない環境（プライベートモードなど）でも動くように
    },
    set: function (name, value) {
      try { localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); } catch (e) { /* 保存できなくても続ける */ }
    },
  };

  // --- 共有 URL（README「ツールを追加するとき」11） ---
  // 入力内容は "#" 以降に入れる（? クエリはサーバーとアクセス解析に届くので使わない）
  function toShareHash(state) {
    return '#s=' + encodeURIComponent(JSON.stringify(state));
  }
  function fromShareHash(hash) {
    var m = /^#s=(.+)$/.exec(hash || '');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }

  // --- ここから下をツールに合わせて書き換える（例: 金額を 100 円単位で切り上げる） ---
  var el = {
    amount: document.getElementById('amount'),
    unit: document.getElementById('unit'),
    result: document.getElementById('result'),
    resultSub: document.getElementById('result-sub'),
    resultDetail: document.getElementById('result-detail'),
    share: document.getElementById('share'),
    backupMsg: document.getElementById('backup-msg'),
  };
  var UNITS = ['100', '1000'];
  function yen(n) { return n.toLocaleString('ja-JP') + ' 円'; }

  // 保存データや読み込んだファイルを、今の形にそろえる（ファイルの中身はそのまま信じない）
  function normalize(d) {
    return {
      amount: d && d.amount != null ? String(d.amount).slice(0, 20) : '',
      unit: d && UNITS.indexOf(String(d.unit)) >= 0 ? String(d.unit) : '100',   // 選択肢の既定は最頻値（SCREEN.md 3 章）
    };
  }
  function current() { return { amount: el.amount.value, unit: el.unit.value }; }
  function apply(d) { d = normalize(d); el.amount.value = d.amount; el.unit.value = d.unit; }

  // 上端の固定バーと折りたたみの状態（screen.js。SCREEN.md 1.1）
  var bar = window.YorozuScreen.fixedBar({ bar: 'fixbar', watch: 'result-main', jump: 'result-card', text: 'fixbar-text' });

  function update() {
    var unit = Number(el.unit.value);
    var v = el.amount.value === '' ? NaN : window.Calc.roundUp(el.amount.value, unit);   // 必須が空なら結果は「—」
    var ok = isFinite(v);
    el.result.textContent = ok ? yen(v) : '—';
    el.resultSub.textContent = ok ? yen(unit) + '単位で切り上げました。' : '金額を入れると出ます。';
    el.resultDetail.textContent = ok ? yen(Number(el.amount.value)) + ' → ' + yen(v) + '（差 ' + yen(v - Number(el.amount.value)) + '）' : '—';
    bar.set(ok ? '切り上げ ' + yen(v) : '');   // 結果の数字 1 つ。'' ならバーは出ない
    window.YorozuScreen.detailsSummary({ 'opt-unit': yen(unit) });
    store.set('draft', current());
  }

  el.share.addEventListener('click', function () {
    var url = location.href.split('#')[0] + toShareHash(current());
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
    history.replaceState(null, '', url);
  });

  // --- ファイルへの書き出し・読み込み（youheioonuki.github.io の README「ツールを追加するとき」20。決定 D31） ---
  // data は store に保存しているものと同じ形。中身はこの端末の中で作り、どこにも送信しない
  var TOOL = '__REPO__';
  document.getElementById('backup-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(window.Calc.buildBackup(TOOL, { draft: current() }), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = window.Calc.backupFileName(TOOL);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    el.backupMsg.textContent = 'ファイルに書き出しました。機種変更のときは、このファイルを新しい端末に移して「ファイルから読み込む」を押してください。';
  });
  document.getElementById('backup-import').addEventListener('click', function () { document.getElementById('backup-file').click(); });
  document.getElementById('backup-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { el.backupMsg.textContent = 'ファイルが大きすぎます。このツールで書き出したファイルを選んでください。'; return; }
    file.text().then(function (text) {
      var r = window.Calc.parseBackup(text, TOOL, ['draft']);   // tool・version・必須のキーを確かめる
      if (!r.ok) { el.backupMsg.textContent = r.error; return; }
      if (!window.confirm('ファイルの内容で、今の入力を置き換えます。よろしいですか？')) return;
      apply(r.data.draft);
      update();   // 表示を直して store にも保存する
      el.backupMsg.textContent = 'ファイルから読み込みました。';
    }, function () { el.backupMsg.textContent = 'ファイルを読み取れませんでした。'; });
  });

  var shared = fromShareHash(location.hash);
  apply(shared || store.get('draft', {}));
  el.amount.addEventListener('input', update);
  el.unit.addEventListener('change', update);
  update();

  // PWA-BEGIN（オフライン対応にしないツールでは、init.mjs がこのブロックを消す）
  // 登録は './sw.js' だけ。scope: '/' を指定しない（README「ツールを追加するとき」13）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
  // PWA-END
})();

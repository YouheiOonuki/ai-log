// ===========================
// 画面の部品（yorozu-plans の docs/SCREEN.md。youheioonuki.github.io の README「ツールを追加するとき」25）
// 依存なし。main.js より前に読む。window.YorozuScreen に 2 つの関数を置く
//
// 1. 上端の固定バー: 見張る要素（結果の数字・印刷ボタン）が画面の外にあるときだけ出す
//      var bar = YorozuScreen.fixedBar({ bar: 'fixbar', watch: 'result-main', jump: 'result-card', text: 'fixbar-text' });
//      bar.set('還付 12,300 円');   // 結果が出るたびに呼ぶ。'' なら出さない（読み込み時・必須が空のとき）
//    - バーの <a> を押すと jump の要素へスクロールしてフォーカスする（jump には tabindex="-1" と
//      style.css の scroll-margin-top が要る）。印刷ボタンにするなら onClick: function () { ... } を渡す
//    - スクリーンリーダーには最初に出たときの 1 回だけ読ませる（結果の aria-live と重ねない）
// 2. 折りたたみの状態: <summary> の中の .opt-state に今の状態を書く
//      YorozuScreen.detailsSummary({ 'opt-round': '100 円', 'opt-spouse': 'なし' });   // キーは <details> の id
// ===========================
(function () {
  'use strict';
  var BAR_H = 44;   // style.css の .fixbar の高さと同じ
  function $(x) { return typeof x === 'string' ? document.getElementById(x) : x; }
  function setText(e, t) { if (e && e.textContent !== t) e.textContent = t; }

  function fixedBar(o) {
    var bar = $(o.bar), watch = $(o.watch), jump = $(o.jump || o.watch), textEl = $(o.text);
    var content = '', inView = true, announced = false;
    function render() {
      var show = !!content && !inView;
      if (show && !announced) {
        announced = true;
        setText(textEl, '');
        bar.hidden = false;
        // 見えるようにしてから文字を入れると 1 回読まれる。そのあとは読み上げを止める
        setTimeout(function () { setText(textEl, content); setTimeout(function () { bar.setAttribute('aria-live', 'off'); }, 1000); }, 50);
        return;
      }
      setText(textEl, content);
      bar.hidden = !show;
    }
    if ('IntersectionObserver' in window) {
      // バーの高さの分だけ上を狭め、バーに隠れている結果は「画面の外」とみなす
      new IntersectionObserver(function (es) { inView = es[es.length - 1].isIntersecting; render(); },
        { rootMargin: '-' + BAR_H + 'px 0px 0px 0px' }).observe(watch);
    }
    bar.addEventListener('click', function (e) {
      if (!e.target.closest('a, button')) return;
      e.preventDefault();
      if (o.onClick) { o.onClick(e); return; }
      jump.scrollIntoView({ block: 'start' });
      try { jump.focus({ preventScroll: true }); } catch (err) { jump.focus(); }
    });
    return { set: function (t) { content = t == null ? '' : String(t); render(); } };
  }

  function detailsSummary(state) {
    Object.keys(state).forEach(function (id) {
      var d = $(id);
      setText(d && d.querySelector(':scope > summary .opt-state'), String(state[id]));
    });
  }

  window.YorozuScreen = { fixedBar: fixedBar, detailsSummary: detailsSummary };
})();

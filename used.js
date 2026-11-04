/* 道具が使われた回数（yorozu-plans ROADMAP 7.178 D468・企画書 99。K171 の 2 枝目）。
   正本は youheioonuki.github.io の tools/common/used.js。各リポジトリの used.js は tools/sync-common.mjs が配った写しで、手で直さない。
   道具は「結果を出す関数」の末尾で window.yzUsed?.() を呼ぶだけ。ページを開いてから、人が操作した（押す・入れる・選ぶ・落とす）後に
   結果が初めて出たとき 1 回だけ、{ page: そのページの場所, event: 'used' } を sendBeacon で送る。開いただけで既定の結果が出ても送らない。
   入力の値・結果の中身・Cookie・端末の情報は送らない。2 回目以降と、本番（yorozu-craft.com）の外では何もしない。 */
(function () {
  'use strict';
  var PING = 'https://yorozu-ai.oonuki-youhei.workers.dev/v1/ping';
  var touched = false, sent = false;
  ['pointerdown', 'keydown', 'input', 'change', 'submit', 'drop'].forEach(function (t) {
    window.addEventListener(t, function () { touched = true; }, true);
  });
  window.yzUsed = function () {
    if (sent || !touched) return;
    sent = true;
    if (location.hostname !== 'yorozu-craft.com' || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(PING, new Blob([JSON.stringify({ page: location.pathname, event: 'used' })], { type: 'text/plain' })); } catch (e) { /* 数えられなくても道具は止めない */ }
  };
})();

// ===========================
// AI 会話ログ Markdown 変換 — Web Worker（大きな書き出しを読んでいる間も画面を固まらせない）
// 中身は engine.js。ここは読み込みとメッセージの受け渡しだけ。外への通信はしない
// ===========================
/* global importScripts, createEngine, Calc, Zip */
importScripts('./calc.js', './zip.js', './engine.js');
var engine = createEngine(Calc, Zip, function (msg, transfer) { self.postMessage(msg, transfer || []); });
self.onmessage = function (e) { engine.handle(e.data); };

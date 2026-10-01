// ===========================
// zip の読み書き（依存なし）。fitbit-export の zip.js（同じ作者・MIT）を写し、readStream を足した
// - 読む: 末尾の中央ディレクトリだけを読み、要る項目だけを File.slice で取り出して
//   ブラウザの DecompressionStream('deflate-raw') で展開する。2GB を超える zip（ZIP64）も読める。
//   zip 全体をメモリに載せないので、使わない中身（画像・音声など）は読まない
// - 書く: Markdown の束を「無圧縮（stored）」の zip にする（展開の要らない小さな実装）。text の代わりに bytes（Uint8Array）も渡せる
// ブラウザでは window.Zip、Node（テスト）では module.exports で使う。Node 18 以上なら Blob と DecompressionStream がある
// ===========================
(function (root) {
  'use strict';

  var SIG_EOCD = 0x06054b50, SIG_EOCD64 = 0x06064b50, SIG_LOC64 = 0x07064b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;
  var MAX32 = 0xffffffff, MAX16 = 0xffff;

  function bytesOf(blob, start, end) {
    return blob.slice(start, end).arrayBuffer().then(function (b) { return new DataView(b); });
  }
  function u64(dv, o) {
    // 2^53 を超える値は来ない（そこまで大きい zip は扱わない）
    return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 0x100000000;
  }
  /** 例外に code を付ける（画面の言語ごとの文は text.js の errors[code]。message は日本語のまま） */
  function fail(code, message, arg) { var e = new Error(message); e.code = code; if (arg != null) e.arg = arg; return e; }
  var utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

  /**
   * zip の目次（中央ディレクトリ）を読む
   * @param {Blob} blob zip ファイル（File も Blob）
   * @returns {Promise<Array<{name:string, method:number, compSize:number, size:number, offset:number, encrypted:boolean}>>}
   */
  function readIndex(blob) {
    var size = blob.size;
    if (size < 22) return Promise.reject(fail('notZip', 'zip ではありません'));
    var tail = Math.min(size, 22 + 0xffff + 20);
    return bytesOf(blob, size - tail, size).then(function (dv) {
      var p = -1;
      for (var i = dv.byteLength - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === SIG_EOCD) { p = i; break; }
      }
      if (p < 0) throw fail('notZip', 'zip ではありません');
      var count = dv.getUint16(p + 10, true), cdSize = dv.getUint32(p + 12, true), cdOff = dv.getUint32(p + 16, true);
      var absEocd = size - tail + p;
      var needs64 = count === MAX16 || cdSize === MAX32 || cdOff === MAX32;
      if (!needs64 || absEocd < 20) return { count: count, cdSize: cdSize, cdOff: cdOff };
      return bytesOf(blob, absEocd - 20, absEocd).then(function (loc) {
        if (loc.getUint32(0, true) !== SIG_LOC64) return { count: count, cdSize: cdSize, cdOff: cdOff };
        var off64 = u64(loc, 8);
        return bytesOf(blob, off64, off64 + 56).then(function (e) {
          if (e.getUint32(0, true) !== SIG_EOCD64) throw fail('badIndex', 'zip の目次が壊れています');
          return { count: u64(e, 32), cdSize: u64(e, 40), cdOff: u64(e, 48) };
        });
      });
    }).then(function (d) {
      return bytesOf(blob, d.cdOff, d.cdOff + d.cdSize).then(function (dv) {
        var out = [], o = 0;
        while (o + 46 <= dv.byteLength && dv.getUint32(o, true) === SIG_CEN) {
          var flags = dv.getUint16(o + 8, true), method = dv.getUint16(o + 10, true);
          var comp = dv.getUint32(o + 20, true), full = dv.getUint32(o + 24, true);
          var nLen = dv.getUint16(o + 28, true), xLen = dv.getUint16(o + 30, true), cLen = dv.getUint16(o + 32, true);
          var offset = dv.getUint32(o + 42, true);
          var nameBytes = new Uint8Array(dv.buffer, dv.byteOffset + o + 46, nLen);
          var name = utf8 ? utf8.decode(nameBytes) : String.fromCharCode.apply(null, nameBytes);
          // ZIP64 の拡張（id 0x0001）: 32 ビットに収まらなかった値だけが、この順で入っている
          var x = o + 46 + nLen, xEnd = x + xLen;
          while (x + 4 <= xEnd) {
            var id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true), q = x + 4;
            if (id === 0x0001) {
              if (full === MAX32) { full = u64(dv, q); q += 8; }
              if (comp === MAX32) { comp = u64(dv, q); q += 8; }
              if (offset === MAX32) { offset = u64(dv, q); }
            }
            x += 4 + len;
          }
          if (name.slice(-1) !== '/') {
            out.push({ name: name, method: method, compSize: comp, size: full, offset: offset, encrypted: (flags & 1) === 1 });
          }
          o += 46 + nLen + xLen + cLen;
        }
        return out;
      });
    });
  }

  /**
   * zip の 1 項目を、展開しながら少しずつ読むストリームにする（100MB を超える conversations.json を丸ごとメモリに載せないため）
   * @returns {Promise<{stream: ReadableStream<Uint8Array>, compSize: number}>}
   */
  function readStream(blob, entry) {
    if (entry.encrypted) return Promise.reject(fail('encrypted', 'パスワード付きの zip は読めません'));
    return bytesOf(blob, entry.offset, entry.offset + 30).then(function (dv) {
      if (dv.getUint32(0, true) !== SIG_LOC) throw fail('badEntry', 'zip の中身が壊れています');
      var start = entry.offset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
      var part = blob.slice(start, start + entry.compSize);
      if (entry.method === 0) return { stream: part.stream(), compSize: entry.compSize };
      if (entry.method !== 8) throw fail('method', 'この圧縮方式（' + entry.method + '）は読めません', entry.method);
      if (typeof DecompressionStream === 'undefined') throw fail('noDecompress', 'このブラウザは zip の展開に対応していません。最新のブラウザでお試しください');
      return { stream: part.stream().pipeThrough(new DecompressionStream('deflate-raw')), compSize: entry.compSize };
    });
  }

  /** zip の 1 項目を文字列（UTF-8）で読む（小さいファイル用。テストでも使う） */
  function readText(blob, entry) {
    return readStream(blob, entry).then(function (r) { return new Response(r.stream).text(); });
  }

  // --- 書く（無圧縮） ---
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /**
   * ファイルの束を無圧縮の zip にする（ファイル名は UTF-8。4GB 未満。65,535 件を超えたら ZIP64 の目次）
   * @param {Array<{name:string, text:string}>} files
   * @param {Date} [date] 中の日時（既定は今）
   * @returns {Uint8Array}
   */
  function makeZip(files, date) {
    var enc = new TextEncoder();
    var d = date || new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.bytes || enc.encode(f.text), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, SIG_LOC, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, SIG_CEN, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var tail = [];
    if (files.length > MAX16) {
      // 65,535 件を超えたら ZIP64 の目次の終わり（EOCD64 と、その場所）を足す（会話が多い書き出し用）
      var e64 = new DataView(new ArrayBuffer(56));
      e64.setUint32(0, SIG_EOCD64, true); e64.setUint32(4, 44, true); e64.setUint16(12, 45, true); e64.setUint16(14, 45, true);
      e64.setUint32(24, files.length, true); e64.setUint32(32, files.length, true); e64.setUint32(40, cdSize, true); e64.setUint32(48, offset, true);
      var l64 = new DataView(new ArrayBuffer(20));
      l64.setUint32(0, SIG_LOC64, true); l64.setUint32(8, offset + cdSize, true); l64.setUint32(16, 1, true);
      tail.push(new Uint8Array(e64.buffer), new Uint8Array(l64.buffer));
    }
    var count16 = Math.min(files.length, MAX16);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, SIG_EOCD, true); e.setUint16(8, count16, true); e.setUint16(10, count16, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, tail, [new Uint8Array(e.buffer)]);
    var tailSize = tail.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(offset + cdSize + tailSize + 22), p = 0;
    all.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  var api = { readIndex: readIndex, readStream: readStream, readText: readText, makeZip: makeZip, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zip = api;
})(this);

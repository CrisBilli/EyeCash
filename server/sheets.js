'use strict';
/*
 * EyeCash · server/sheets.js
 *
 * Spreadsheet readers with zero dependencies: .xlsx (zip + XML), HTML-based .xls
 * and legacy binary .xls (BIFF8 in an OLE2 container). Used by bank imports.
 */
const zlib = require('node:zlib');

/* ---------- reading Excel (.xlsx) and HTML-based .xls without libraries ---------- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('File Excel non valido');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('File Excel non valido');
    const method = buf.readUInt16LE(off + 10),
      csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28),
      xlen = buf.readUInt16LE(off + 30),
      clen = buf.readUInt16LE(off + 32),
      lho = buf.readUInt32LE(off + 42);
    files.set(buf.toString('utf8', off + 46, off + 46 + nlen), { method, csize, lho });
    off += 46 + nlen + xlen + clen;
  }
  return {
    names: [...files.keys()],
    get(name) {
      const f = files.get(name);
      if (!f) return null;
      const l = f.lho,
        nl = buf.readUInt16LE(l + 26),
        xl = buf.readUInt16LE(l + 28);
      const data = buf.subarray(l + 30 + nl + xl, l + 30 + nl + xl + f.csize);
      if (f.method === 0) return data.toString('utf8');
      if (f.method === 8)
        return zlib.inflateRawSync(data, { maxOutputLength: 200 * 1024 * 1024 }).toString('utf8');
      throw new Error('Compressione non supportata');
    }
  };
}
const ENT = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  egrave: 'è',
  eacute: 'é',
  agrave: 'à',
  ograve: 'ò',
  ugrave: 'ù',
  igrave: 'ì'
};
const unesc = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
      : (ENT[e.toLowerCase()] ?? m)
  );
const colIdx = ref => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const attr = (s, a) => {
  const m = s.match(new RegExp('\\b' + a + '="([^"]*)"'));
  return m ? m[1] : null;
};
const serialToDate = v => new Date(Date.UTC(1899, 11, 30) + Math.round(v * 864e5)).toISOString().slice(0, 10);

function parseXlsx(buf) {
  const z = unzip(buf);
  const shared = [];
  const ss = z.get('xl/sharedStrings.xml');
  if (ss)
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  // styles: which cells are dates
  const dateXf = new Set();
  const st = z.get('xl/styles.xml');
  if (st) {
    const custom = {};
    for (const m of st.matchAll(/<numFmt\b([^>]*)\/?>/g))
      custom[attr(m[1], 'numFmtId')] = unesc(attr(m[1], 'formatCode') || '');
    const xfs = (st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    let i = 0;
    for (const m of xfs.matchAll(/<xf\b([^>]*)/g)) {
      const id = +attr(m[1], 'numFmtId');
      const code = (custom[id] || '').replace(/\[[^\]]*\]|"[^"]*"/g, '');
      if (
        (id >= 14 && id <= 22) ||
        (id >= 45 && id <= 47) ||
        /[dy]/i.test(code) ||
        (/m/i.test(code) && !/[#0]/.test(code))
      )
        dateXf.add(i);
      i++;
    }
  }
  const sheets = z.names
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
    .slice(0, 20);
  const out = [];
  for (const name of sheets) {
    const xml = z.get(name);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1],
          inner = cm[2] || '';
        const ref = attr(a, 'r');
        const t = attr(a, 't');
        const s = attr(a, 's');
        let v = '';
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (t === 's') v = vm ? (shared[+vm[1]] ?? '') : '';
        else if (t === 'inlineStr')
          v = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (t === 'str' || t === 'e') v = vm ? unesc(vm[1]) : '';
        else if (t === 'b') v = vm ? (vm[1] === '1' ? 'TRUE' : 'FALSE') : '';
        else if (vm) {
          const n = Number(vm[1]);
          v = s !== null && dateXf.has(+s) && n > 0 && n < 2958466 ? serialToDate(n) : String(n);
        }
        const ci = ref ? colIdx(ref) : row.length;
        if (ci >= 0 && ci < 200) {
          while (row.length < ci) row.push('');
          row[ci] = v;
        }
      }
      rows.push(row);
      if (rows.length > 50000) break;
    }
    out.push(rows);
  }
  return out;
}
function parseHtmlTable(text) {
  const rows = [];
  for (const tr of text.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    rows.push(
      [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c =>
        unesc(c[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
      )
    );
    if (rows.length > 50000) break;
  }
  return [rows];
}
/* ---------- reading legacy .xls (BIFF8 in an OLE2 container) without libraries ---------- */
function cfbStream(buf, wanted) {
  const ss = 1 << buf.readUInt16LE(30),
    mss = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48),
    cutoff = buf.readUInt32LE(56),
    miniFatStart = buf.readUInt32LE(60);
  let difat = buf.readUInt32LE(68);
  const END = 0xfffffffe,
    FREE = 0xffffffff,
    off = n => (n + 1) * ss;
  const fatSecs = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s !== FREE && s !== END) fatSecs.push(s);
  }
  for (let g = 0; difat !== END && difat !== FREE && g < 4096; g++) {
    const o = off(difat);
    if (o + ss > buf.length) break;
    for (let i = 0; i < ss / 4 - 1; i++) {
      const s = buf.readUInt32LE(o + i * 4);
      if (s !== FREE && s !== END) fatSecs.push(s);
    }
    difat = buf.readUInt32LE(o + ss - 4);
  }
  const fat = [];
  for (const s of fatSecs) {
    const o = off(s);
    if (o + ss > buf.length) throw new Error('File Excel danneggiato');
    for (let i = 0; i < ss / 4; i++) fat.push(buf.readUInt32LE(o + i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    for (let s = start, g = 0; s !== END && s !== FREE && s < table.length && g < 1e6; s = table[s], g++)
      out.push(s);
    return out;
  };
  const readFat = (start, size) => {
    const b = Buffer.concat(chain(start, fat).map(s => buf.subarray(off(s), off(s) + ss)));
    return size != null ? b.subarray(0, size) : b;
  };
  const dir = readFat(dirStart);
  const ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64);
    if (!nl || nl > 64) continue;
    ents.push({
      name: dir.toString('utf16le', o, o + nl - 2),
      type: dir[o + 66],
      start: dir.readUInt32LE(o + 116),
      size: dir.readUInt32LE(o + 120)
    });
  }
  const e = ents.find(x => x.type === 2 && wanted.includes(x.name.toLowerCase()));
  if (!e) throw new Error('File Excel non valido');
  if (e.size >= cutoff) return readFat(e.start, e.size);
  const root = ents.find(x => x.type === 5);
  if (!root) throw new Error('File Excel non valido');
  const mini = readFat(root.start),
    mfb = readFat(miniFatStart),
    mfat = [];
  for (let i = 0; i + 4 <= mfb.length; i += 4) mfat.push(mfb.readUInt32LE(i));
  return Buffer.concat(chain(e.start, mfat).map(s => mini.subarray(s * mss, s * mss + mss))).subarray(
    0,
    e.size
  );
}
function parseXls(buf) {
  const wb = cfbStream(buf, ['workbook', 'book']);
  const recs = [];
  for (let o = 0; o + 4 <= wb.length; ) {
    const id = wb.readUInt16LE(o),
      len = wb.readUInt16LE(o + 2);
    recs.push({ id, d: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  if (!recs.length || recs[0].id !== 0x0809) throw new Error('File Excel non valido');
  if (recs[0].d.length >= 2 && recs[0].d.readUInt16LE(0) !== 0x0600)
    throw Object.assign(new Error('Versione di Excel troppo vecchia: salva il file come .xlsx'), {
      code: 415
    });
  // BIFF8 Unicode string inside a single record
  const ustr = (d, o, lenBytes) => {
    const cch = lenBytes === 1 ? d[o] : d.readUInt16LE(o);
    let p = o + lenBytes;
    const fl = d[p++];
    // rich-text runs count and phonetic extension size: present but not needed
    if (fl & 8) {
      p += 2;
    }
    if (fl & 4) {
      p += 4;
    }
    return fl & 1 ? d.toString('utf16le', p, p + cch * 2) : d.toString('latin1', p, p + cch);
  };
  const sst = [],
    xfFmt = [],
    fmts = {};
  let date1904 = false;
  const sheets = [];
  let cur = null,
    depth = 0,
    pendingStr = null;
  const isDateFmt = id => {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    const code = (fmts[id] || '').replace(/\[[^\]]*\]|"[^"]*"|\\./g, '');
    return (
      !!code &&
      code.toLowerCase() !== 'general' &&
      (/[dy]/i.test(code) || (/m/i.test(code) && !/[#0]/.test(code)))
    );
  };
  const numOut = (v, xf) => {
    if (xf < xfFmt.length && isDateFmt(xfFmt[xf]) && v > 0 && v < 2958466)
      return serialToDate(date1904 ? v + 1462 : v);
    return String(Math.abs(v) < 1e15 && Number.isFinite(v) ? +v.toPrecision(15) : v);
  };
  const rk = n => {
    let v =
      n & 2
        ? n >> 2
        : (() => {
            const b = Buffer.alloc(8);
            b.writeUInt32LE(n & 0xfffffffc, 4);
            return b.readDoubleLE(0);
          })();
    return n & 1 ? v / 100 : v;
  };
  const put = (r, c, v) => {
    if (!cur || r > 50000 || c >= 200) return;
    while (cur.length <= r) cur.push([]);
    const row = cur[r];
    while (row.length < c) row.push('');
    row[c] = v;
  };
  for (let i = 0; i < recs.length; i++) {
    const { id, d } = recs[i];
    if (id === 0x0809) {
      depth++;
      if (depth === 1 && i > 0) {
        cur = d.length >= 4 && d.readUInt16LE(2) === 0x0010 ? [] : null;
        if (cur) sheets.push(cur);
      }
      continue;
    }
    if (id === 0x000a) {
      depth = Math.max(0, depth - 1);
      if (!depth) cur = null;
      continue;
    }
    if (id === 0x002f) throw Object.assign(new Error('Il file Excel è protetto da password'), { code: 415 });
    if (depth !== 1) continue;
    if (id === 0x0022) date1904 = d.length >= 2 && d.readUInt16LE(0) === 1;
    else if (id === 0x041e && d.length > 5) {
      try {
        fmts[d.readUInt16LE(0)] = ustr(d, 2, 2);
      } catch (e) {}
    } else if (id === 0x00e0 && d.length >= 4) xfFmt.push(d.readUInt16LE(2));
    else if (id === 0x00fc) {
      // shared string table, may continue in CONTINUE records
      const segs = [d];
      while (i + 1 < recs.length && recs[i + 1].id === 0x003c) segs.push(recs[++i].d);
      let si = 0,
        p = 8;
      const total = d.readUInt32LE(4);
      const need = () => {
        while (si < segs.length && p >= segs[si].length) {
          si++;
          p = 0;
        }
        return si < segs.length;
      };
      const u8 = () => segs[si][p++],
        u16 = () => {
          const v = segs[si].readUInt16LE(p);
          p += 2;
          return v;
        },
        u32 = () => {
          const v = segs[si].readUInt32LE(p);
          p += 4;
          return v;
        };
      const skip = n => {
        while (n > 0 && si < segs.length) {
          const a = Math.min(n, segs[si].length - p);
          p += a;
          n -= a;
          if (n > 0) {
            si++;
            p = 0;
          }
        }
      };
      for (let k = 0; k < total && k < 2e6; k++) {
        if (!need()) break;
        let cch = u16(),
          fl = u8(),
          runs = 0,
          ext = 0;
        if (fl & 8) runs = u16();
        if (fl & 4) ext = u32();
        let s = '',
          wide = fl & 1;
        while (cch > 0) {
          if (p >= segs[si].length) {
            si++;
            p = 0;
            if (si >= segs.length) break;
            wide = u8() & 1;
          } // the continuation starts again with an options byte
          const avail = segs[si].length - p,
            n = Math.min(cch, wide ? avail >> 1 : avail);
          if (n <= 0) {
            p = segs[si].length;
            continue;
          }
          s += wide ? segs[si].toString('utf16le', p, p + n * 2) : segs[si].toString('latin1', p, p + n);
          p += wide ? n * 2 : n;
          cch -= n;
        }
        skip(runs * 4 + ext);
        sst.push(s);
      }
    } else if (!cur) continue;
    else if (id === 0x00fd && d.length >= 10)
      put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
    else if (id === 0x0203 && d.length >= 14)
      put(d.readUInt16LE(0), d.readUInt16LE(2), numOut(d.readDoubleLE(6), d.readUInt16LE(4)));
    else if (id === 0x027e && d.length >= 10)
      put(d.readUInt16LE(0), d.readUInt16LE(2), numOut(rk(d.readInt32LE(6)), d.readUInt16LE(4)));
    else if (id === 0x00bd && d.length >= 6) {
      const r = d.readUInt16LE(0),
        c0 = d.readUInt16LE(2);
      for (let o = 4, c = c0; o + 6 <= d.length - 2; o += 6, c++)
        put(r, c, numOut(rk(d.readInt32LE(o + 2)), d.readUInt16LE(o)));
    } else if ((id === 0x0204 || id === 0x00d6) && d.length > 8) {
      try {
        put(d.readUInt16LE(0), d.readUInt16LE(2), ustr(d, 6, 2));
      } catch (e) {}
    } else if (id === 0x0006 && d.length >= 14) {
      const r = d.readUInt16LE(0),
        c = d.readUInt16LE(2);
      if (d.readUInt16LE(12) === 0xffff) {
        if (d[6] === 0) pendingStr = [r, c];
        else if (d[6] === 1) put(r, c, d[8] ? 'TRUE' : 'FALSE');
      } else put(r, c, numOut(d.readDoubleLE(6), d.readUInt16LE(4)));
    } else if (id === 0x0207 && pendingStr) {
      try {
        put(pendingStr[0], pendingStr[1], ustr(d, 0, 2));
      } catch (e) {}
      pendingStr = null;
    } else if (id === 0x0205 && d.length >= 8 && d[7] === 0)
      put(d.readUInt16LE(0), d.readUInt16LE(2), d[6] ? 'TRUE' : 'FALSE');
  }
  return sheets.slice(0, 20);
}
function spreadsheetToSheets(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return parseXlsx(buf);
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    try {
      return parseXls(buf);
    } catch (e) {
      throw Object.assign(
        new Error(
          e.code === 415
            ? e.message
            : 'Non riesco a leggere questo .xls: aprilo in Excel o Numbers e salvalo come .xlsx o .csv'
        ),
        { code: 415 }
      );
    }
  }
  let text = buf.toString('utf8');
  if (text.includes('�')) text = buf.toString('latin1');
  if (/<table/i.test(text)) return parseHtmlTable(text);
  throw Object.assign(new Error('Formato non riconosciuto'), { code: 415 });
}

module.exports = { spreadsheetToSheets };

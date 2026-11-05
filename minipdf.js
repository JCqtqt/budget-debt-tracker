// MiniPDF: a tiny PDF writer for the statement (text, lines, boxes, one JPEG logo).
// No outside libraries, so it works offline and on iPhone. Uses the built-in
// Helvetica fonts, which can't show "₱", so amounts are written as "PHP 1,234.00".
(function () {
  'use strict';
  // Helvetica / Helvetica-Bold widths (1/1000 em) for characters 32..126
  const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  // characters outside Latin-1 that have a WinAnsi code
  const WIN = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
  const SWAP = { '₱': 'PHP ', '−': '-', '→': '->', '←': '<-', '✓': 'v' };

  // text -> WinAnsi byte string
  function enc(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      if (SWAP[ch]) { out += SWAP[ch]; continue; }
      const c = ch.codePointAt(0);
      if (c >= 32 && c <= 126) out += ch;
      else if (c >= 160 && c <= 255) out += String.fromCharCode(c);
      else if (WIN[ch]) out += String.fromCharCode(WIN[ch]);
      else if (c === 9 || c === 10 || c === 13) out += ' ';
      else out += '?';
    }
    return out;
  }
  function width(s, size, bold) {
    const tbl = bold ? WB : W;
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      w += c >= 32 && c <= 126 ? tbl[c - 32] : c === 150 ? 556 : c === 151 ? 1000 : c === 183 ? 278 : c === 149 ? 350 : 556;
    }
    return (w * size) / 1000;
  }
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' '); };
  const f2 = (n) => (+n).toFixed(2);

  class Doc {
    constructor() { this.W = 595.28; this.H = 841.89; this.pages = []; this.img = null; this.addPage(); }
    addPage() { this.cur = []; this.pages.push(this.cur); return this; }
    get pageNo() { return this.pages.length; }
    // y is measured from the TOP of the page
    text(str, x, y, { size = 10, bold = false, color = '#0E1520', align = 'left', maxW = 0 } = {}) {
      let s = enc(str);
      if (maxW && width(s, size, bold) > maxW) {
        while (s.length > 1 && width(s + '...', size, bold) > maxW) s = s.slice(0, -1);
        s = s.replace(/\s+$/, '') + '...';
      }
      const w = width(s, size, bold);
      const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf ${rgb(color)} rg ${f2(tx)} ${f2(this.H - y)} Td (${esc(s)}) Tj ET`);
      return w;
    }
    // wrap text into lines that fit maxW; returns the lines (encoded)
    wrap(str, maxW, size = 10, bold = false) {
      const words = enc(str).split(/\s+/).filter(Boolean);
      const lines = []; let line = '';
      for (const wd of words) {
        const t = line ? line + ' ' + wd : wd;
        if (width(t, size, bold) <= maxW || !line) line = t; else { lines.push(line); line = wd; }
      }
      if (line) lines.push(line);
      return lines;
    }
    rawText(encoded, x, y, { size = 10, bold = false, color = '#0E1520' } = {}) {
      this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf ${rgb(color)} rg ${f2(x)} ${f2(this.H - y)} Td (${esc(encoded)}) Tj ET`);
    }
    line(x1, y1, x2, y2, { color = '#E4E7EC', w = 0.75 } = {}) {
      this.cur.push(`${rgb(color)} RG ${f2(w)} w ${f2(x1)} ${f2(this.H - y1)} m ${f2(x2)} ${f2(this.H - y2)} l S`);
    }
    rect(x, y, w, h, { fill = null, stroke = null, lw = 0.75, r = 0 } = {}) {
      const X = x, Y = this.H - y - h;
      let path;
      if (r > 0) {
        const k = 0.5523 * r;
        path = `${f2(X + r)} ${f2(Y)} m ${f2(X + w - r)} ${f2(Y)} l ${f2(X + w - r + k)} ${f2(Y)} ${f2(X + w)} ${f2(Y + r - k)} ${f2(X + w)} ${f2(Y + r)} c `
          + `${f2(X + w)} ${f2(Y + h - r)} l ${f2(X + w)} ${f2(Y + h - r + k)} ${f2(X + w - r + k)} ${f2(Y + h)} ${f2(X + w - r)} ${f2(Y + h)} c `
          + `${f2(X + r)} ${f2(Y + h)} l ${f2(X + r - k)} ${f2(Y + h)} ${f2(X)} ${f2(Y + h - r + k)} ${f2(X)} ${f2(Y + h - r)} c `
          + `${f2(X)} ${f2(Y + r)} l ${f2(X)} ${f2(Y + r - k)} ${f2(X + r - k)} ${f2(Y)} ${f2(X + r)} ${f2(Y)} c h`;
      } else path = `${f2(X)} ${f2(Y)} ${f2(w)} ${f2(h)} re`;
      const op = fill && stroke ? 'B' : fill ? 'f' : 'S';
      this.cur.push(`${fill ? rgb(fill) + ' rg ' : ''}${stroke ? rgb(stroke) + ' RG ' + f2(lw) + ' w ' : ''}${path} ${op}`);
    }
    // one JPEG image (the logo); data = binary string, pw/ph = pixel size
    setImage(data, pw, ph) { this.img = { data, pw, ph }; }
    image(x, y, w, h) { if (this.img) this.cur.push(`q ${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(this.H - y - h)} cm /Im1 Do Q`); }

    output() {
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      const catalog = add(null), pagesId = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const fb = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      let im = 0;
      if (this.img) im = add(`<< /Type /XObject /Subtype /Image /Width ${this.img.pw} /Height ${this.img.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.img.data.length} >>\nstream\n${this.img.data}\nendstream`);
      const kids = [];
      for (const p of this.pages) {
        const body = p.join('\n');
        const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${fb} 0 R >>${im ? ` /XObject << /Im1 ${im} 0 R >>` : ''} >> /Contents ${c} 0 R >>`));
      }
      objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
      objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
      let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const offs = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return new Blob([bytes], { type: 'application/pdf' });
    }
  }
  window.MiniPDF = { Doc, width: (s, size, bold) => width(enc(s), size, bold), enc };
})();

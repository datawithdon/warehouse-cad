/*
 * Warehouse CAD - file writers: DXF (AutoCAD R12 ASCII), SVG and vector PDF.
 * No third-party libraries; everything is generated from the primitive list.
 */
(function (root) {
  'use strict';
  const W = (root.WCAD = root.WCAD || {});

  const PALETTES = {
    screen: {
      bg: '#14181d', wall: '#e5e7eb', column: '#9ca3af', door: '#4ade80', rack: '#60a5fa',
      shelf: '#22d3ee', drivein: '#a5b4fc', dim: '#f87171', text: '#f3f4f6', flow: '#fbbf24',
    },
    print: {
      bg: '#ffffff', wall: '#1f2937', column: '#4b5563', door: '#15803d', rack: '#1d4ed8',
      shelf: '#0e7490', drivein: '#4338ca', dim: '#b91c1c', text: '#111827', flow: '#b45309',
    },
  };
  const color = (key, pal) => pal[key] || key;

  const CTRL_RE = /[\u0000-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex

  function slug(name) {
    const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return s || 'warehouse';
  }

  // ---- DXF -------------------------------------------------------------------
  const LAYER_NAME = Object.fromEntries(W.LAYERS.map((l) => [l.id, l.name.toUpperCase()]));

  function dxfText(s) {
    let out = '';
    for (const ch of String(s).replace(CTRL_RE, '')) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20 && cp <= 0x7e) out += ch;
      else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
      else out += '?';
    }
    return out;
  }

  function toDXF(project) {
    const prims = W.projectPrims(project).filter((p) => !p.mask);
    const k = project.units === 'imperial' ? 1 / 25.4 : 1;
    const lines = [];
    const g = (code, val) => { lines.push(String(code), String(val)); };
    const n = (v) => String(Math.round(v * k * 1000) / 1000);
    const X = (x) => n(x), Y = (y) => n(-y);
    const bb = W.primsBBox(prims) || [0, 0, 1000, 1000];

    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, project.units === 'imperial' ? 1 : 4);
    g(9, '$EXTMIN'); g(10, X(bb[0])); g(20, Y(bb[3])); g(30, 0);
    g(9, '$EXTMAX'); g(10, X(bb[2])); g(20, Y(bb[1])); g(30, 0);
    g(9, '$LTSCALE'); g(40, 1);
    g(0, 'ENDSEC');

    const dash = 400 * k, gap = 200 * k;
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed __ __ __'); g(72, 65); g(73, 2);
    g(40, dash + gap); g(49, dash); g(49, -gap);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, W.LAYERS.length + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    for (const l of W.LAYERS) { g(0, 'LAYER'); g(2, LAYER_NAME[l.id]); g(70, 0); g(62, l.aci); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');

    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const p of prims) {
      const head = (type) => {
        g(0, type); g(8, LAYER_NAME[p.layer]);
        if (p.dash) g(6, 'DASHED');
        if (p.aci) g(62, p.aci);
      };
      if (p.t === 'line') {
        head('LINE');
        g(10, X(p.a[0])); g(20, Y(p.a[1])); g(30, 0); g(11, X(p.b[0])); g(21, Y(p.b[1])); g(31, 0);
      } else if (p.t === 'poly') {
        if (p.solid && (p.pts.length === 3 || p.pts.length === 4)) {
          const q = p.pts.length === 4 ? [p.pts[0], p.pts[1], p.pts[3], p.pts[2]] : [p.pts[0], p.pts[1], p.pts[2], p.pts[2]];
          head('SOLID');
          q.forEach((pt, i) => { g(10 + i, X(pt[0])); g(20 + i, Y(pt[1])); g(30 + i, 0); });
        }
        head('POLYLINE');
        g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, p.closed ? 1 : 0);
        for (const pt of p.pts) { g(0, 'VERTEX'); g(8, LAYER_NAME[p.layer]); g(10, X(pt[0])); g(20, Y(pt[1])); g(30, 0); }
        g(0, 'SEQEND'); g(8, LAYER_NAME[p.layer]);
      } else if (p.t === 'text') {
        head('TEXT');
        g(10, X(p.x)); g(20, Y(p.y)); g(30, 0); g(40, n(p.h)); g(1, dxfText(p.s));
        if (p.rot) g(50, -p.rot);
        g(7, 'STANDARD'); g(72, 1); g(11, X(p.x)); g(21, Y(p.y)); g(31, 0); g(73, 2);
      }
    }
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return lines.join('\r\n') + '\r\n';
  }

  // ---- SVG -------------------------------------------------------------------
  const xmlEsc = (s) => String(s).replace(CTRL_RE, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const r2 = (v) => Math.round(v * 100) / 100;

  function toSVG(project, opt = {}) {
    const pal = PALETTES[opt.palette || 'print'];
    const hidden = opt.hidden || new Set();
    const prims = W.projectPrims(project).filter((p) => !hidden.has(p.layer));
    const bb = W.primsBBox(prims) || [0, 0, 10000, 10000];
    const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.03 + 500;
    const vx = bb[0] - m, vy = bb[1] - m, vw = bb[2] - bb[0] + 2 * m, vh = bb[3] - bb[1] + 2 * m;
    const pxW = 1600, pxH = Math.max(1, Math.round((pxW * vh) / vw));
    const base = Math.max(vw, vh) / 1600;
    const sw = { thin: base * 0.8, med: base * 1.4, thick: base * 2.4 };
    const dashAttr = ` stroke-dasharray="${r2(base * 7)} ${r2(base * 5)}"`;
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(vx)} ${r2(vy)} ${r2(vw)} ${r2(vh)}" width="${pxW}" height="${pxH}">`);
    out.push(`<title>${xmlEsc(project.name)}</title>`);
    out.push(`<rect x="${r2(vx)}" y="${r2(vy)}" width="${r2(vw)}" height="${r2(vh)}" fill="${pal.bg}"/>`);
    let layer = null;
    for (const p of prims) {
      if (p.layer !== layer) {
        if (layer) out.push('</g>');
        layer = p.layer;
        out.push(`<g id="layer-${layer}">`);
      }
      const stroke = p.stroke ? ` stroke="${color(p.stroke, pal)}" stroke-width="${r2(sw[p.w || 'thin'])}"${p.dash ? dashAttr : ''}` : '';
      if (p.t === 'line') {
        out.push(`<line x1="${r2(p.a[0])}" y1="${r2(p.a[1])}" x2="${r2(p.b[0])}" y2="${r2(p.b[1])}" fill="none"${stroke} stroke-linecap="round"/>`);
      } else if (p.t === 'poly') {
        const pts = p.pts.map((q) => `${r2(q[0])},${r2(q[1])}`).join(' ');
        const fill = p.fill ? `fill="${color(p.fill, pal)}"${p.alpha ? ` fill-opacity="${p.alpha}"` : ''}` : 'fill="none"';
        out.push(`<${p.closed ? 'polygon' : 'polyline'} points="${pts}" ${fill}${stroke} stroke-linejoin="round"/>`);
      } else if (p.t === 'text') {
        const rot = p.rot ? ` transform="rotate(${r2(p.rot)} ${r2(p.x)} ${r2(p.y)})"` : '';
        out.push(`<text x="${r2(p.x)}" y="${r2(p.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${r2(p.h)}" text-anchor="middle" dominant-baseline="central" fill="${color(p.color, pal)}"${rot}>${xmlEsc(p.s)}</text>`);
      }
    }
    if (layer) out.push('</g>');
    out.push('</svg>');
    return out.join('\n');
  }

  // ---- PDF -------------------------------------------------------------------
  const SHEETS = {
    A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
    Letter: [279.4, 215.9], Tabloid: [431.8, 279.4], 'ARCH D': [914.4, 609.6],
  };
  const SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000, 20000];
  // Helvetica advance widths (1/1000 em) for ASCII 32..126.
  const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
    500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556,
    500, 722, 500, 500, 500, 334, 260, 334, 584];

  /** Convert to WinAnsi/Latin-1 bytes; anything else becomes '?'. */
  function pdfChars(s) {
    let out = '';
    for (const ch of String(s).replace(CTRL_RE, '')) {
      const cp = ch.codePointAt(0);
      out += (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? ch : '?';
    }
    return out;
  }
  const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  function pdfTextWidth(s, size, bold) {
    let w = 0;
    for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; }
    return (w / 1000) * size * (bold ? 1.06 : 1);
  }
  function rgb(hex) {
    const h = /^#?([0-9a-f]{6})$/i.exec(hex);
    const v = h ? parseInt(h[1], 16) : 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => (c / 255).toFixed(3)).join(' ');
  }

  function pickScale(bb, areaW, areaH) {
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    for (const s of SCALES) if (w / s <= areaW && h / s <= areaH) return s;
    return SCALES[SCALES.length - 1];
  }

  /**
   * opt: sheet (key of SHEETS), scale ('fit' | number), title, subtitle, drawnBy, revision, date, hidden (Set)
   * Returns {bytes: Uint8Array, scale}.
   */
  function toPDF(project, opt = {}) {
    const pal = PALETTES.print;
    const [PW, PH] = SHEETS[opt.sheet] || SHEETS.A3;
    const PT = 72 / 25.4;
    const hidden = opt.hidden || new Set();
    const prims = W.projectPrims(project).filter((p) => !hidden.has(p.layer));
    const bb = W.primsBBox(prims) || [0, 0, 10000, 10000];
    const M = 10, TB = 24; // frame margin, title block height (mm)
    const ax = M + 5, ay = M + 5, aw = PW - 2 * M - 10, ah = PH - 2 * M - TB - 10;
    const fixed = Number(opt.scale);
    const den = SCALES.includes(fixed) ? fixed : pickScale(bb, aw, ah);
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    // paper mm (y from top) -> PDF points
    const P = (x, y) => `${(x * PT).toFixed(2)} ${((PH - y) * PT).toFixed(2)}`;
    // world -> paper mm
    const wx = (x) => ax + aw / 2 + (x - cx) / den;
    const wy = (y) => ay + ah / 2 + (y - cy) / den;
    const WP = (q) => P(wx(q[0]), wy(q[1]));
    const LW = { thin: 0.35, med: 0.6, thick: 1.1 };
    const c = [];

    const text = (s, x, y, sizeMm, opts = {}) => {
      const str = pdfChars(s);
      if (!str) return;
      const size = sizeMm * PT;
      const w = pdfTextWidth(str, size, opts.bold);
      const th = (-(opts.rot || 0) * Math.PI) / 180;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ox0 = x * PT, oy0 = (PH - y) * PT;
      const shift = opts.align === 'left' ? 0 : w / 2;
      const ox = ox0 - cs * shift + sn * size * 0.35;
      const oy = oy0 - sn * shift - cs * size * 0.35;
      const tm = `${cs.toFixed(4)} ${sn.toFixed(4)} ${(-sn).toFixed(4)} ${cs.toFixed(4)} ${ox.toFixed(2)} ${oy.toFixed(2)} Tm`;
      const font = opts.bold ? '/F2' : '/F1';
      c.push(`BT ${font} ${size.toFixed(2)} Tf ${tm} ${rgb(opts.color || '#111827')} rg ${pdfStr(str)} Tj ET`);
    };
    const rect = (x, y, w, h, op) => c.push(`${(x * PT).toFixed(2)} ${((PH - y - h) * PT).toFixed(2)} ${(w * PT).toFixed(2)} ${(h * PT).toFixed(2)} re ${op}`);

    // Drawing, clipped to the drawing area.
    c.push('q');
    rect(ax - 5, ay - 5, aw + 10, ah + 10, 'W n');
    c.push('1 J 1 j');
    for (const p of prims) {
      if (p.t === 'text') {
        const sz = p.h / den;
        if (sz >= 0.6) text(p.s, wx(p.x), wy(p.y), sz, { rot: p.rot, color: color(p.color, pal) });
        continue;
      }
      if (p.plate && p.plate / den < 0.6) continue;
      const ops = [];
      if (p.stroke) ops.push(`${rgb(color(p.stroke, pal))} RG ${LW[p.w || 'thin']} w ${p.dash ? '[3 2] 0 d' : '[] 0 d'}`);
      if (p.fill) ops.push(`${rgb(color(p.fill, pal))} rg`);
      if (p.alpha) ops.push('/GA gs');
      const path = p.t === 'line' ? `${WP(p.a)} m ${WP(p.b)} l` : p.pts.map((q, i) => `${WP(q)} ${i ? 'l' : 'm'}`).join(' ') + (p.closed ? ' h' : '');
      if (p.alpha && p.stroke) {
        c.push(`${ops.join(' ')} ${path} f /G1 gs ${path} S`);
      } else {
        const op = p.fill && p.stroke ? 'B' : p.fill ? 'f' : 'S';
        c.push(`${ops.join(' ')} ${path} ${op}${p.alpha ? ' /G1 gs' : ''}`);
      }
    }
    c.push('Q');

    // Frame and title block.
    c.push(`${rgb('#111827')} RG 0.8 w [] 0 d`);
    rect(M, M, PW - 2 * M, PH - 2 * M, 'S');
    const ty = PH - M - TB;
    c.push('0.5 w');
    rect(M, ty, PW - 2 * M, TB, 'S');
    const stats = W.computeStats(project);
    const cells = [
      ['PALLET POSITIONS', stats.pallets.toLocaleString('en-US'), 34],
      ['SCALE', `1:${den}  @ ${opt.sheet || 'A3'}`, 34],
      ['DATE', opt.date || '', 26],
      ['DRAWN BY', opt.drawnBy || '', 30],
      ['REV', opt.revision || '', 14],
    ];
    let cxm = PW - M;
    for (let i = cells.length - 1; i >= 0; i--) {
      const [label, value, w] = cells[i];
      cxm -= w;
      c.push(`${(cxm * PT).toFixed(2)} ${((PH - ty) * PT).toFixed(2)} m ${(cxm * PT).toFixed(2)} ${((PH - ty - TB) * PT).toFixed(2)} l S`);
      text(label, cxm + 2, ty + 4, 1.8, { align: 'left', color: '#6b7280' });
      text(value, cxm + 2, ty + 12, 3.2, { align: 'left', bold: true });
    }
    const titleW = cxm - M;
    text(opt.title || project.name, M + 3, ty + 6, 4.5, { align: 'left', bold: true });
    if (opt.subtitle) text(opt.subtitle, M + 3, ty + 12, 2.6, { align: 'left', color: '#374151' });

    // Scale bar in the title cell.
    const imperial = project.units === 'imperial';
    const unitMm = imperial ? W.MM_PER_FT : 1000;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const maxBar = Math.min(60, titleW - 10);
    let seg = steps[0];
    for (const s of steps) if ((4 * s * unitMm) / den <= maxBar) seg = s;
    const segMm = (seg * unitMm) / den;
    const bx = M + 3, by = ty + 17;
    c.push(`${rgb('#111827')} RG ${rgb('#111827')} rg 0.3 w`);
    for (let i = 0; i < 4; i++) rect(bx + i * segMm, by, segMm, 1.6, i % 2 ? 'S' : 'B');
    for (let i = 0; i <= 4; i += 2) text(String(i * seg), bx + i * segMm, by + 4, 1.8, {});
    text(imperial ? 'ft' : 'm', bx + 4 * segMm + 4, by + 0.8, 1.8, {});

    const content = c.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(PW * PT).toFixed(2)} ${(PH * PT).toFixed(2)}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << /GA 7 0 R /G1 8 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Type /ExtGState /ca 0.16 >>',
      '<< /Type /ExtGState /ca 1 /CA 1 >>',
      `<< /Title ${pdfStr(pdfChars(opt.title || project.name))} >>`,
    ];
    let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offs) pdf += String(o).padStart(10, '0') + ' 00000 n \n';
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return { bytes, scale: den };
  }

  Object.assign(W, { PALETTES, color, slug, toDXF, toSVG, toPDF, pickScale, SHEETS, SCALES, dxfText, xmlEsc, pdfChars });
})(typeof window !== 'undefined' ? window : globalThis);

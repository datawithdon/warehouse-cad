/*
 * Warehouse CAD - canvas renderer for primitives (screen view and PNG export).
 */
(function (root) {
  'use strict';
  const W = (root.WCAD = root.WCAD || {});

  /**
   * xf: {s, ox, oy} world->screen (screen = world * s + o).
   * opt: {hidden: Set<layer>, lineScale, viewport: [x0, y0, x1, y1] in world, override: colour}
   */
  function drawPrims(ctx, prims, xf, pal, opt = {}) {
    const { s, ox, oy } = xf;
    const ls = opt.lineScale || 1;
    const LW = { thin: 1 * ls, med: 1.6 * ls, thick: 2.6 * ls };
    const vp = opt.viewport;
    const hidden = opt.hidden;
    const col = (k) => opt.override || W.color(k, pal);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const p of prims) {
      if (hidden && hidden.has(p.layer)) continue;
      if (vp) {
        const b = p.bb || (p.bb = W.primBBox(p));
        if (b[2] < vp[0] || b[0] > vp[2] || b[3] < vp[1] || b[1] > vp[3]) continue;
      }
      if (p.t === 'text') {
        const px = p.h * s;
        if (px < 4) continue;
        ctx.save();
        ctx.translate(p.x * s + ox, p.y * s + oy);
        if (p.rot) ctx.rotate((p.rot * Math.PI) / 180);
        ctx.font = `${px.toFixed(1)}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = col(p.color);
        ctx.fillText(p.s, 0, 0);
        ctx.restore();
        continue;
      }
      if (p.mask && (opt.override || (p.plate && p.plate * s < 4))) continue;
      ctx.beginPath();
      if (p.t === 'line') {
        ctx.moveTo(p.a[0] * s + ox, p.a[1] * s + oy);
        ctx.lineTo(p.b[0] * s + ox, p.b[1] * s + oy);
      } else {
        p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0] * s + ox, q[1] * s + oy) : ctx.moveTo(q[0] * s + ox, q[1] * s + oy)));
        if (p.closed) ctx.closePath();
      }
      if (p.fill && !opt.override) {
        ctx.globalAlpha = p.alpha || 1;
        ctx.fillStyle = W.color(p.fill, pal);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.stroke) {
        ctx.lineWidth = opt.override ? LW[p.w || 'thin'] + 1.5 : LW[p.w || 'thin'];
        ctx.setLineDash(p.dash ? [6 * ls, 4 * ls] : []);
        ctx.strokeStyle = col(p.stroke);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  /** Render the whole project to a PNG Blob (print palette, white background). */
  function toPNG(project, opt = {}) {
    const hidden = opt.hidden || new Set();
    const prims = W.projectPrims(project).filter((p) => !hidden.has(p.layer));
    const bb = W.primsBBox(prims) || [0, 0, 10000, 10000];
    const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.03 + 500;
    const ww = bb[2] - bb[0] + 2 * m, wh = bb[3] - bb[1] + 2 * m;
    const maxPx = opt.maxPx || 4000;
    const s = maxPx / Math.max(ww, wh);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(ww * s));
    cv.height = Math.max(1, Math.round(wh * s));
    const ctx = cv.getContext('2d');
    const pal = W.PALETTES.print;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    drawPrims(ctx, prims, { s, ox: -(bb[0] - m) * s, oy: -(bb[1] - m) * s }, pal, { lineScale: maxPx / 1600 });
    return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  }

  Object.assign(W, { drawPrims, toPNG });
})(typeof window !== 'undefined' ? window : globalThis);

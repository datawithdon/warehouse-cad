/*
 * Warehouse CAD - core model.
 * Object schemas, validation, geometry, drawing primitives, statistics and
 * the racking auto-layout. All lengths are millimetres, angles are degrees,
 * and world Y grows downward (screen convention). Exporters flip Y as needed.
 */
(function (root) {
  'use strict';
  const W = (root.WCAD = root.WCAD || {});

  const MAX_COORD = 1e7; // 10 km
  const MAX_OBJECTS = 50000;
  const MAX_TOTAL_BAYS = 200000; // keeps hostile or runaway drawings from freezing the tab

  const LAYERS = [
    { id: 'zones', name: 'Zones', aci: 30 },
    { id: 'flow', name: 'Flow', aci: 40 },
    { id: 'racking', name: 'Racking', aci: 5 },
    { id: 'walls', name: 'Walls', aci: 7 },
    { id: 'columns', name: 'Columns', aci: 8 },
    { id: 'doors', name: 'Doors', aci: 3 },
    { id: 'dims', name: 'Dimensions', aci: 1 },
    { id: 'text', name: 'Text', aci: 7 },
  ];
  const LAYER_ORDER = Object.fromEntries(LAYERS.map((l, i) => [l.id, i]));

  const TYPE_LAYER = {
    zone: 'zones', arrow: 'flow', rack: 'racking', wall: 'walls',
    column: 'columns', door: 'doors', dim: 'dims', text: 'text',
  };

  const ZONE_KINDS = {
    receiving: { label: 'Receiving', color: '#3b82f6', aci: 5 },
    storage: { label: 'Storage', color: '#22c55e', aci: 3 },
    picking: { label: 'Picking', color: '#eab308', aci: 2 },
    packing: { label: 'Packing', color: '#f97316', aci: 30 },
    staging: { label: 'Staging', color: '#a855f7', aci: 6 },
    shipping: { label: 'Shipping', color: '#ef4444', aci: 1 },
    office: { label: 'Office', color: '#94a3b8', aci: 8 },
    other: { label: 'Other', color: '#14b8a6', aci: 4 },
  };
  const DOOR_KINDS = {
    door: { label: 'Personnel door', w: 900 },
    overhead: { label: 'Overhead door', w: 3600 },
    dock: { label: 'Dock door', w: 2700 },
  };
  const RACK_KINDS = {
    selective: { label: 'Selective pallet rack' },
    drivein: { label: 'Drive-in rack' },
    shelving: { label: 'Shelving' },
  };

  // ---- schema -------------------------------------------------------------
  const C = (k, l, d = 0) => ({ k, l, t: 'coord', d });
  const L = (k, l, d, min, max, tool) => ({ k, l, t: 'len', d, min, max, tool: !!tool });
  const I = (k, l, d, min, max, tool) => ({ k, l, t: 'int', d, min, max, tool: !!tool });
  const E = (k, l, opts, d, tool) => ({ k, l, t: 'enum', opts, d, tool: !!tool });
  const S = (k, l, d, max, tool) => ({ k, l, t: 'str', d, max, tool: !!tool });
  const A = (k, l) => ({ k, l, t: 'angle', d: 0 });

  const SCHEMA = {
    wall: [C('x1', 'Start X'), C('y1', 'Start Y'), C('x2', 'End X'), C('y2', 'End Y'),
      L('thick', 'Thickness', 200, 50, 3000, true)],
    column: [C('x', 'X'), C('y', 'Y'), L('size', 'Size', 400, 100, 5000, true)],
    door: [C('x', 'X'), C('y', 'Y'), E('kind', 'Type', DOOR_KINDS, 'door'),
      L('w', 'Width', 900, 300, 30000, true), A('rot', 'Rotation'), S('label', 'Label', '', 40, true),
      L('wallT', 'Opening depth', 220, 0, 3000)],
    rack: [C('x', 'Centre X'), C('y', 'Centre Y'), A('rot', 'Rotation'), S('name', 'Name', 'R', 40),
      E('kind', 'Rack type', RACK_KINDS, 'selective', true),
      I('bays', 'Bays / lanes', 10, 1, 2000),
      L('bayW', 'Bay width', 2700, 300, 20000, true),
      L('depth', 'Depth', 1100, 200, 50000, true),
      I('rows', 'Rows (2 = back-to-back)', 2, 1, 2, true),
      L('flue', 'Flue gap', 300, 0, 3000, true),
      I('levels', 'Levels', 5, 1, 40, true),
      I('perBay', 'Pallets per bay', 2, 1, 20, true),
      L('palletD', 'Pallet depth', 1200, 300, 5000, true)],
    zone: [C('x', 'Centre X'), C('y', 'Centre Y'), L('w', 'Width', 10000, 100, 2e6),
      L('h', 'Length', 8000, 100, 2e6), E('kind', 'Zone type', ZONE_KINDS, 'storage', true),
      S('name', 'Name', '', 60)],
    arrow: [C('x1', 'Start X'), C('y1', 'Start Y'), C('x2', 'End X'), C('y2', 'End Y')],
    dim: [C('x1', 'Start X'), C('y1', 'Start Y'), C('x2', 'End X'), C('y2', 'End Y'),
      C('off', 'Offset', 800), L('th', 'Text height', 250, 20, 10000, true)],
    text: [C('x', 'X'), C('y', 'Y'), S('text', 'Text', 'Label', 200), L('h', 'Height', 400, 20, 50000, true),
      A('rot', 'Rotation')],
  };

  const TYPE_LABEL = {
    wall: 'Wall', column: 'Column', door: 'Door', rack: 'Rack', zone: 'Zone',
    arrow: 'Flow arrow', dim: 'Dimension', text: 'Text',
  };

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // eslint-disable-next-line no-control-regex
  const CTRL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

  function sanitizeValue(f, v) {
    switch (f.t) {
      case 'coord': {
        const n = Number(v);
        return Number.isFinite(n) ? clamp(n, -MAX_COORD, MAX_COORD) : f.d;
      }
      case 'len': {
        const n = Number(v);
        return Number.isFinite(n) ? clamp(n, f.min, f.max) : f.d;
      }
      case 'int': {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? clamp(n, f.min, f.max) : f.d;
      }
      case 'angle': {
        const n = Number(v);
        return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
      }
      case 'enum':
        return typeof v === 'string' && hasOwn(f.opts, v) ? v : f.d;
      case 'str':
        return typeof v === 'string' ? v.replace(CTRL_RE, '').slice(0, f.max) : f.d;
      default:
        return f.d;
    }
  }

  let idSeq = 0;
  function newId() {
    idSeq = (idSeq + 1) % 1679616;
    return Date.now().toString(36) + idSeq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  const ID_RE = /^[a-z0-9]{1,32}$/;

  function makeObject(type, props) {
    if (!hasOwn(SCHEMA, type)) throw new Error('Unknown object type');
    const p = props && typeof props === 'object' ? props : {};
    const o = { id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : newId(), type };
    for (const f of SCHEMA[type]) o[f.k] = sanitizeValue(f, hasOwn(p, f.k) ? p[f.k] : f.d);
    return o;
  }

  function sanitizeObject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.type !== 'string' || !hasOwn(SCHEMA, raw.type)) return null;
    return makeObject(raw.type, raw);
  }

  function newProject(name, units) {
    return { name: sanitizeValue(S('', '', 'Untitled warehouse', 80), name) || 'Untitled warehouse',
      units: units === 'imperial' ? 'imperial' : 'metric', objects: [] };
  }

  function sanitizeProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.objects)) {
      throw new Error('Not a Warehouse CAD project file.');
    }
    const p = newProject(raw.name, raw.units);
    const seen = new Set();
    let bays = 0;
    for (const r of raw.objects.slice(0, MAX_OBJECTS)) {
      const o = sanitizeObject(r);
      if (!o) continue;
      if (o.type === 'rack' && (bays += o.bays * o.rows) > MAX_TOTAL_BAYS) {
        throw new Error('Project is too large to open (too many rack bays).');
      }
      if (seen.has(o.id)) o.id = newId();
      seen.add(o.id);
      p.objects.push(o);
    }
    return p;
  }

  function serialize(project) {
    return JSON.stringify({ app: 'warehouse-cad', version: 1, name: project.name,
      units: project.units, objects: project.objects });
  }

  // ---- units ---------------------------------------------------------------
  const MM_PER_FT = 304.8;
  function fmtLen(mm, units) {
    if (units === 'imperial') {
      const sign = mm < 0 ? '-' : '';
      let inch = Math.round(Math.abs(mm) / 25.4);
      const ft = Math.floor(inch / 12);
      inch -= ft * 12;
      return `${sign}${ft}'-${inch}"`;
    }
    return (mm / 1000).toFixed(2) + ' m';
  }
  function fmtArea(mm2, units) {
    const v = units === 'imperial' ? mm2 / (MM_PER_FT * MM_PER_FT) : mm2 / 1e6;
    return Math.round(v).toLocaleString('en-US') + (units === 'imperial' ? ' ft²' : ' m²');
  }
  /** mm -> display number (metres or feet). */
  const toDisplay = (mm, units) => (units === 'imperial' ? mm / MM_PER_FT : mm / 1000);
  const fromDisplay = (v, units) => (units === 'imperial' ? v * MM_PER_FT : v * 1000);
  const unitLabel = (units) => (units === 'imperial' ? 'ft' : 'm');

  // ---- geometry ------------------------------------------------------------
  function frame(x, y, deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const fn = (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c];
    fn.inv = (wx, wy) => { const dx = wx - x, dy = wy - y; return [dx * c + dy * s, -dx * s + dy * c]; };
    return fn;
  }
  /** Keep text readable: map an angle into (-90, 90]. */
  function readable(deg) {
    let a = ((deg % 360) + 360) % 360;
    if (a > 90 && a <= 270) a -= 180;
    else if (a > 270) a -= 360;
    return a;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    const qx = ax + t * dx, qy = ay + t * dy;
    return { d: Math.hypot(px - qx, py - qy), t, x: qx, y: qy };
  }

  function rackDims(o) {
    const L = o.bays * o.bayW;
    const D = o.kind === 'drivein' ? o.depth : o.rows === 2 ? 2 * o.depth + o.flue : o.depth;
    return { L, D };
  }
  function rackPositions(o) {
    if (o.kind === 'drivein') return o.bays * o.levels * Math.max(1, Math.floor(o.depth / o.palletD));
    if (o.kind === 'shelving') return o.bays * o.levels * o.rows;
    return o.bays * o.perBay * o.levels * o.rows;
  }

  /** Local-frame extents [x0, y0, x1, y1] for framed object types. */
  function localExtents(o) {
    switch (o.type) {
      case 'rack': { const { L, D } = rackDims(o); return [-L / 2, -D / 2, L / 2, D / 2]; }
      case 'zone': return [-o.w / 2, -o.h / 2, o.w / 2, o.h / 2];
      case 'column': return [-o.size / 2, -o.size / 2, o.size / 2, o.size / 2];
      case 'door': {
        const t = o.wallT / 2;
        if (o.kind === 'door') return [-o.w / 2, -t, o.w / 2, t + o.w];
        if (o.kind === 'overhead') return [-o.w / 2, -t, o.w / 2, t + 500];
        return [-o.w / 2, -t - 150, o.w / 2, t + 2400];
      }
      case 'text': { const w = textWidth(o.text, o.h); return [-w / 2, -o.h / 2, w / 2, o.h / 2]; }
      default: return null;
    }
  }
  const textWidth = (s, h) => String(s).length * h * 0.6;
  const objRot = (o) => (o.type === 'zone' || o.type === 'column' ? 0 : o.rot || 0);

  function objBBox(o) {
    if (o.type === 'wall') {
      const t = o.thick / 2;
      return [Math.min(o.x1, o.x2) - t, Math.min(o.y1, o.y2) - t, Math.max(o.x1, o.x2) + t, Math.max(o.y1, o.y2) + t];
    }
    if (o.type === 'arrow' || o.type === 'dim') {
      const pts = [[o.x1, o.y1], [o.x2, o.y2]];
      if (o.type === 'dim') { const g = dimGeom(o); pts.push(g.a, g.b); }
      return bboxOf(pts, 300);
    }
    const e = localExtents(o);
    const f = frame(o.x, o.y, objRot(o));
    return bboxOf([f(e[0], e[1]), f(e[2], e[1]), f(e[2], e[3]), f(e[0], e[3])], 0);
  }
  function bboxOf(pts, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  function unionBBox(boxes) {
    let b = null;
    for (const x of boxes) {
      if (!x || !Number.isFinite(x[0])) continue;
      b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x.slice();
    }
    return b;
  }

  function hitTest(o, x, y, tol) {
    switch (o.type) {
      case 'wall': return distSeg(x, y, o.x1, o.y1, o.x2, o.y2).d <= o.thick / 2 + tol;
      case 'arrow': return distSeg(x, y, o.x1, o.y1, o.x2, o.y2).d <= tol * 1.5;
      case 'dim': {
        const g = dimGeom(o);
        return distSeg(x, y, g.a[0], g.a[1], g.b[0], g.b[1]).d <= tol * 1.5 ||
          Math.hypot(x - g.mid[0], y - g.mid[1]) <= o.th + tol;
      }
      default: {
        const e = localExtents(o);
        const [lx, ly] = frame(o.x, o.y, objRot(o)).inv(x, y);
        return lx >= e[0] - tol && lx <= e[2] + tol && ly >= e[1] - tol && ly <= e[3] + tol;
      }
    }
  }

  function dimGeom(o) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = uy, ny = -ux; // left-hand normal (up for a left-to-right dim)
    const a = [o.x1 + nx * o.off, o.y1 + ny * o.off];
    const b = [o.x2 + nx * o.off, o.y2 + ny * o.off];
    const side = o.off >= 0 ? 1 : -1;
    const mid = [(a[0] + b[0]) / 2 + nx * side * o.th * 0.8, (a[1] + b[1]) / 2 + ny * side * o.th * 0.8];
    return { a, b, ux, uy, nx, ny, len: Math.hypot(dx, dy), mid, side };
  }

  function translate(o, dx, dy) {
    if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; } else { o.x += dx; o.y += dy; }
  }
  function rotate90(o) {
    if ('x1' in o) {
      const cx = (o.x1 + o.x2) / 2, cy = (o.y1 + o.y2) / 2;
      const r = (x, y) => [cx - (y - cy), cy + (x - cx)];
      [o.x1, o.y1] = r(o.x1, o.y1);
      [o.x2, o.y2] = r(o.x2, o.y2);
    } else if (o.type === 'zone') {
      [o.w, o.h] = [o.h, o.w];
    } else if ('rot' in o) {
      o.rot = (o.rot + 90) % 360;
    }
  }

  // ---- primitives ----------------------------------------------------------
  // line: {t:'line', a, b, stroke, w, dash}
  // poly: {t:'poly', pts, closed, fill, alpha, stroke, w, dash, solid, mask}
  // text: {t:'text', x, y, s, h, rot, color}
  // Colours are palette keys (wall, door, ...) or literal hex values.

  function rectPts(f, x0, y0, x1, y1) { return [f(x0, y0), f(x1, y0), f(x1, y1), f(x0, y1)]; }

  function objPrims(o, units) {
    const out = [];
    const layer = TYPE_LAYER[o.type];
    const push = (p) => { p.layer = layer; p.oid = o.id; out.push(p); };

    switch (o.type) {
      case 'wall': {
        const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
        const len = Math.hypot(dx, dy);
        const t = o.thick / 2;
        const ux = len ? dx / len : 1, uy = len ? dy / len : 0;
        const nx = -uy * t, ny = ux * t;
        const ax = o.x1 - ux * t, ay = o.y1 - uy * t, bx = o.x2 + ux * t, by = o.y2 + uy * t;
        push({ t: 'poly', closed: true, solid: true, fill: 'wall', stroke: 'wall', w: 'thin',
          pts: [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]] });
        break;
      }
      case 'column': {
        const f = frame(o.x, o.y, 0), h = o.size / 2;
        push({ t: 'poly', closed: true, solid: true, fill: 'column', stroke: 'column', w: 'thin',
          pts: rectPts(f, -h, -h, h, h) });
        break;
      }
      case 'door': doorPrims(o, push); break;
      case 'rack': rackPrims(o, push); break;
      case 'zone': {
        const z = ZONE_KINDS[o.kind];
        const f = frame(o.x, o.y, 0);
        push({ t: 'poly', closed: true, fill: z.color, alpha: 0.16, stroke: z.color, w: 'med', dash: true,
          pts: rectPts(f, -o.w / 2, -o.h / 2, o.w / 2, o.h / 2), aci: z.aci });
        const h = clamp(Math.min(o.w, o.h) * 0.07, 150, 1500);
        const title = o.name || z.label;
        const fit = Math.min(h, (o.w * 0.9) / Math.max(1, title.length * 0.6));
        push({ t: 'text', x: o.x, y: o.y - fit * 0.7, s: title, h: fit, rot: 0, color: 'text' });
        push({ t: 'text', x: o.x, y: o.y + fit * 0.7, s: fmtArea(o.w * o.h, units), h: fit * 0.7, rot: 0, color: z.color, aci: z.aci });
        break;
      }
      case 'arrow': {
        const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const hl = clamp(len * 0.2, 300, 1500), hw = hl * 0.45;
        const bx = o.x2 - ux * hl, by = o.y2 - uy * hl;
        push({ t: 'line', a: [o.x1, o.y1], b: [bx, by], stroke: 'flow', w: 'thick' });
        push({ t: 'poly', closed: true, solid: true, fill: 'flow', stroke: 'flow', w: 'thin',
          pts: [[o.x2, o.y2], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]] });
        break;
      }
      case 'dim': {
        const g = dimGeom(o);
        const ext = 150 * g.side, gap = 100 * g.side;
        push({ t: 'line', a: [o.x1 + g.nx * gap, o.y1 + g.ny * gap], b: [g.a[0] + g.nx * ext, g.a[1] + g.ny * ext], stroke: 'dim', w: 'thin' });
        push({ t: 'line', a: [o.x2 + g.nx * gap, o.y2 + g.ny * gap], b: [g.b[0] + g.nx * ext, g.b[1] + g.ny * ext], stroke: 'dim', w: 'thin' });
        push({ t: 'line', a: g.a, b: g.b, stroke: 'dim', w: 'thin' });
        const tk = o.th * 0.5;
        const tx = (g.ux + g.nx) * tk * 0.707, ty = (g.uy + g.ny) * tk * 0.707;
        for (const p of [g.a, g.b]) push({ t: 'line', a: [p[0] - tx, p[1] - ty], b: [p[0] + tx, p[1] + ty], stroke: 'dim', w: 'med' });
        const ang = (Math.atan2(g.uy, g.ux) * 180) / Math.PI;
        push({ t: 'text', x: g.mid[0], y: g.mid[1], s: fmtLen(g.len, units), h: o.th, rot: readable(ang), color: 'dim' });
        break;
      }
      case 'text':
        push({ t: 'text', x: o.x, y: o.y, s: o.text, h: o.h, rot: readable(o.rot), color: 'text' });
        break;
    }
    return out;
  }

  function doorPrims(o, push) {
    const f = frame(o.x, o.y, o.rot);
    const w2 = o.w / 2, t = o.wallT / 2;
    if (t > 0) push({ t: 'poly', closed: true, mask: true, fill: 'bg', pts: rectPts(f, -w2, -t, w2, t) });
    push({ t: 'line', a: f(-w2, -t), b: f(-w2, t), stroke: 'door', w: 'med' });
    push({ t: 'line', a: f(w2, -t), b: f(w2, t), stroke: 'door', w: 'med' });
    const label = (text, y, h) => {
      if (!text) return;
      const p = f(0, y);
      const fit = Math.min(h, (o.w * 0.9) / Math.max(1, text.length * 0.6));
      push({ t: 'text', x: p[0], y: p[1], s: text, h: fit, rot: readable(o.rot), color: 'door' });
    };
    if (o.kind === 'door') {
      push({ t: 'line', a: f(-w2, t), b: f(-w2, t + o.w), stroke: 'door', w: 'med' });
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * (Math.PI / 2);
        pts.push(f(-w2 + o.w * Math.cos(a), t + o.w * Math.sin(a)));
      }
      push({ t: 'poly', closed: false, pts, stroke: 'door', w: 'thin', dash: true });
      label(o.label, t + o.w * 0.35, 250);
    } else if (o.kind === 'overhead') {
      push({ t: 'poly', closed: true, pts: rectPts(f, -w2, t, w2, t + 500), stroke: 'door', w: 'thin', dash: true });
      label(o.label || 'OH', t + 250, 300);
    } else {
      const lw = Math.max(300, Math.min(o.w - 300, 2100)) / 2;
      push({ t: 'poly', closed: true, pts: rectPts(f, -lw, t, lw, t + 2400), stroke: 'door', w: 'thin', dash: true });
      for (const sx of [-1, 1]) {
        const cx = sx * (w2 - 250);
        push({ t: 'poly', closed: true, solid: true, fill: 'door', stroke: 'door', w: 'thin',
          pts: rectPts(f, cx - 125, -t - 150, cx + 125, -t) });
      }
      label(o.label || 'DOCK', t + 1200, 350);
    }
  }

  function rackPrims(o, push) {
    const f = frame(o.x, o.y, o.rot);
    const { L, D } = rackDims(o);
    const color = o.kind === 'shelving' ? 'shelf' : o.kind === 'drivein' ? 'drivein' : 'rack';
    const x0 = -L / 2;
    const bands = o.kind !== 'drivein' && o.rows === 2
      ? [[-D / 2, -D / 2 + o.depth], [D / 2 - o.depth, D / 2]]
      : [[-D / 2, D / 2]];
    for (const [y0, y1] of bands) {
      push({ t: 'poly', closed: true, pts: rectPts(f, x0, y0, L / 2, y1), stroke: color, w: 'med' });
      for (let i = 1; i < o.bays; i++) {
        const x = x0 + i * o.bayW;
        push({ t: 'line', a: f(x, y0), b: f(x, y1), stroke: color, w: 'thin' });
      }
    }
    if (o.kind === 'drivein') {
      for (let i = 0; i < o.bays; i++) {
        const x = x0 + (i + 0.5) * o.bayW;
        push({ t: 'line', a: f(x, -D / 2 + 150), b: f(x, D / 2 - 150), stroke: color, w: 'thin', dash: true });
      }
    }
    const n = rackPositions(o);
    const s = `${o.name ? o.name + '  ' : ''}${n.toLocaleString('en-US')} ${o.kind === 'shelving' ? 'loc' : 'plt'}`;
    const h = Math.min(clamp(D * 0.28, 120, 450), (L * 0.9) / Math.max(1, s.length * 0.6));
    // Background plate so bay lines do not run through the label (skipped in DXF).
    const tf = frame(o.x, o.y, readable(o.rot));
    const pw = s.length * h * 0.3 + h * 0.3, ph = h * 0.7;
    push({ t: 'poly', closed: true, mask: true, plate: h, fill: 'bg', pts: rectPts(tf, -pw, -ph, pw, ph) });
    push({ t: 'text', x: o.x, y: o.y, s, h, rot: readable(o.rot), color: 'text' });
  }

  function projectPrims(project) {
    const objs = project.objects.slice().sort((a, b) => LAYER_ORDER[TYPE_LAYER[a.type]] - LAYER_ORDER[TYPE_LAYER[b.type]]);
    const out = [];
    for (const o of objs) for (const p of objPrims(o, project.units)) out.push(p);
    return out;
  }

  function primBBox(p) {
    if (p.t === 'line') return bboxOf([p.a, p.b], 0);
    if (p.t === 'poly') return bboxOf(p.pts, 0);
    const w = textWidth(p.s, p.h) / 2;
    return [p.x - w, p.y - p.h, p.x + w, p.y + p.h];
  }
  const primsBBox = (prims) => unionBBox(prims.map(primBBox));

  // ---- statistics -----------------------------------------------------------
  function computeStats(project) {
    const st = {
      footprint: 0, zones: {}, racks: 0, pallets: 0, shelfLocs: 0, rackArea: 0,
      doors: { door: 0, overhead: 0, dock: 0 }, columns: 0, walls: 0, wallLen: 0,
    };
    const wallBoxes = [];
    for (const o of project.objects) {
      switch (o.type) {
        case 'wall': st.walls++; st.wallLen += Math.hypot(o.x2 - o.x1, o.y2 - o.y1); wallBoxes.push(objBBox(o)); break;
        case 'zone': {
          const z = (st.zones[o.kind] = st.zones[o.kind] || { count: 0, area: 0 });
          z.count++; z.area += o.w * o.h; break;
        }
        case 'rack': {
          st.racks++;
          const { L, D } = rackDims(o);
          st.rackArea += L * D;
          if (o.kind === 'shelving') st.shelfLocs += rackPositions(o); else st.pallets += rackPositions(o);
          break;
        }
        case 'door': st.doors[o.kind]++; break;
        case 'column': st.columns++; break;
      }
    }
    const b = unionBBox(wallBoxes);
    if (b) st.footprint = (b[2] - b[0]) * (b[3] - b[1]);
    st.utilization = st.footprint ? st.rackArea / st.footprint : 0;
    return st;
  }

  // ---- racking auto-layout -----------------------------------------------------
  /**
   * Fill a rectangle {x, y, w, h} (x, y = top-left) with rack rows.
   * opt: dir 'h'|'v', kind, depth, flue, aisle, bayW, levels, perBay, palletD,
   *      b2b (back-to-back), edgeSingle, crossEvery (bays per run, 0 = none), crossW, prefix.
   */
  function autoLayout(area, opt) {
    const horiz = opt.dir !== 'v';
    const U = horiz ? area.w : area.h; // along rows
    const V = horiz ? area.h : area.w; // across rows
    const sgl = opt.depth;
    const dbl = 2 * opt.depth + opt.flue;
    const a = opt.aisle;
    const seq = []; // {v0, rows}
    let pos = 0;

    if (opt.b2b && opt.kind !== 'drivein') {
      if (opt.edgeSingle) {
        if (sgl <= V) { seq.push({ v0: 0, rows: 1 }); pos = sgl; }
      }
      if (!opt.edgeSingle || seq.length) {
        while (pos + a + dbl + a <= V + 1e-6) { seq.push({ v0: pos + a, rows: 2 }); pos += a + dbl; }
        if (opt.edgeSingle && pos + a + sgl <= V + 1e-6) { seq.push({ v0: pos + a, rows: 1 }); pos += a + sgl; }
        else if (!opt.edgeSingle && seq.length) pos += a;
      }
    } else {
      while (pos + sgl + a + sgl <= V + 1e-6) {
        seq.push({ v0: pos, rows: 1 }, { v0: pos + sgl + a, rows: 1 });
        pos += 2 * sgl + a;
      }
      if (pos + sgl + a <= V + 1e-6) { seq.push({ v0: pos, rows: 1 }); pos += sgl + a; }
    }

    // Runs along the row axis, split by cross aisles.
    let total = Math.floor((U + 1e-6) / opt.bayW);
    const runs = [];
    if (total > 0) {
      if (opt.crossEvery > 0) {
        let u = 0;
        while (total > 0) {
          const n = Math.min(opt.crossEvery, total);
          if (u + n * opt.bayW > U + 1e-6) break;
          runs.push({ u0: u, bays: n });
          u += n * opt.bayW + opt.crossW;
          total -= n;
          if (u + opt.bayW > U + 1e-6) break;
        }
      } else {
        runs.push({ u0: 0, bays: total });
      }
    }
    const bayCount = seq.length * runs.reduce((a, r) => a + r.bays, 0);
    if (bayCount > MAX_TOTAL_BAYS / 2) return { racks: [], positions: 0, rows: seq.length, runs: runs.length, tooLarge: true };
    const usedU = runs.length ? runs[runs.length - 1].u0 + runs[runs.length - 1].bays * opt.bayW : 0;
    const offU = (U - usedU) / 2;
    const offV = (V - pos) / 2;

    const racks = [];
    let n = 1;
    for (const r of seq) {
      const depthAcross = opt.kind === 'drivein' ? sgl : r.rows === 2 ? dbl : sgl;
      for (const run of runs) {
        const cu = offU + run.u0 + (run.bays * opt.bayW) / 2;
        const cv = offV + r.v0 + depthAcross / 2;
        racks.push(makeObject('rack', {
          x: area.x + (horiz ? cu : cv), y: area.y + (horiz ? cv : cu), rot: horiz ? 0 : 90,
          name: (opt.prefix || 'R') + n++, kind: opt.kind, bays: run.bays, bayW: opt.bayW,
          depth: opt.depth, rows: opt.kind === 'drivein' ? 1 : r.rows, flue: opt.flue,
          levels: opt.levels, perBay: opt.perBay, palletD: opt.palletD,
        }));
      }
    }
    const positions = racks.reduce((s, r) => s + rackPositions(r), 0);
    return { racks, positions, rows: seq.length, runs: runs.length };
  }

  Object.assign(W, {
    MAX_COORD, MAX_OBJECTS, MAX_TOTAL_BAYS, LAYERS, LAYER_ORDER, TYPE_LAYER, TYPE_LABEL, ZONE_KINDS, DOOR_KINDS, RACK_KINDS, SCHEMA,
    clamp, sanitizeValue, newId, makeObject, sanitizeObject, newProject, sanitizeProject, serialize,
    fmtLen, fmtArea, toDisplay, fromDisplay, unitLabel, MM_PER_FT,
    frame, readable, distSeg, rackDims, rackPositions, localExtents, objRot, objBBox, bboxOf, unionBBox,
    hitTest, dimGeom, translate, rotate90, objPrims, projectPrims, primBBox, primsBBox, textWidth,
    computeStats, autoLayout,
  });
})(typeof window !== 'undefined' ? window : globalThis);

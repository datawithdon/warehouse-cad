/*
 * Warehouse CAD - application controller: tools, interaction, panels, files.
 * All user-provided text is rendered with textContent / canvas, never as HTML.
 */
(function () {
  'use strict';
  const W = window.WCAD;
  const $ = (sel) => document.querySelector(sel);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const AUTOSAVE_KEY = 'warehouse-cad:autosave';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const HILITE = '#38bdf8';
  const GHOST = '#fbbf24';

  /** Minimal DOM builder; strings become text nodes. */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
    return e;
  }

  // ---- tools -------------------------------------------------------------------
  const ICONS = {
    select: 'M5 3l13 7.5-5.5 1.5L10 18z',
    pan: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
    wall: 'M3 6h18v4H3zM14 10v9h4v-9',
    room: 'M4 4h16v16H4zM7.5 7.5h9v9h-9z',
    column: 'M7 7h10v10H7zM7 7l10 10M17 7L7 17',
    door: 'M3 20h5M16 20h5M8 20V8a12 12 0 0 1 12 12',
    overhead: 'M3 20V6h18v14M6 9h12M6 12h12M6 15h12M6 18h12',
    dock: 'M3 20V8h18v12M7 20v-8h10v8M10 15h4',
    rack: 'M3 5h18v5H3zM3 14h18v5H3zM9 5v5M15 5v5M9 14v5M15 14v5',
    layout: 'M3 3h18v18H3zM6 6h12v2.5H6zM6 10.75h12v2.5H6zM6 15.5h12V18H6z',
    zone: 'M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8',
    arrow: 'M4 12h14M13 6l6 6-6 6',
    dim: 'M4 6v12M20 6v12M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3',
    text: 'M5 7V4h14v3M12 4v16M9 20h6',
    measure: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  };
  const TOOLS = [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click to select, drag to move, drag on empty space to box-select. R rotates, Del deletes.' },
    { id: 'pan', label: 'Pan', key: 'h', hint: 'Drag to pan. Scroll to zoom. Hold Space with any tool to pan.' },
    { sep: 'Building' },
    { id: 'wall', label: 'Wall', key: 'w', type: 'wall', hint: 'Click points to draw connected walls. Enter, Esc or right-click ends the chain. Shift inverts ortho.' },
    { id: 'room', label: 'Room', key: 'b', type: 'wall', hint: 'Drag a rectangle to create four walls.' },
    { id: 'column', label: 'Column', key: 'c', type: 'column', hint: 'Click to place a building column.' },
    { id: 'door', label: 'Door', key: 'd', type: 'door', kind: 'door', hint: 'Click on or near a wall to place a door. R flips it.' },
    { id: 'overhead', label: 'Overhead', key: 'o', type: 'door', kind: 'overhead', hint: 'Click on or near a wall to place an overhead door. R flips it.' },
    { id: 'dock', label: 'Dock door', key: 'k', type: 'door', kind: 'dock', hint: 'Click on or near a wall to place a dock door. The leveler goes inside. R flips it.' },
    { sep: 'Storage & flow' },
    { id: 'rack', label: 'Rack', key: 's', type: 'rack', hint: 'Drag along a rack run. Bays are fitted to the length you drag.' },
    { id: 'layout', label: 'Auto layout', key: 'l', hint: 'Drag over a storage area to fill it with rack rows and aisles.' },
    { id: 'zone', label: 'Zone', key: 'z', type: 'zone', hint: 'Drag a rectangle to create an operational zone.' },
    { id: 'arrow', label: 'Flow arrow', key: 'f', type: 'arrow', hint: 'Click (or drag) from start to end of a material-flow arrow.' },
    { sep: 'Annotate' },
    { id: 'dim', label: 'Dimension', key: 'm', type: 'dim', hint: 'Click two points to add a dimension. Set its offset in Properties.' },
    { id: 'text', label: 'Text', key: 't', type: 'text', hint: 'Click to place a text label.' },
    { id: 'measure', label: 'Measure', key: 'e', hint: 'Click two points to measure a distance. Nothing is saved.' },
  ];
  const TOOL_BY_ID = Object.fromEntries(TOOLS.filter((t) => t.id).map((t) => [t.id, t]));
  const TOOL_BY_KEY = Object.fromEntries(TOOLS.filter((t) => t.key).map((t) => [t.key, t.id]));

  const SNAPS = {
    metric: [[0, 'Off'], [50, '50 mm'], [100, '100 mm'], [250, '250 mm'], [500, '500 mm'], [1000, '1 m']],
    imperial: [[0, 'Off'], [25.4, '1"'], [152.4, '6"'], [304.8, "1'"], [609.6, "2'"], [1524, "5'"]],
  };

  const LAYOUT_FIELDS = [
    { k: 'dir', l: 'Row direction', t: 'enum', opts: { h: { label: 'Horizontal' }, v: { label: 'Vertical' } }, d: 'h' },
    { k: 'kind', l: 'Rack type', t: 'enum', opts: W.RACK_KINDS, d: 'selective' },
    { k: 'depth', l: 'Rack depth (per row / lane)', t: 'len', d: 1100, min: 200, max: 50000 },
    { k: 'aisle', l: 'Aisle width', t: 'len', d: 3000, min: 500, max: 20000 },
    { k: 'bayW', l: 'Bay / lane width', t: 'len', d: 2700, min: 300, max: 20000 },
    { k: 'flue', l: 'Flue gap (back-to-back)', t: 'len', d: 300, min: 0, max: 3000 },
    { k: 'levels', l: 'Levels', t: 'int', d: 5, min: 1, max: 40 },
    { k: 'perBay', l: 'Pallets per bay', t: 'int', d: 2, min: 1, max: 20 },
    { k: 'palletD', l: 'Pallet depth (drive-in)', t: 'len', d: 1200, min: 300, max: 5000 },
    { k: 'crossEvery', l: 'Cross aisle every N bays (0 = none)', t: 'int', d: 20, min: 0, max: 2000 },
    { k: 'crossW', l: 'Cross aisle width', t: 'len', d: 3000, min: 500, max: 20000 },
    { k: 'prefix', l: 'Rack name prefix', t: 'str', d: 'A', max: 8 },
    { k: 'b2b', l: 'Back-to-back double rows', t: 'bool', d: true },
    { k: 'edgeSingle', l: 'Single rows along the edges', t: 'bool', d: true },
    { k: 'replace', l: 'Replace racks inside the area', t: 'bool', d: true },
  ];

  // ---- state -------------------------------------------------------------------
  const state = {
    project: W.newProject(),
    sel: new Set(),
    tool: 'select',
    view: { s: 0.015, ox: 40, oy: 40 },
    snap: 500,
    gridOn: true,
    ortho: true,
    layers: Object.fromEntries(W.LAYERS.map((l) => [l.id, { visible: true, locked: false }])),
    defaults: {},
    layoutOpt: Object.fromEntries(LAYOUT_FIELDS.map((f) => [f.k, f.d])),
    doorFlip: false,
    op: null,
    cursor: null,
    raw: null,
    snapMark: null,
    measure: null,
    shift: false,
    space: false,
  };
  for (const t of TOOLS) {
    if (!t.type) continue;
    const props = t.kind ? { kind: t.kind, w: W.DOOR_KINDS[t.kind].w } : {};
    state.defaults[t.id] = W.makeObject(t.type, props);
  }

  const undoStack = [];
  const redoStack = [];
  let primCache = null;
  let primsById = null;

  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let dpr = window.devicePixelRatio || 1;
  let cssW = 0, cssH = 0;

  const units = () => state.project.units;
  const fmt = (mm) => W.fmtLen(mm, units());

  // ---- model helpers ---------------------------------------------------------------
  function getPrims() {
    if (!primCache) {
      primCache = W.projectPrims(state.project);
      primsById = new Map();
      for (const p of primCache) {
        let a = primsById.get(p.oid);
        if (!a) primsById.set(p.oid, (a = []));
        a.push(p);
      }
    }
    return primCache;
  }
  const byId = (id) => state.project.objects.find((o) => o.id === id);
  const selected = () => state.project.objects.filter((o) => state.sel.has(o.id));
  const layerOf = (o) => state.layers[W.TYPE_LAYER[o.type]];
  const editable = (o) => { const l = layerOf(o); return l.visible && !l.locked; };
  const hiddenLayers = () => new Set(W.LAYERS.filter((l) => !state.layers[l.id].visible).map((l) => l.id));

  function checkpoint() {
    undoStack.push(JSON.stringify(state.project));
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(json) {
    state.project = JSON.parse(json);
    for (const id of [...state.sel]) if (!byId(id)) state.sel.delete(id);
    changed();
  }
  function doUndo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state.project));
    restore(undoStack.pop());
  }
  function doRedo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state.project));
    restore(redoStack.pop());
  }

  let saveTimer = 0;
  function changed(opts = {}) {
    primCache = null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 500);
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
    if (!opts.keepPanel) renderPanel();
    renderLayers();
    renderStats();
    requestDraw();
  }
  function autosave() {
    try { localStorage.setItem(AUTOSAVE_KEY, W.serialize(state.project)); } catch (_) { /* storage unavailable */ }
  }

  function addObjects(objs, select = true) {
    checkpoint();
    for (const o of objs) state.project.objects.push(o);
    if (select) { state.sel = new Set(objs.map((o) => o.id)); }
    changed();
  }
  function deleteSelection() {
    const ids = new Set(selected().filter(editable).map((o) => o.id));
    if (!ids.size) return;
    checkpoint();
    state.project.objects = state.project.objects.filter((o) => !ids.has(o.id));
    state.sel.clear();
    changed();
  }
  function duplicateSelection() {
    const src = selected().filter(editable);
    if (!src.length) return;
    const d = state.snap || 1000;
    const copies = src.map((o) => { const c = W.makeObject(o.type, { ...o, id: undefined }); W.translate(c, d * 2, d * 2); return c; });
    addObjects(copies);
  }
  function rotateSelection() {
    const objs = selected().filter(editable);
    if (!objs.length) return;
    checkpoint();
    objs.forEach(W.rotate90);
    changed();
  }
  function nudge(dx, dy) {
    const objs = selected().filter(editable);
    if (!objs.length) return;
    checkpoint();
    objs.forEach((o) => W.translate(o, dx, dy));
    changed();
  }
  function nextRackName(prefix = 'R') {
    let n = 1;
    const names = new Set(state.project.objects.filter((o) => o.type === 'rack').map((o) => o.name));
    while (names.has(prefix + n)) n++;
    return prefix + n;
  }

  // ---- view ------------------------------------------------------------------------
  const toWorld = (sx, sy) => [(sx - state.view.ox) / state.view.s, (sy - state.view.oy) / state.view.s];
  const toScreen = (x, y) => [x * state.view.s + state.view.ox, y * state.view.s + state.view.oy];

  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = Math.max(1, Math.floor(r.width));
    cssH = Math.max(1, Math.floor(r.height));
    cv.width = Math.floor(cssW * dpr);
    cv.height = Math.floor(cssH * dpr);
    requestDraw();
  }
  function fitView() {
    const bb = W.primsBBox(getPrims()) || [0, 0, 60000, 40000];
    const pad = 50;
    const w = Math.max(bb[2] - bb[0], 1000), hgt = Math.max(bb[3] - bb[1], 1000);
    const s = Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / hgt);
    state.view.s = W.clamp(s, 0.0005, 5);
    state.view.ox = cssW / 2 - ((bb[0] + bb[2]) / 2) * state.view.s;
    state.view.oy = cssH / 2 - ((bb[1] + bb[3]) / 2) * state.view.s;
    requestDraw();
  }
  function zoomAt(sx, sy, factor) {
    const [wx, wy] = toWorld(sx, sy);
    state.view.s = W.clamp(state.view.s * factor, 0.0005, 5);
    state.view.ox = sx - wx * state.view.s;
    state.view.oy = sy - wy * state.view.s;
    updateStatus();
    requestDraw();
  }

  // ---- snapping --------------------------------------------------------------------
  function keyPoints(o) {
    switch (o.type) {
      case 'wall': case 'arrow': case 'dim': return [[o.x1, o.y1], [o.x2, o.y2]];
      case 'column': return [[o.x, o.y]];
      case 'zone': case 'rack': {
        const e = W.localExtents(o), f = W.frame(o.x, o.y, W.objRot(o));
        return [f(e[0], e[1]), f(e[2], e[1]), f(e[2], e[3]), f(e[0], e[3])];
      }
      default: return [];
    }
  }
  function gridSnap(p) {
    const g = state.snap;
    return g ? [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g] : p.slice();
  }
  function snapPoint(p, exclude) {
    const tol = 10 / state.view.s;
    let best = null, bd = tol;
    for (const o of state.project.objects) {
      if (exclude && exclude.has(o.id)) continue;
      if (!layerOf(o).visible) continue;
      for (const k of keyPoints(o)) {
        const d = Math.hypot(k[0] - p[0], k[1] - p[1]);
        if (d < bd) { bd = d; best = k; }
      }
    }
    state.snapMark = best;
    return best ? best.slice() : gridSnap(p);
  }
  function orthoFrom(p, from) {
    if (!from || state.ortho === state.shift) return p;
    return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
  }

  // ---- picking ---------------------------------------------------------------------
  function pick(p) {
    const tol = 5 / state.view.s;
    const objs = state.project.objects;
    const order = W.LAYERS.map((l) => l.id).reverse();
    for (const layer of order) {
      if (!state.layers[layer].visible || state.layers[layer].locked) continue;
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (W.TYPE_LAYER[o.type] === layer && W.hitTest(o, p[0], p[1], tol)) return o;
      }
    }
    return null;
  }
  function handlesOf(o) {
    if (o.type === 'wall' || o.type === 'arrow' || o.type === 'dim') return [{ k: 1, p: [o.x1, o.y1] }, { k: 2, p: [o.x2, o.y2] }];
    if (o.type === 'zone') return keyPoints(o).map((p, i) => ({ k: 'c' + i, p }));
    return [];
  }
  function pickHandle(sx, sy) {
    if (state.sel.size !== 1) return null;
    const o = byId([...state.sel][0]);
    if (!o || !editable(o)) return null;
    for (const hd of handlesOf(o)) {
      const [hx, hy] = toScreen(hd.p[0], hd.p[1]);
      if (Math.abs(hx - sx) <= 7 && Math.abs(hy - sy) <= 7) return { o, hd };
    }
    return null;
  }

  // ---- object factories from tools -----------------------------------------------------
  function doorAt(raw, toolId) {
    const d = state.defaults[toolId];
    let p = gridSnap(raw);
    let rot = d.rot, wallT = d.wallT;
    let best = null;
    const lim = Math.max(1500, 20 / state.view.s);
    for (const o of state.project.objects) {
      if (o.type !== 'wall' || !layerOf(o).visible) continue;
      const r = W.distSeg(raw[0], raw[1], o.x1, o.y1, o.x2, o.y2);
      if (r.d < lim && (!best || r.d < best.r.d)) best = { r, o };
    }
    if (best) {
      const o = best.o;
      const q = W.distSeg(p[0], p[1], o.x1, o.y1, o.x2, o.y2);
      p = [q.x, q.y];
      rot = (Math.atan2(o.y2 - o.y1, o.x2 - o.x1) * 180) / Math.PI;
      wallT = o.thick + 20;
    }
    if (state.doorFlip) rot += 180;
    return W.makeObject('door', { ...d, id: undefined, x: p[0], y: p[1], rot, wallT });
  }
  function rectFrom(a, b) {
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  }
  function objectsForRect(tool, r) {
    if (tool === 'room') {
      const t = state.defaults.room.thick;
      const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
      return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
        .map(([a, b, c, d]) => W.makeObject('wall', { x1: a, y1: b, x2: c, y2: d, thick: t }));
    }
    if (tool === 'zone') {
      return [W.makeObject('zone', { ...state.defaults.zone, id: undefined, x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h })];
    }
    if (tool === 'rack') {
      const d = state.defaults.rack;
      const horiz = r.w >= r.h;
      const len = horiz ? r.w : r.h;
      return [W.makeObject('rack', {
        ...d, id: undefined, name: nextRackName(), x: r.x + r.w / 2, y: r.y + r.h / 2, rot: horiz ? 0 : 90,
        bays: Math.max(1, Math.round(len / d.bayW)),
      })];
    }
    if (tool === 'layout') return W.autoLayout(r, state.layoutOpt).racks;
    return [];
  }

  // ---- pointer interaction -------------------------------------------------------------
  function evtPos(e) {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  cv.addEventListener('pointerdown', (e) => {
    cv.focus();
    const [sx, sy] = evtPos(e);
    const raw = toWorld(sx, sy);
    state.shift = e.shiftKey;
    if (e.button === 1 || (e.button === 0 && (state.space || state.tool === 'pan'))) {
      state.op = { kind: 'pan', sx, sy, ox: state.view.ox, oy: state.view.oy };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('panning');
      return;
    }
    if (e.button === 2) { cancelOp(); return; }
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    const tool = state.tool;

    if (tool === 'select') {
      const hit = pickHandle(sx, sy);
      if (hit) { state.op = { kind: 'handle', id: hit.o.id, k: hit.hd.k, orig: { ...hit.o }, moved: false }; return; }
      const o = pick(raw);
      if (o) {
        if (e.shiftKey) {
          if (state.sel.has(o.id)) state.sel.delete(o.id); else state.sel.add(o.id);
        } else if (!state.sel.has(o.id)) {
          state.sel = new Set([o.id]);
        }
        const objs = selected().filter(editable);
        state.op = { kind: 'move', start: gridSnap(raw), orig: new Map(objs.map((x) => [x.id, { ...x }])), moved: false };
        renderPanel();
      } else {
        if (!e.shiftKey) state.sel.clear();
        state.op = { kind: 'box', a: raw, b: raw, sx, sy };
        renderPanel();
      }
      requestDraw();
      return;
    }

    const p = snapPoint(raw);
    switch (tool) {
      case 'wall': {
        if (state.op && state.op.kind === 'chain') {
          const q = orthoFrom(p, state.op.a);
          if (Math.hypot(q[0] - state.op.a[0], q[1] - state.op.a[1]) < 1) break;
          const w = W.makeObject('wall', { x1: state.op.a[0], y1: state.op.a[1], x2: q[0], y2: q[1], thick: state.defaults.wall.thick });
          addObjects([w], false);
          state.op = { kind: 'chain', a: q, first: state.op.first };
          if (Math.hypot(q[0] - state.op.first[0], q[1] - state.op.first[1]) < 1) state.op = null; // closed loop
        } else {
          state.op = { kind: 'chain', a: p, first: p };
        }
        break;
      }
      case 'room': case 'rack': case 'layout': case 'zone':
        state.op = { kind: 'rect', tool, a: p, b: p };
        break;
      case 'column':
        addObjects([W.makeObject('column', { ...state.defaults.column, id: undefined, x: p[0], y: p[1] })], false);
        break;
      case 'door': case 'overhead': case 'dock':
        addObjects([doorAt(raw, tool)], false);
        break;
      case 'text': {
        const s = window.prompt('Label text', state.defaults.text.text);
        if (s && s.trim()) addObjects([W.makeObject('text', { ...state.defaults.text, id: undefined, text: s.trim(), x: p[0], y: p[1] })], false);
        break;
      }
      case 'arrow': case 'dim': case 'measure':
        if (state.op && state.op.kind === 'two') finishTwo(orthoFrom(p, state.op.a));
        else { state.op = { kind: 'two', tool, a: p, sx, sy }; state.measure = null; }
        break;
    }
    requestDraw();
  });

  cv.addEventListener('pointermove', (e) => {
    const [sx, sy] = evtPos(e);
    const raw = toWorld(sx, sy);
    state.raw = raw;
    state.shift = e.shiftKey;
    const op = state.op;

    if (op && op.kind === 'pan') {
      state.view.ox = op.ox + sx - op.sx;
      state.view.oy = op.oy + sy - op.sy;
      requestDraw();
      return;
    }
    if (state.tool === 'select' || state.tool === 'pan') {
      state.cursor = raw;
      state.snapMark = null;
    } else {
      let p = snapPoint(raw);
      if (op && (op.kind === 'chain' || op.kind === 'two')) p = orthoFrom(p, op.a);
      state.cursor = p;
    }

    if (op && op.kind === 'move') {
      const g = gridSnap(raw);
      const dx = g[0] - op.start[0], dy = g[1] - op.start[1];
      if (!op.moved && (dx || dy)) { checkpoint(); op.moved = true; }
      if (op.moved) {
        for (const [id, orig] of op.orig) {
          const o = byId(id);
          if (!o) continue;
          Object.assign(o, orig);
          W.translate(o, dx, dy);
        }
        primCache = null;
      }
    } else if (op && op.kind === 'handle') {
      const o = byId(op.id);
      if (o) {
        if (!op.moved) { checkpoint(); op.moved = true; }
        let p = snapPoint(raw, new Set([o.id]));
        if (op.k === 1 || op.k === 2) {
          const other = op.k === 1 ? [o.x2, o.y2] : [o.x1, o.y1];
          if (o.type === 'wall') p = orthoFrom(p, other);
          if (op.k === 1) { o.x1 = p[0]; o.y1 = p[1]; } else { o.x2 = p[0]; o.y2 = p[1]; }
        } else {
          const i = Number(op.k.slice(1));
          const corners = keyPoints(op.orig);
          const opp = corners[(i + 2) % 4];
          o.w = Math.max(100, Math.abs(p[0] - opp[0]));
          o.h = Math.max(100, Math.abs(p[1] - opp[1]));
          o.x = (p[0] + opp[0]) / 2;
          o.y = (p[1] + opp[1]) / 2;
        }
        primCache = null;
      }
    } else if (op && op.kind === 'box') {
      op.b = raw;
    } else if (op && op.kind === 'rect') {
      op.b = state.cursor;
    }
    updateStatus();
    requestDraw();
  });

  cv.addEventListener('pointerup', (e) => {
    const op = state.op;
    if (!op) return;
    const [sx, sy] = evtPos(e);
    if (op.kind === 'pan') {
      state.op = null;
      cv.classList.remove('panning');
    } else if (op.kind === 'move' || op.kind === 'handle') {
      state.op = null;
      if (op.moved) changed(); else requestDraw();
    } else if (op.kind === 'box') {
      state.op = null;
      if (Math.hypot(sx - op.sx, sy - op.sy) > 4) {
        const r = [Math.min(op.a[0], op.b[0]), Math.min(op.a[1], op.b[1]), Math.max(op.a[0], op.b[0]), Math.max(op.a[1], op.b[1])];
        for (const o of state.project.objects) {
          if (!editable(o)) continue;
          const b = W.objBBox(o);
          if (b[0] <= r[2] && b[2] >= r[0] && b[1] <= r[3] && b[3] >= r[1]) state.sel.add(o.id);
        }
      }
      renderPanel();
      requestDraw();
    } else if (op.kind === 'rect') {
      state.op = null;
      const r = rectFrom(op.a, op.b);
      if (r.w < 100 || r.h < 100) {
        if (op.tool === 'rack' && Math.max(r.w, r.h) >= 100) {
          // a thin drag still defines a rack run
        } else { requestDraw(); return; }
      }
      if (op.tool === 'layout') openLayoutDialog(r);
      else addObjects(objectsForRect(op.tool, r));
    } else if (op.kind === 'two') {
      if (Math.hypot(sx - op.sx, sy - op.sy) > 8 && state.cursor) finishTwo(state.cursor);
    }
  });

  function finishTwo(b) {
    const op = state.op;
    state.op = null;
    if (!op || Math.hypot(b[0] - op.a[0], b[1] - op.a[1]) < 1) { requestDraw(); return; }
    if (op.tool === 'measure') {
      state.measure = { a: op.a, b };
      toast(`Distance ${fmt(Math.hypot(b[0] - op.a[0], b[1] - op.a[1]))}`);
      requestDraw();
      return;
    }
    const props = { x1: op.a[0], y1: op.a[1], x2: b[0], y2: b[1] };
    if (op.tool === 'dim') Object.assign(props, { th: state.defaults.dim.th, off: state.defaults.dim.off });
    addObjects([W.makeObject(op.tool, props)], false);
  }

  function cancelOp() {
    state.op = null;
    state.measure = null;
    cv.classList.remove('panning');
    requestDraw();
  }

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = evtPos(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(sx, sy, Math.exp(-dy * 0.0015));
  }, { passive: false });

  cv.addEventListener('pointerleave', () => { state.cursor = null; state.snapMark = null; requestDraw(); });

  // ---- keyboard -------------------------------------------------------------------
  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    state.shift = e.shiftKey;
    if (mod) {
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if (k === 'y') { e.preventDefault(); doRedo(); }
      else if (k === 's') { e.preventDefault(); saveProject(); }
      else if (k === 'o') { e.preventDefault(); $('#fileOpen').click(); }
      else if (k === 'd') { e.preventDefault(); duplicateSelection(); }
      else if (k === 'a') {
        e.preventDefault();
        state.sel = new Set(state.project.objects.filter(editable).map((o) => o.id));
        renderPanel(); requestDraw();
      }
      return;
    }
    if (e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); state.space = true; cv.classList.add('panning'); return; }
    if (e.key === 'Escape') {
      if (state.op || state.measure) cancelOp();
      else if (state.sel.size) { state.sel.clear(); renderPanel(); requestDraw(); }
      else setTool('select');
      return;
    }
    if (e.key === 'Enter') { if (state.op && state.op.kind === 'chain') cancelOp(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Home' || e.key === '0') { fitView(); return; }
    if (e.key === '+' || e.key === '=') { zoomAt(cssW / 2, cssH / 2, 1.25); return; }
    if (e.key === '-') { zoomAt(cssW / 2, cssH / 2, 0.8); return; }
    if (e.key === 'F8') { e.preventDefault(); toggleOrtho(); return; }
    if (e.key === '?') { $('#dlgHelp').showModal(); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = (state.snap || 100) * (e.shiftKey ? 10 : 1);
      const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      nudge(v[0], v[1]);
      return;
    }
    if (k === 'r') {
      if (['door', 'overhead', 'dock'].includes(state.tool)) { state.doorFlip = !state.doorFlip; requestDraw(); }
      else rotateSelection();
      return;
    }
    if (k === 'g') { toggleGrid(); return; }
    if (TOOL_BY_KEY[k]) setTool(TOOL_BY_KEY[k]);
  });
  window.addEventListener('keyup', (e) => {
    state.shift = e.shiftKey;
    if (e.key === ' ') { state.space = false; if (!state.op || state.op.kind !== 'pan') cv.classList.remove('panning'); }
  });
  window.addEventListener('blur', () => { state.space = false; state.shift = false; });

  // ---- drawing ------------------------------------------------------------------------
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  function drawGrid() {
    const { s, ox, oy } = state.view;
    let g = state.snap || (units() === 'imperial' ? 304.8 : 500);
    while (g * s < 12) g *= 5;
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(cssW, cssH);
    const major = g * 5;
    ctx.lineWidth = 1;
    for (const [step, alpha] of [[g, 0.05], [major, 0.11]]) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { const X = Math.round(x * s + ox) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, cssH); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const Y = Math.round(y * s + oy) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(cssW, Y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(56,189,248,0.25)';
    ctx.beginPath();
    ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, cssH);
    ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(cssW, Math.round(oy) + 0.5);
    ctx.stroke();
  }

  function label(text, sx, sy) {
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(15,18,22,0.85)';
    ctx.fillRect(sx + 12, sy + 10, w, 20);
    ctx.fillStyle = '#e6e9ee';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sx + 17, sy + 20);
  }
  function ghost(objs) {
    if (!objs.length) return;
    const prims = [];
    for (const o of objs) for (const p of W.objPrims(o, units())) if (!p.mask) prims.push(p);
    ctx.globalAlpha = 0.65;
    W.drawPrims(ctx, prims, state.view, W.PALETTES.screen, {});
    ctx.globalAlpha = 1;
  }
  function line(a, b, color, dash) {
    const [ax, ay] = toScreen(a[0], a[1]), [bx, by] = toScreen(b[0], b[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw() {
    const pal = W.PALETTES.screen;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (state.gridOn) drawGrid();

    const [vx0, vy0] = toWorld(0, 0), [vx1, vy1] = toWorld(cssW, cssH);
    const hidden = hiddenLayers();
    const prims = getPrims();
    W.drawPrims(ctx, prims, state.view, pal, { hidden, viewport: [vx0, vy0, vx1, vy1] });

    // selection
    if (state.sel.size) {
      const sp = [];
      for (const id of state.sel) for (const p of primsById.get(id) || []) sp.push(p);
      W.drawPrims(ctx, sp, state.view, pal, { hidden, override: HILITE });
      if (state.sel.size === 1) {
        const o = byId([...state.sel][0]);
        if (o) {
          ctx.fillStyle = '#0f1216';
          ctx.strokeStyle = HILITE;
          ctx.lineWidth = 1.5;
          for (const hd of handlesOf(o)) {
            const [x, y] = toScreen(hd.p[0], hd.p[1]);
            ctx.fillRect(x - 4, y - 4, 8, 8);
            ctx.strokeRect(x - 4, y - 4, 8, 8);
          }
        }
      }
    }

    // tool previews
    const op = state.op;
    const c = state.cursor;
    if (op && op.kind === 'box') {
      const [ax, ay] = toScreen(op.a[0], op.a[1]), [bx, by] = toScreen(op.b[0], op.b[1]);
      ctx.fillStyle = 'rgba(56,189,248,0.08)';
      ctx.strokeStyle = HILITE;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    } else if (op && op.kind === 'rect') {
      const r = rectFrom(op.a, op.b);
      const [ax, ay] = toScreen(r.x, r.y);
      ctx.strokeStyle = GHOST;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(ax + 0.5, ay + 0.5, r.w * state.view.s, r.h * state.view.s);
      ctx.setLineDash([]);
      if (r.w >= 100 || r.h >= 100) {
        const objs = objectsForRect(op.tool, r);
        ghost(objs);
        const [sx, sy] = toScreen(op.b[0], op.b[1]);
        let txt = `${fmt(r.w)} × ${fmt(r.h)}`;
        if (op.tool === 'rack' && objs[0]) txt += `  ·  ${objs[0].bays} bays  ·  ${W.rackPositions(objs[0])} positions`;
        if (op.tool === 'layout') txt += `  ·  ${objs.length} racks  ·  ${objs.reduce((s, o) => s + W.rackPositions(o), 0).toLocaleString('en-US')} positions`;
        label(txt, sx, sy);
      }
    } else if (op && (op.kind === 'chain' || op.kind === 'two') && c) {
      if (op.kind === 'chain') {
        ghost([W.makeObject('wall', { x1: op.a[0], y1: op.a[1], x2: c[0], y2: c[1], thick: state.defaults.wall.thick })]);
      } else if (op.tool === 'arrow' || op.tool === 'dim') {
        ghost([W.makeObject(op.tool, { x1: op.a[0], y1: op.a[1], x2: c[0], y2: c[1], th: state.defaults.dim.th, off: state.defaults.dim.off })]);
      } else {
        line(op.a, c, GHOST, true);
      }
      const [sx, sy] = toScreen(c[0], c[1]);
      const ang = ((Math.atan2(-(c[1] - op.a[1]), c[0] - op.a[0]) * 180) / Math.PI + 360) % 360;
      label(`${fmt(Math.hypot(c[0] - op.a[0], c[1] - op.a[1]))}  ∠ ${ang.toFixed(1)}°`, sx, sy);
    } else if (!op && c) {
      if (state.tool === 'column') ghost([W.makeObject('column', { ...state.defaults.column, x: c[0], y: c[1] })]);
      else if (['door', 'overhead', 'dock'].includes(state.tool) && state.raw) ghost([doorAt(state.raw, state.tool)]);
      else if (state.tool === 'text') ghost([W.makeObject('text', { ...state.defaults.text, x: c[0], y: c[1] })]);
    }
    if (state.measure) {
      const m = state.measure;
      line(m.a, m.b, GHOST, false);
      const [sx, sy] = toScreen(m.b[0], m.b[1]);
      label(fmt(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])), sx, sy);
    }

    // cursor & snap marker
    if (c && state.tool !== 'select' && state.tool !== 'pan') {
      const [x, y] = toScreen(c[0], c[1]);
      ctx.strokeStyle = 'rgba(230,233,238,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 0.5); ctx.lineTo(x + 8, y + 0.5);
      ctx.moveTo(x + 0.5, y - 8); ctx.lineTo(x + 0.5, y + 8);
      ctx.stroke();
    }
    if (state.snapMark && state.tool !== 'select') {
      const [x, y] = toScreen(state.snapMark[0], state.snapMark[1]);
      ctx.strokeStyle = GHOST;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    }
  }

  // ---- panels -------------------------------------------------------------------------
  const lenUnit = () => W.unitLabel(units());
  function fieldControl(f, value, onChange) {
    const u = units();
    let input;
    if (f.t === 'enum') {
      input = h('select', null, Object.entries(f.opts).map(([k, v]) => h('option', { value: k }, v.label)));
      input.value = value;
    } else if (f.t === 'str') {
      input = h('input', { type: 'text', maxlength: String(f.max || 200) });
      input.value = value;
    } else if (f.t === 'bool') {
      input = h('input', { type: 'checkbox' });
      input.checked = !!value;
    } else {
      input = h('input', { type: 'number', step: 'any' });
      input.value = f.t === 'coord' || f.t === 'len' ? String(Math.round(W.toDisplay(value, u) * 1000) / 1000) : String(value);
    }
    input.addEventListener('change', () => {
      let v;
      if (f.t === 'bool') v = input.checked;
      else if (f.t === 'enum' || f.t === 'str') v = input.value;
      else {
        v = Number(input.value);
        if (!Number.isFinite(v) || input.value === '') return;
        if (f.t === 'coord' || f.t === 'len') v = W.fromDisplay(v, u);
      }
      onChange(v);
    });
    const suffix = f.t === 'coord' || f.t === 'len' ? ` (${lenUnit()})` : f.t === 'angle' ? ' (°)' : '';
    if (f.t === 'bool') return h('label', { class: 'field' }, h('span', { title: f.l }, f.l), input);
    return h('label', { class: 'field' }, h('span', { title: f.l + suffix }, f.l + suffix), input);
  }
  const kv = (k, v, big) => h('div', { class: big ? 'kv big' : 'kv' }, h('span', null, k), h('span', null, v));

  function renderPanel() {
    const root = $('#props');
    const title = $('#propsTitle');
    const u = units();
    const sel = selected();
    root.replaceChildren();

    if (sel.length === 1) {
      const o = sel[0];
      title.textContent = W.TYPE_LABEL[o.type];
      const locked = !editable(o);
      for (const f of W.SCHEMA[o.type]) {
        const ctl = fieldControl(f, o[f.k], (v) => {
          checkpoint();
          o[f.k] = W.sanitizeValue(f, v);
          if (o.type === 'door' && f.k === 'kind') o.w = W.DOOR_KINDS[o.kind].w;
          changed();
        });
        if (locked) ctl.querySelector('input,select').disabled = true;
        root.append(ctl);
      }
      if (o.type === 'wall') {
        const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
        root.append(fieldControl({ k: 'len', l: 'Length', t: 'len', min: 1, max: W.MAX_COORD }, len, (v) => {
          if (!(v > 0)) return;
          checkpoint();
          const ux = len ? (o.x2 - o.x1) / len : 1, uy = len ? (o.y2 - o.y1) / len : 0;
          o.x2 = o.x1 + ux * v; o.y2 = o.y1 + uy * v;
          changed();
        }));
      }
      const info = h('div', { class: 'sub' });
      if (o.type === 'rack') {
        const { L, D } = W.rackDims(o);
        info.append(kv('Run length', fmt(L)), kv('Overall depth', fmt(D)), kv('Footprint', W.fmtArea(L * D, u)),
          kv(o.kind === 'shelving' ? 'Shelf locations' : 'Pallet positions', W.rackPositions(o).toLocaleString('en-US'), true));
      } else if (o.type === 'zone') {
        info.append(kv('Area', W.fmtArea(o.w * o.h, u), true));
      } else if (o.type === 'dim' || o.type === 'arrow') {
        info.append(kv('Length', fmt(Math.hypot(o.x2 - o.x1, o.y2 - o.y1))));
      }
      if (info.childNodes.length) root.append(info);
      if (!locked) root.append(selectionActions());
      else root.append(h('p', { class: 'muted' }, 'This layer is locked.'));
    } else if (sel.length > 1) {
      title.textContent = 'Selection';
      const counts = {};
      for (const o of sel) counts[o.type] = (counts[o.type] || 0) + 1;
      root.append(kv('Objects', String(sel.length), true));
      for (const [t, n] of Object.entries(counts)) root.append(kv(W.TYPE_LABEL[t], String(n)));
      const racks = sel.filter((o) => o.type === 'rack');
      if (racks.length) root.append(kv('Pallet positions', racks.reduce((s, r) => s + W.rackPositions(r), 0).toLocaleString('en-US')));
      root.append(selectionActions());
    } else {
      const t = TOOL_BY_ID[state.tool];
      title.textContent = t.label + ' tool';
      root.append(h('p', { class: 'muted' }, t.hint));
      const d = state.defaults[state.tool];
      if (d) {
        const fields = W.SCHEMA[d.type].filter((f) => f.tool);
        if (fields.length) root.append(h('div', { class: 'sub' }, h('p', { class: 'muted' }, 'Defaults for new objects')));
        for (const f of fields) root.append(fieldControl(f, d[f.k], (v) => { d[f.k] = W.sanitizeValue(f, v); renderPanel(); requestDraw(); }));
      }
      if (state.tool === 'layout') {
        root.append(h('p', { class: 'muted' }, 'Rack settings are set in the dialog that opens after you drag.'));
      }
    }
  }
  function selectionActions() {
    return h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: rotateSelection, title: 'Rotate 90° (R)' }, 'Rotate 90°'),
      h('button', { type: 'button', onclick: duplicateSelection, title: 'Duplicate (Ctrl+D)' }, 'Duplicate'),
      h('button', { type: 'button', class: 'danger', onclick: deleteSelection, title: 'Delete (Del)' }, 'Delete'));
  }

  function renderLayers() {
    const root = $('#layers');
    const counts = {};
    for (const o of state.project.objects) { const l = W.TYPE_LAYER[o.type]; counts[l] = (counts[l] || 0) + 1; }
    const pal = W.PALETTES.screen;
    const swatch = { zones: '#22c55e', flow: pal.flow, racking: pal.rack, walls: pal.wall, columns: pal.column, doors: pal.door, dims: pal.dim, text: pal.text };
    root.replaceChildren(...W.LAYERS.map((l) => {
      const st = state.layers[l.id];
      const vis = h('input', { type: 'checkbox', title: 'Visible', 'aria-label': `Show ${l.name}` });
      vis.checked = st.visible;
      vis.addEventListener('change', () => {
        st.visible = vis.checked;
        if (!st.visible) for (const o of selected()) if (W.TYPE_LAYER[o.type] === l.id) state.sel.delete(o.id);
        renderPanel(); requestDraw();
      });
      const lock = h('button', { type: 'button', class: st.locked ? 'lock on' : 'lock', title: st.locked ? 'Unlock layer' : 'Lock layer',
        'aria-label': `Lock ${l.name}`, 'aria-pressed': String(st.locked) }, icon(st.locked ? LOCK_CLOSED : LOCK_OPEN));
      lock.addEventListener('click', () => { st.locked = !st.locked; renderLayers(); renderPanel(); });
      const sw = h('span', { class: 'sw' });
      sw.style.background = swatch[l.id];
      return h('div', { class: 'layer' }, vis, lock, sw, h('span', null, l.name), h('span', { class: 'count' }, String(counts[l.id] || 0)));
    }));
  }

  function renderStats() {
    const st = W.computeStats(state.project);
    const u = units();
    const root = $('#stats');
    const rows = [
      kv('Pallet positions', st.pallets.toLocaleString('en-US'), true),
    ];
    if (st.shelfLocs) rows.push(kv('Shelf locations', st.shelfLocs.toLocaleString('en-US')));
    rows.push(
      kv('Building footprint', st.footprint ? W.fmtArea(st.footprint, u) : '—'),
      kv('Rack footprint', W.fmtArea(st.rackArea, u)),
      kv('Rack coverage', st.footprint ? (st.utilization * 100).toFixed(1) + ' %' : '—'),
      kv('Rack runs', String(st.racks)),
      kv('Dock / overhead / personnel doors', `${st.doors.dock} / ${st.doors.overhead} / ${st.doors.door}`),
      kv('Columns', String(st.columns)),
      kv('Wall length', fmt(st.wallLen)),
    );
    const zoneKeys = Object.keys(W.ZONE_KINDS).filter((k) => st.zones[k]);
    if (zoneKeys.length) {
      const z = h('div', { class: 'sub' });
      for (const k of zoneKeys) {
        const dot = h('span', { class: 'zone-dot' });
        dot.style.background = W.ZONE_KINDS[k].color;
        const pct = st.footprint ? ` · ${((st.zones[k].area / st.footprint) * 100).toFixed(0)}%` : '';
        z.append(h('div', { class: 'kv' }, h('span', null, dot, `${W.ZONE_KINDS[k].label} (${st.zones[k].count})`),
          h('span', null, W.fmtArea(st.zones[k].area, u) + pct)));
      }
      rows.push(z);
    }
    root.replaceChildren(...rows);
  }

  function updateStatus() {
    const c = state.cursor;
    const u = units();
    if (c) {
      const f = (v) => (u === 'imperial' ? W.fmtLen(v, u) : (v / 1000).toFixed(2) + ' m');
      $('#stCoords').textContent = `X ${f(c[0])}   Y ${f(c[1])}`;
    }
    const pxPerM = state.view.s * (u === 'imperial' ? W.MM_PER_FT : 1000);
    $('#stZoom').textContent = `${pxPerM >= 10 ? pxPerM.toFixed(0) : pxPerM.toFixed(2)} px/${lenUnit()}`;
  }

  // ---- toolbar & top bar -----------------------------------------------------------
  const LOCK_CLOSED = 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z';
  const LOCK_OPEN = 'M7 11V8a5 5 0 0 1 9.6-1.9M5 11h14v10H5z';
  function icon(d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  }

  function buildToolbar() {
    const root = $('#tools');
    for (const t of TOOLS) {
      if (t.sep) { root.append(h('div', { class: 'sep' }, t.sep)); continue; }
      const svg = icon(ICONS[t.id]);
      const b = h('button', { type: 'button', class: 'tool', 'data-tool': t.id, title: `${t.label} (${t.key.toUpperCase()})` },
        svg, h('span', null, t.label), h('span', { class: 'key' }, t.key.toUpperCase()));
      b.addEventListener('click', () => setTool(t.id));
      root.append(b);
    }
  }
  function setTool(id) {
    if (!TOOL_BY_ID[id]) return;
    state.tool = id;
    state.op = null;
    state.doorFlip = false;
    if (id !== 'select') state.sel.clear();
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === id);
    cv.className = 'tool-' + id;
    $('#stHint').textContent = TOOL_BY_ID[id].hint;
    renderPanel();
    requestDraw();
  }
  function fillSnapSelect() {
    const sel = $('#selSnap');
    sel.replaceChildren(...SNAPS[units()].map(([v, l]) => h('option', { value: String(v) }, l)));
    if (!SNAPS[units()].some(([v]) => v === state.snap)) state.snap = units() === 'imperial' ? 304.8 : 500;
    sel.value = String(state.snap);
  }
  function toggleGrid() { state.gridOn = !state.gridOn; $('#btnGrid').classList.toggle('on', state.gridOn); requestDraw(); }
  function toggleOrtho() { state.ortho = !state.ortho; $('#btnOrtho').classList.toggle('on', state.ortho); requestDraw(); }
  function syncTopbar() {
    $('#projName').value = state.project.name;
    $('#selUnits').value = state.project.units;
    fillSnapSelect();
  }

  // ---- files & export -----------------------------------------------------------------
  let toastTimer = 0;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
  }
  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const baseName = () => W.slug(state.project.name);
  function saveProject() {
    download(`${baseName()}.wcad.json`, W.serialize(state.project), 'application/json');
    toast('Project saved');
  }
  async function openFile(file) {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 20 MB.');
      const text = await file.text();
      let raw;
      try { raw = JSON.parse(text); } catch (_) { throw new Error('File is not valid JSON.'); }
      const p = W.sanitizeProject(raw);
      checkpoint();
      state.project = p;
      state.sel.clear();
      syncTopbar();
      changed();
      fitView();
      toast(`Opened ${p.objects.length} objects`);
    } catch (err) {
      toast(err.message || 'Could not open file.', true);
    }
  }
  async function doExport(kind) {
    try {
      const hidden = hiddenLayers();
      if (kind === 'dxf') {
        const p = { ...state.project, objects: state.project.objects.filter((o) => !hidden.has(W.TYPE_LAYER[o.type])) };
        download(`${baseName()}.dxf`, W.toDXF(p), 'application/dxf');
        toast(`DXF exported (${units() === 'imperial' ? 'inches' : 'millimetres'})`);
      } else if (kind === 'svg') {
        download(`${baseName()}.svg`, W.toSVG(state.project, { hidden }), 'image/svg+xml');
      } else if (kind === 'png') {
        download(`${baseName()}.png`, await W.toPNG(state.project, { hidden }), 'image/png');
      } else if (kind === 'pdf') {
        openPdfDialog();
      }
    } catch (err) {
      toast('Export failed: ' + (err.message || err), true);
    }
  }

  function openPdfDialog() {
    const dlg = $('#dlgPdf');
    const f = dlg.querySelector('form');
    if (!f.sheet.options.length) {
      f.sheet.append(...Object.keys(W.SHEETS).map((k) => h('option', { value: k }, k)));
      f.scale.append(h('option', { value: 'fit' }, 'Fit to sheet'), ...W.SCALES.map((s) => h('option', { value: String(s) }, `1:${s}`)));
      f.sheet.value = units() === 'imperial' ? 'Tabloid' : 'A3';
      f.date.value = new Date().toISOString().slice(0, 10);
    }
    f.title.value = state.project.name;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'ok') return;
      try {
        const res = W.toPDF(state.project, {
          sheet: f.sheet.value, scale: f.scale.value, title: f.title.value, subtitle: f.subtitle.value,
          drawnBy: f.drawnBy.value, revision: f.revision.value, date: f.date.value, hidden: hiddenLayers(),
        });
        download(`${baseName()}.pdf`, new Blob([res.bytes], { type: 'application/pdf' }));
        toast(`PDF exported at 1:${res.scale}`);
      } catch (err) {
        toast('PDF export failed: ' + (err.message || err), true);
      }
    });
  }

  function openNewDialog() {
    const dlg = $('#dlgNew');
    const f = dlg.querySelector('form');
    const setUnits = () => { for (const s of dlg.querySelectorAll('.u')) s.textContent = `(${f.units.value === 'imperial' ? 'ft' : 'm'})`; };
    f.units.value = units();
    f.width.value = units() === 'imperial' ? 240 : 72;
    f.length.value = units() === 'imperial' ? 160 : 48;
    f.thick.value = units() === 'imperial' ? 0.67 : 0.2;
    setUnits();
    f.units.onchange = setUnits;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'ok') return;
      const u = f.units.value === 'imperial' ? 'imperial' : 'metric';
      const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
      const p = W.newProject(f.name.value, u);
      if (f.shell.checked) {
        const wd = W.clamp(W.fromDisplay(num(f.width.value, 72), u), 1000, 2e6);
        const ln = W.clamp(W.fromDisplay(num(f.length.value, 48), u), 1000, 2e6);
        const t = W.clamp(W.fromDisplay(num(f.thick.value, 0.2), u), 50, 3000);
        const docks = W.clamp(Math.round(Number(f.docks.value) || 0), 0, 60);
        p.objects.push(...buildShell(wd, ln, t, docks));
      }
      checkpoint();
      state.project = p;
      state.sel.clear();
      syncTopbar();
      changed();
      fitView();
    });
  }
  function buildShell(wd, ln, t, docks) {
    const walls = [[0, 0, wd, 0], [wd, 0, wd, ln], [wd, ln, 0, ln], [0, ln, 0, 0]]
      .map(([a, b, c, d]) => W.makeObject('wall', { x1: a, y1: b, x2: c, y2: d, thick: t }));
    const out = walls.slice();
    const dw = 2700;
    const n = Math.min(docks, Math.floor(wd / (dw + 1000)));
    if (n > 0) {
      const pitch = Math.min(4000, wd / n);
      const start = wd / 2 - (pitch * (n - 1)) / 2;
      for (let i = 0; i < n; i++) {
        out.push(W.makeObject('door', { kind: 'dock', x: start + i * pitch, y: ln, rot: 180, w: dw, wallT: t + 20, label: 'D' + (i + 1) }));
      }
    }
    return out;
  }

  function openLayoutDialog(area) {
    const dlg = $('#dlgLayout');
    const root = $('#layoutFields');
    const opt = state.layoutOpt;
    const summary = $('#layoutSummary');
    const refresh = () => {
      const res = W.autoLayout(area, opt);
      summary.textContent = res.tooLarge
        ? 'Too many bays for this area. Increase the bay width or draw a smaller area.'
        : `${fmt(area.w)} × ${fmt(area.h)} area  →  ${res.rows} rows, ${res.racks.length} rack runs, ` +
          `${res.positions.toLocaleString('en-US')} ${opt.kind === 'shelving' ? 'shelf locations' : 'pallet positions'}`;
    };
    root.replaceChildren(...LAYOUT_FIELDS.map((f) => fieldControl(f, opt[f.k], (v) => {
      opt[f.k] = f.t === 'bool' ? !!v : W.sanitizeValue(f, v);
      refresh();
    })));
    refresh();
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'ok') { requestDraw(); return; }
      const res = W.autoLayout(area, opt);
      if (!res.racks.length) {
        toast(res.tooLarge ? 'Too many bays for this area.' : 'Area is too small for one rack row with these settings.', true);
        return;
      }
      checkpoint();
      if (opt.replace) {
        const inside = (o) => {
          if (o.type !== 'rack') return false;
          const b = W.objBBox(o);
          return b[0] >= area.x - 1 && b[1] >= area.y - 1 && b[2] <= area.x + area.w + 1 && b[3] <= area.y + area.h + 1;
        };
        state.project.objects = state.project.objects.filter((o) => !inside(o));
      }
      state.project.objects.push(...res.racks);
      state.sel = new Set(res.racks.map((r) => r.id));
      changed();
      toast(`Placed ${res.racks.length} rack runs · ${res.positions.toLocaleString('en-US')} positions`);
    });
  }

  function demoProject() {
    const p = W.newProject('Demo distribution centre', 'metric');
    const wd = 84000, ln = 54000;
    p.objects.push(...buildShell(wd, ln, 250, 8));
    const z = (kind, name, x, y, w, hh) => W.makeObject('zone', { kind, name, x: x + w / 2, y: y + hh / 2, w, h: hh });
    p.objects.push(
      z('receiving', 'Receiving', 4000, 40000, 30000, 12000),
      z('shipping', 'Shipping', 50000, 40000, 30000, 12000),
      z('staging', 'Staging', 34000, 40000, 16000, 12000),
      z('storage', 'Pallet storage', 2000, 2000, 60000, 34000),
      z('picking', 'Pick & pack', 64000, 2000, 18000, 22000),
      z('office', 'Office', 64000, 26000, 18000, 10000),
    );
    const lay = W.autoLayout({ x: 2000, y: 2000, w: 60000, h: 34000 }, { ...state.layoutOpt, prefix: 'A' });
    p.objects.push(...lay.racks);
    const shelf = W.autoLayout({ x: 65000, y: 3000, w: 16000, h: 20000 },
      { ...state.layoutOpt, kind: 'shelving', depth: 600, aisle: 1500, bayW: 1200, levels: 6, crossEvery: 0, prefix: 'S' });
    p.objects.push(...shelf.racks);
    p.objects.push(W.makeObject('door', { kind: 'door', x: 73000, y: 36000, rot: 0, w: 1000, wallT: 0 }));
    for (let x = 12000; x < wd; x += 24000) for (let y = 18000; y < ln; y += 18000) {
      p.objects.push(W.makeObject('column', { x, y, size: 400 }));
    }
    p.objects.push(
      W.makeObject('arrow', { x1: 18000, y1: 44000, x2: 18000, y2: 37000 }),
      W.makeObject('arrow', { x1: 50000, y1: 37000, x2: 60000, y2: 44000 }),
      W.makeObject('dim', { x1: 0, y1: 0, x2: wd, y2: 0, off: 2000, th: 600 }),
      W.makeObject('dim', { x1: 0, y1: ln, x2: 0, y2: 0, off: 2000, th: 600 }),
    );
    return p;
  }

  // ---- wiring ----------------------------------------------------------------------
  function wire() {
    $('#btnNew').addEventListener('click', openNewDialog);
    $('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
    $('#btnSave').addEventListener('click', saveProject);
    $('#fileOpen').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) openFile(f);
    });
    const menu = $('#exportMenu');
    const btnExport = $('#btnExport');
    const closeMenu = () => { menu.hidden = true; btnExport.setAttribute('aria-expanded', 'false'); };
    btnExport.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btnExport.setAttribute('aria-expanded', String(!menu.hidden));
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-export]');
      if (!b) return;
      closeMenu();
      doExport(b.dataset.export);
    });
    document.addEventListener('click', closeMenu);
    $('#btnUndo').addEventListener('click', doUndo);
    $('#btnRedo').addEventListener('click', doRedo);
    $('#btnGrid').addEventListener('click', toggleGrid);
    $('#btnOrtho').addEventListener('click', toggleOrtho);
    $('#btnFit').addEventListener('click', fitView);
    $('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
    $('#selSnap').addEventListener('change', (e) => { state.snap = Number(e.target.value) || 0; requestDraw(); });
    $('#selUnits').addEventListener('change', (e) => {
      checkpoint();
      state.project.units = e.target.value === 'imperial' ? 'imperial' : 'metric';
      fillSnapSelect();
      changed();
      updateStatus();
    });
    $('#projName').addEventListener('change', (e) => {
      const v = W.sanitizeValue({ t: 'str', d: 'Untitled warehouse', max: 80 }, e.target.value).trim();
      checkpoint();
      state.project.name = v || 'Untitled warehouse';
      e.target.value = state.project.name;
      changed();
    });
    // Drag & drop project files onto the canvas.
    const wrap = $('#canvasWrap');
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openFile(f);
    });
    new ResizeObserver(resize).observe(wrap);
  }

  function init() {
    buildToolbar();
    wire();
    let loaded = null;
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (s) loaded = W.sanitizeProject(JSON.parse(s));
    } catch (_) { loaded = null; }
    state.project = loaded || demoProject();
    syncTopbar();
    setTool('select');
    resize();
    changed();
    fitView();
    updateStatus();
  }
  init();
})();

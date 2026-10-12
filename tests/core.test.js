'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/core.js');
const W = globalThis.WCAD;

test('makeObject applies defaults and clamps values', () => {
  const r = W.makeObject('rack', { bays: -5, levels: 999, bayW: 'abc', kind: 'nope' });
  assert.equal(r.bays, 1);
  assert.equal(r.levels, 40);
  assert.equal(r.bayW, 2700);
  assert.equal(r.kind, 'selective');
  assert.match(r.id, /^[a-z0-9]+$/);
});

test('rack positions by kind', () => {
  const sel = W.makeObject('rack', { kind: 'selective', bays: 10, perBay: 2, levels: 5, rows: 2 });
  assert.equal(W.rackPositions(sel), 200);
  const di = W.makeObject('rack', { kind: 'drivein', bays: 4, levels: 4, depth: 6000, palletD: 1200 });
  assert.equal(W.rackPositions(di), 4 * 4 * 5);
  const sh = W.makeObject('rack', { kind: 'shelving', bays: 6, levels: 5, rows: 1 });
  assert.equal(W.rackPositions(sh), 30);
});

test('rack dims include flue for back-to-back', () => {
  const r = W.makeObject('rack', { bays: 3, bayW: 2700, depth: 1100, rows: 2, flue: 300 });
  assert.deepEqual(W.rackDims(r), { L: 8100, D: 2500 });
});

test('sanitizeProject rejects non-projects and filters junk', () => {
  assert.throws(() => W.sanitizeProject(null));
  assert.throws(() => W.sanitizeProject({ objects: 'x' }));
  const p = W.sanitizeProject({
    name: 'A\u0000B<script>',
    units: 'imperial',
    objects: [
      { type: 'wall', x1: 0, y1: 0, x2: 1e99, y2: NaN, thick: 100, evil: 'x' },
      { type: '__proto__' },
      { type: 'toString' },
      { type: 'text', text: 'x'.repeat(5000) },
      { type: 'zone', id: 'dup' }, { type: 'zone', id: 'dup' },
      'string', 42, null,
    ],
  });
  assert.equal(p.name, 'AB<script>'); // control chars removed; text is only ever rendered as text
  assert.equal(p.units, 'imperial');
  assert.equal(p.objects.length, 4);
  const wall = p.objects[0];
  assert.equal(wall.x2, W.MAX_COORD);
  assert.equal(wall.y2, 0);
  assert.equal('evil' in wall, false);
  assert.equal(p.objects[1].text.length, 200);
  assert.notEqual(p.objects[2].id, p.objects[3].id);
});

test('sanitizeProject ignores prototype pollution keys', () => {
  const raw = JSON.parse('{"objects":[{"type":"column","__proto__":{"polluted":1},"x":5}]}');
  const p = W.sanitizeProject(raw);
  assert.equal(p.objects[0].x, 5);
  assert.equal({}.polluted, undefined);
  assert.equal(p.objects[0].polluted, undefined);
});

test('serialize round-trips', () => {
  const p = W.newProject('T', 'metric');
  p.objects.push(W.makeObject('wall', { x2: 5000 }), W.makeObject('rack', { x: 100 }));
  const back = W.sanitizeProject(JSON.parse(W.serialize(p)));
  assert.deepEqual(back, p);
});

test('unit formatting', () => {
  assert.equal(W.fmtLen(12500, 'metric'), '12.50 m');
  assert.equal(W.fmtLen(3048, 'imperial'), "10'-0\"");
  assert.equal(W.fmtLen(3073.4, 'imperial'), "10'-1\"");
  assert.equal(W.fmtArea(1e6 * 1234, 'metric'), '1,234 m²');
  assert.ok(Math.abs(W.fromDisplay(W.toDisplay(1234, 'imperial'), 'imperial') - 1234) < 1e-9);
});

test('hit testing', () => {
  const w = W.makeObject('wall', { x1: 0, y1: 0, x2: 10000, y2: 0, thick: 200 });
  assert.ok(W.hitTest(w, 5000, 90, 0));
  assert.ok(!W.hitTest(w, 5000, 300, 0));
  const r = W.makeObject('rack', { x: 0, y: 0, rot: 90, bays: 2, bayW: 2000, rows: 1, depth: 1000 });
  assert.ok(W.hitTest(r, 0, 1900, 0)); // rotated: length runs along Y
  assert.ok(!W.hitTest(r, 1900, 0, 0));
});

test('rotate90 swaps zone size and rotates segments', () => {
  const z = W.makeObject('zone', { w: 100, h: 300 });
  W.rotate90(z);
  assert.deepEqual([z.w, z.h], [300, 100]);
  const w = W.makeObject('wall', { x1: -1000, y1: 0, x2: 1000, y2: 0 });
  W.rotate90(w);
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2].map(Math.round), [0, -1000, 0, 1000]);
});

test('primitives are produced for every type', () => {
  for (const type of Object.keys(W.SCHEMA)) {
    const prims = W.objPrims(W.makeObject(type, { x2: 3000, y2: 0 }), 'metric');
    assert.ok(prims.length > 0, type);
    for (const p of prims) assert.ok(W.LAYERS.some((l) => l.id === p.layer));
  }
});

const LAYOUT = {
  dir: 'h', kind: 'selective', depth: 1100, flue: 300, aisle: 3000, bayW: 2700, levels: 5, perBay: 2,
  palletD: 1200, b2b: true, edgeSingle: true, crossEvery: 0, crossW: 3000, prefix: 'A',
};

test('autoLayout: single + doubles + single fits and stays inside', () => {
  const area = { x: 0, y: 0, w: 27000, h: 1100 + 3000 + 2500 + 3000 + 1100 };
  const res = W.autoLayout(area, LAYOUT);
  assert.equal(res.rows, 3);
  assert.equal(res.racks.length, 3);
  assert.deepEqual(res.racks.map((r) => r.rows), [1, 2, 1]);
  for (const r of res.racks) {
    const b = W.objBBox(r);
    assert.ok(b[0] >= -1e-6 && b[1] >= -1e-6 && b[2] <= area.w + 1e-6 && b[3] <= area.h + 1e-6);
    assert.equal(r.bays, 10);
  }
  assert.equal(res.positions, 10 * 2 * 5 * (1 + 2 + 1));
});

test('autoLayout: aisles between rows are at least the aisle width', () => {
  const res = W.autoLayout({ x: 0, y: 0, w: 40000, h: 30000 }, LAYOUT);
  const boxes = res.racks.map(W.objBBox).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][1] - boxes[i - 1][3] >= 3000 - 1e-6);
});

test('autoLayout: vertical direction, cross aisles and drive-in', () => {
  const v = W.autoLayout({ x: 0, y: 0, w: 20000, h: 60000 }, { ...LAYOUT, dir: 'v', crossEvery: 8 });
  assert.ok(v.racks.every((r) => r.rot === 90 && r.bays <= 8));
  assert.ok(v.runs >= 2);
  const d = W.autoLayout({ x: 0, y: 0, w: 15000, h: 20000 }, { ...LAYOUT, kind: 'drivein', depth: 6000, bayW: 1500 });
  assert.ok(d.racks.length > 0 && d.racks.every((r) => r.rows === 1));
});

test('autoLayout: area too small yields nothing', () => {
  const res = W.autoLayout({ x: 0, y: 0, w: 2000, h: 500 }, LAYOUT);
  assert.equal(res.racks.length, 0);
});

test('computeStats', () => {
  const p = W.newProject('S', 'metric');
  p.objects.push(
    W.makeObject('wall', { x1: 0, y1: 0, x2: 10000, y2: 0, thick: 200 }),
    W.makeObject('wall', { x1: 10000, y1: 0, x2: 10000, y2: 10000, thick: 200 }),
    W.makeObject('zone', { kind: 'receiving', w: 2000, h: 3000 }),
    W.makeObject('rack', { bays: 1, perBay: 2, levels: 1, rows: 1 }),
    W.makeObject('door', { kind: 'dock' }),
  );
  const st = W.computeStats(p);
  assert.equal(st.pallets, 2);
  assert.equal(st.doors.dock, 1);
  assert.equal(st.zones.receiving.area, 6e6);
  assert.equal(Math.round(st.footprint), 10200 * 10200);
});

test('resource limits: oversized projects and layouts are refused', () => {
  const objects = Array.from({ length: 60 }, () => ({ type: 'rack', bays: 2000, rows: 2 }));
  assert.throws(() => W.sanitizeProject({ objects }), /too large/);
  const res = W.autoLayout({ x: 0, y: 0, w: 2e6, h: 2e6 }, { ...LAYOUT, bayW: 300, depth: 200, aisle: 500, flue: 0 });
  assert.equal(res.tooLarge, true);
  assert.equal(res.racks.length, 0);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/core.js');
require('../js/export.js');
const W = globalThis.WCAD;

function sample(units = 'metric') {
  const p = W.newProject('Test <DC> & "Co"', units);
  p.objects.push(
    W.makeObject('wall', { x1: 0, y1: 0, x2: 20000, y2: 0 }),
    W.makeObject('wall', { x1: 20000, y1: 0, x2: 20000, y2: 15000 }),
    W.makeObject('door', { kind: 'dock', x: 5000, y: 0, label: 'D1' }),
    W.makeObject('door', { kind: 'door', x: 15000, y: 0 }),
    W.makeObject('door', { kind: 'overhead', x: 10000, y: 0 }),
    W.makeObject('rack', { x: 10000, y: 6000, bays: 5 }),
    W.makeObject('zone', { kind: 'shipping', x: 10000, y: 12000, name: 'Ship → é' }),
    W.makeObject('dim', { x1: 0, y1: 0, x2: 20000, y2: 0 }),
    W.makeObject('arrow', { x1: 0, y1: 5000, x2: 5000, y2: 5000 }),
    W.makeObject('column', { x: 3000, y: 3000 }),
    W.makeObject('text', { x: 1000, y: 1000, text: 'Hello (world) \\ 日本' }),
  );
  return p;
}

test('DXF is well-formed group-code pairs with balanced sections', () => {
  const dxf = W.toDXF(sample());
  const lines = dxf.split('\r\n');
  assert.equal(lines.pop(), '');
  assert.equal(lines.length % 2, 0);
  for (let i = 0; i < lines.length; i += 2) assert.match(lines[i], /^-?\d+$/, `code at ${i}`);
  const zeros = [];
  for (let i = 0; i < lines.length; i += 2) if (lines[i] === '0') zeros.push(lines[i + 1]);
  assert.equal(zeros.filter((s) => s === 'SECTION').length, zeros.filter((s) => s === 'ENDSEC').length);
  assert.equal(zeros[zeros.length - 1], 'EOF');
  assert.ok(zeros.includes('POLYLINE') && zeros.includes('TEXT') && zeros.includes('LINE') && zeros.includes('SOLID'));
  assert.equal(zeros.filter((s) => s === 'POLYLINE').length, zeros.filter((s) => s === 'SEQEND').length);
  assert.ok(dxf.includes('\\U+65E5'), 'non-ASCII encoded as \\U+');
  assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(dxf), 'pure ASCII');
});

test('DXF imperial uses inches', () => {
  const dxf = W.toDXF(sample('imperial'));
  assert.match(dxf, /\$INSUNITS\r\n70\r\n1\r\n/);
});

test('SVG escapes text and is parseable XML-ish', () => {
  const svg = W.toSVG(sample());
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('Test &lt;DC&gt; &amp; &quot;Co&quot;'));
  assert.ok(!svg.includes('<DC>'));
  assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
});

test('PDF has a valid structure and xref offsets', () => {
  const { bytes, scale } = W.toPDF(sample(), { sheet: 'A3', title: 'T (1)', drawnBy: 'X' });
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.ok(W.SCALES.includes(scale));
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(startxref).startsWith('xref'));
  const offs = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  const len = Number(/\/Length (\d+) >>\nstream\n/.exec(s)[1]);
  const start = s.indexOf('stream\n') + 7;
  assert.equal(s.slice(start + len, start + len + 10), '\nendstream');
  assert.ok(s.includes('(T \\(1\\))'), 'parentheses escaped');
});

test('pickScale picks the largest scale that fits', () => {
  assert.equal(W.pickScale([0, 0, 40000, 20000], 400, 250), 100);
  assert.equal(W.pickScale([0, 0, 40001, 20000], 400, 250), 125);
});

test('slug', () => {
  assert.equal(W.slug('  My DC #1 / Phase 2 '), 'my-dc-1-phase-2');
  assert.equal(W.slug('../../etc'), 'etc');
  assert.equal(W.slug(''), 'warehouse');
});

test('PDF ignores an invalid scale and falls back to fit', () => {
  const { scale } = W.toPDF(sample(), { scale: 'NaN; /JS' });
  assert.ok(W.SCALES.includes(scale));
});

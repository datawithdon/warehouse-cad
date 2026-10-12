# Warehouse CAD

A browser-based 2D CAD tool for designing warehouse layouts: the building shell, doors and docks, racking, operational zones and material flow. You can export the drawing as AutoCAD-compatible DXF, a scaled PDF print layout, SVG, or PNG.

It runs entirely in the browser. There is no build step, no server, no dependencies, and no network requests.

## Quick start

Open `index.html` in a modern browser (Chrome, Edge, Firefox, or Safari). That's all you need.

You can also serve the folder statically, for example:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It also works as-is on GitHub Pages.

The first launch opens a demo distribution centre. To start a blank building with a shell and dock doors, click **New**.

## Features

**Building**
- Walls drawn as connected chains, with ortho mode, endpoint snapping, and editable length and thickness
- Rooms: drag a rectangle to get four walls
- Columns
- Personnel doors (with swing), overhead doors, and dock doors (leveler and bumpers). Doors snap onto the nearest wall and take its angle and thickness.

**Storage**
- Selective pallet racking, drive-in racking, and shelving
- Bays, bay width, depth, single or back-to-back rows, flue gap, levels, and pallets per bay
- Live counts of pallet positions and shelf locations for each rack and for the whole site
- **Auto-layout**: drag over an area and it fills with rack rows and aisles. You can set row direction, aisle width, back-to-back pairs, single rows along the edges, and cross aisles every N bays. The dialog previews the result before placing it.

**Zones & flow**
- Receiving, storage, picking, packing, staging, shipping, office, and other zones, each colour-coded and showing its area
- Flow arrows for material movement
- Summary panel with building footprint, rack coverage, door counts, and each zone's area as a share of the footprint

**CAD tools**
- Grid with configurable snap (metric or imperial), object snap to endpoints and corners, and ortho mode (F8 or Shift)
- Dimensions, a measure tool, and text labels
- 8 layers, each of which can be hidden or locked
- Undo/redo (200 steps), duplicate, rotate, nudge with the arrow keys, and box select
- Metric (m) or imperial (ft-in) units, switchable at any time
- Drag-to-resize handles on walls, zones, dimensions, and arrows. Every property can also be edited numerically in the Properties panel.

## File formats

| Format | Notes |
|---|---|
| **Project (.wcad.json)** | The native save format, which you can reopen to keep editing. The work in progress is also autosaved to the browser's local storage. |
| **DXF** | AutoCAD R12 ASCII (AC1009), with one DXF layer per app layer plus colours, dashed linetypes, and filled solids. Units are millimetres (metric) or inches (imperial). It opens in AutoCAD, BricsCAD, DraftSight, LibreCAD, QCAD, and others. |
| **PDF** | Vector print layout from A4 to A0, Letter, Tabloid, or ARCH D, at an automatic or fixed scale (1:10 to 1:20000). Includes a title block (project, pallet positions, scale, date, drawn by, revision) and a scale bar. |
| **SVG** | Vector drawing with one `<g>` group per layer |
| **PNG** | High-resolution raster image (4000 px on the long side) |

Hidden layers are left out of exports.

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| V | Select | S | Rack |
| H / Space+drag | Pan | L | Racking auto-layout |
| W | Wall | Z | Zone |
| B | Room | F | Flow arrow |
| C | Column | M | Dimension |
| D | Door | T | Text |
| O | Overhead door | E | Measure |
| K | Dock door | R | Rotate 90° (flips the door while placing one) |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z | Undo / redo | Del | Delete |
| Ctrl/⌘+D | Duplicate | Ctrl/⌘+A | Select all |
| Ctrl/⌘+S / O | Save / open | Arrows | Nudge (Shift ×10) |
| Home / 0 | Zoom to fit | G / F8 | Grid / ortho |
| Esc / right-click | Cancel or finish | ? | Help |

## Project structure

```
index.html        UI shell and dialogs
css/app.css       Styles
js/core.js        Data model, schemas and validation, geometry, drawing primitives, stats, auto-layout
js/export.js      DXF, SVG and PDF writers (no libraries)
js/render.js      Canvas renderer and PNG export
js/app.js         Tools, interaction, panels, file handling
tests/            Node unit tests (node:test)
```

Every object is turned into a single list of drawing primitives (lines, polygons, text). The screen renderer and all four exporters work from that same list, so what you see is what gets exported.

## Tests

You need Node.js 18 or later:

```sh
npm test
```

## Security

- The app is fully static and works offline. It makes no network requests, uses no analytics, and loads nothing from third parties.
- A strict Content Security Policy is set: `default-src 'none'`, with scripts and styles from the app's own origin only and no inline script.
- Opened project files are size-limited and parsed with `JSON.parse`. Every object is then rebuilt from a whitelist schema: unknown types and keys are dropped, numbers are clamped, and strings are length-limited with control characters stripped.
- User text is only ever rendered with `textContent` or on the canvas, and is escaped in SVG, PDF, and DXF output. The app has no `innerHTML`, `eval`, or dynamic code anywhere.

## License

MIT. See [LICENSE](LICENSE).

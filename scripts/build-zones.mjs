// Build data/zones.geojson: travel-time ("walk to the nearest bar") zones, a drop-in
// replacement for the straight-line Voronoi cells. One Polygon/MultiPolygon per bar,
// properties.id = barId. Build-time only; ship the result static (runtime stays free).
//
// ── Requires a local OSRM walking server ──────────────────────────────────────────────
// One-time setup with Docker Desktop (Northern California extract covers SF):
//
//   mkdir -p osrm && cd osrm
//   curl -L -o norcal.osm.pbf https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf
//   docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
//     osrm-extract -p /opt/foot.lua /data/norcal.osm.pbf
//   docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
//     osrm-partition /data/norcal.osrm
//   docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
//     osrm-customize /data/norcal.osrm
//   docker run -t -i -p 5000:5000 -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
//     osrm-routed --algorithm mld --max-table-size 100000 /data/norcal.osrm
//
// Then, in another terminal:   node scripts/build-zones.mjs
//   - OSRM_URL  (default http://localhost:5000)
//   - STEP_M    grid spacing in metres (default 150)
//   - pass --mock to skip OSRM and use straight-line distance (validates the pipeline only)
import { contours } from 'd3-contour';
import polygonClipping from 'polygon-clipping';
import { readFileSync, writeFileSync } from 'node:fs';

const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
const STEP_M = Number(process.env.STEP_M || 90); // fine enough that closely-spaced bars each win cells
const MOCK = process.argv.includes('--mock');
const PROFILE = 'foot'; // walking

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const bars = read('../data/bars.json');
const sf = read('../data/sf-boundary.geojson');
const ring = sf.geometry.coordinates[0];

// ── grid over the SF land polygon ─────────────────────────────────────────────────────
const lngs = ring.map(p => p[0]), lats = ring.map(p => p[1]);
const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
const minLat = Math.min(...lats), maxLat = Math.max(...lats);
const midLat = (minLat + maxLat) / 2;
const stepLat = STEP_M / 111_320;
const stepLng = STEP_M / (111_320 * Math.cos((midLat * Math.PI) / 180));
const cols = Math.ceil((maxLng - minLng) / stepLng) + 1;
const rows = Math.ceil((maxLat - minLat) / stepLat) + 1;
const xy = (gx, gy) => [minLng + gx * stepLng, minLat + gy * stepLat];

function inside(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// grid points that fall on land — only these need routing
const pts = [];
for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
  const ll = xy(gx, gy);
  if (inside(ll, ring)) pts.push({ gx, gy, ll });
}
console.log(`grid ${cols}x${rows}, ${pts.length} land points, ${bars.length} bars, mode=${MOCK ? 'MOCK' : PROFILE}`);

// ── travel times: nearest bar per land point ──────────────────────────────────────────
const haversine = (a, b) => {
  const R = 6371000, toR = d => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]), dLng = toR(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function osrmTable(sources, dests) {
  const coords = [...sources, ...dests].map(p => `${p[0]},${p[1]}`).join(';');
  const s = sources.map((_, i) => i).join(';');
  const d = dests.map((_, i) => sources.length + i).join(';');
  const url = `${OSRM_URL}/table/v1/${PROFILE}/${coords}?sources=${s}&destinations=${d}&annotations=duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`OSRM code ${json.code}`);
  return json.durations; // [source][dest] seconds (null = unreachable)
}

const barLL = bars.map(b => [b.lng, b.lat]);
async function assignLabels() {
  if (MOCK) {
    for (const p of pts) {
      let best = 0, bd = Infinity;
      barLL.forEach((b, i) => { const d = haversine(p.ll, b); if (d < bd) { bd = d; best = i; } });
      p.label = best;
    }
    return;
  }
  const CHUNK = 200;
  for (let i = 0; i < pts.length; i += CHUNK) {
    const batch = pts.slice(i, i + CHUNK);
    const durs = await osrmTable(batch.map(p => p.ll), barLL);
    batch.forEach((p, k) => {
      const row = durs[k];
      let best = -1, bd = Infinity;
      for (let j = 0; j < row.length; j++) if (row[j] != null && row[j] < bd) { bd = row[j]; best = j; }
      // fall back to straight-line if OSRM couldn't route this point to any bar
      if (best < 0) { let dd = Infinity; barLL.forEach((b, j) => { const d = haversine(p.ll, b); if (d < dd) { dd = d; best = j; } }); }
      p.label = best;
    });
    process.stdout.write(`\r routed ${Math.min(i + CHUNK, pts.length)}/${pts.length}`);
  }
  process.stdout.write('\n');
}
await assignLabels();

// dense label grid (-1 = water/outside)
const label = new Int16Array(cols * rows).fill(-1);
for (const p of pts) label[p.gy * cols + p.gx] = p.label;

// ── vectorize each bar's region via marching squares, then smooth/simplify/clip ───────
function chaikin(r, iters = 2) {
  let p = r;
  for (let t = 0; t < iters; t++) {
    const q = [];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(q[0]);
    p = q;
  }
  return p;
}
function dp(p, eps) {
  if (p.length < 3) return p;
  const d = (q, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t));
    return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
  };
  let mi = 0, mx = 0;
  for (let i = 1; i < p.length - 1; i++) { const dist = d(p[i], p[0], p[p.length - 1]); if (dist > mx) { mx = dist; mi = i; } }
  return mx > eps ? dp(p.slice(0, mi + 1), eps).slice(0, -1).concat(dp(p.slice(mi), eps)) : [p[0], p[p.length - 1]];
}
const toLngLat = r => r.map(([gx, gy]) => xy(gx, gy)); // d3-contour grid coords -> lng/lat
const round = g => g.map(poly => poly.map(r => r.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])));
const pip = (pt, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const contains = (coords, pt) => coords.some(poly => pip(pt, poly[0]));

const features = [];
for (let k = 0; k < bars.length; k++) {
  const field = Float64Array.from(label, v => (v === k ? 1 : 0));
  const [multi] = contours().size([cols, rows]).thresholds([0.5])(field); // one MultiPolygon
  if (!multi || !multi.coordinates.length) continue;
  const barPt = [bars[k].lng, bars[k].lat];
  // Smooth aggressively, but back off (less corner-cutting) if it would eject the bar from
  // its own — often thin — zone. Last resort: raw marching-squares rings, clipped.
  let coords = null;
  for (const [iters, tol] of [[2, 0.00012], [1, 0.00008], [0, 0.00004], [0, 0]]) {
    const rings = multi.coordinates.map(poly => poly.map(r => {
      let g = toLngLat(r);
      if (iters) g = chaikin(g, iters);
      if (tol) g = dp(g, tol);
      return g;
    }));
    const clipped = polygonClipping.intersection(rings, sf.geometry.coordinates);
    if (!clipped.length) continue;
    if (!coords) coords = round(clipped);          // keep first valid as fallback
    if (contains(clipped, barPt)) { coords = round(clipped); break; } // prefer one containing the bar
  }
  if (!coords) continue;
  features.push({
    type: 'Feature',
    properties: { id: bars[k].id },
    geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords },
  });
}

const out = { type: 'FeatureCollection', features };
writeFileSync(new URL('../data/zones.geojson', import.meta.url), JSON.stringify(out) + '\n');
console.log(`wrote ${features.length} zones, ${JSON.stringify(out).length} bytes${MOCK ? ' (MOCK — not real travel times)' : ''}`);

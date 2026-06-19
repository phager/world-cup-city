// Build data/sf-boundary.geojson: union real SF neighborhoods into one land polygon,
// simplify (Douglas-Peucker) and de-spike (drop acute pier/inlet tendrils) so the
// coastline reads cleanly. Run: node scripts/build-boundary.mjs [tolerance] [minAngleDeg]
// Requires network (fetches the neighborhood source once).
import polygonClipping from 'polygon-clipping';
import { writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/san-francisco.geojson';
const TOL = Number(process.argv[2] ?? 0.0016);     // ~160m
const MIN_ANGLE = Number(process.argv[3] ?? 35);   // drop spike tips sharper than this

const area = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
};

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const d = (p, a, b) => {
    const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1;
    let t = ((x - x1) * dx + (y - y1) * dy) / L; t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  let idx = 0, mx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = d(pts[i], pts[0], pts[pts.length - 1]);
    if (dist > mx) { mx = dist; idx = i; }
  }
  if (mx > eps) return dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(dp(pts.slice(idx), eps));
  return [pts[0], pts[pts.length - 1]];
}

// Remove vertices whose interior angle is very acute — these are thin spikes (piers/inlets).
function despike(ring, minAngleDeg) {
  const minCos = Math.cos((minAngleDeg * Math.PI) / 180); // angle < minAngle  =>  cos > minCos
  let pts = ring.slice(0, -1); // open
  for (let pass = 0; pass < 6; pass++) {
    const keep = [];
    let removed = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const dot = v1[0] * v2[0] + v1[1] * v2[1];
      const cos = dot / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
      if (cos > minCos) { removed++; continue; } // spike tip — drop b
      keep.push(b);
    }
    pts = keep;
    if (!removed) break;
  }
  pts.push(pts[0]);
  return pts;
}

const src = await fetch(SRC).then(r => r.json());
let merged = src.features[0].geometry.coordinates;
for (let i = 1; i < src.features.length; i++)
  merged = polygonClipping.union(merged, src.features[i].geometry.coordinates);

let best = null, bestA = -1;
for (const poly of merged) { const A = area(poly[0]); if (A > bestA) { bestA = A; best = poly[0]; } }

let ring = despike(dp(best, TOL), MIN_ANGLE);
ring = ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);

const out = {
  type: 'Feature',
  properties: { name: 'San Francisco land (click_that_hood neighborhoods, unioned + simplified)' },
  geometry: { type: 'Polygon', coordinates: [ring] },
};
writeFileSync(new URL('../data/sf-boundary.geojson', import.meta.url), JSON.stringify(out) + '\n');
console.log(`tol=${TOL} minAngle=${MIN_ANGLE} -> ${ring.length} pts, ${JSON.stringify(out).length} bytes`);

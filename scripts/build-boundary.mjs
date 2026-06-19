// Build data/sf-boundary.geojson: union real SF neighborhoods into one land polygon,
// then simplify so the coastline reads cleanly. Uses Douglas-Peucker for a cheap first
// pass, then Visvalingam-Whyatt (area-based) to a target vertex count — VW removes the
// smallest-area triangles first, which is exactly the thin pier/breakwater slivers that
// DP alone keeps (their tips sit far from the coastline chord). Run:
//   node scripts/build-boundary.mjs [targetPoints]
// Requires network (fetches the neighborhood source once).
import polygonClipping from 'polygon-clipping';
import { writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/san-francisco.geojson';
const TARGET = Number(process.argv[2] ?? 80); // final vertex count

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

// Visvalingam-Whyatt: repeatedly drop the vertex whose triangle (prev,cur,next) has the
// least area. On a cyclic ring this melts away thin spikes before it touches real headlands.
function visvalingam(ring, target) {
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  let p = ring.slice(0, -1); // open the ring
  while (p.length > target) {
    let mi = 0, ma = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ar = tri(a, b, c);
      if (ar < ma) { ma = ar; mi = i; }
    }
    p.splice(mi, 1);
  }
  p.push(p[0]); // close
  return p;
}

const src = await fetch(SRC).then(r => r.json());
let merged = src.features[0].geometry.coordinates;
for (let i = 1; i < src.features.length; i++)
  merged = polygonClipping.union(merged, src.features[i].geometry.coordinates);

let best = null, bestA = -1;
for (const poly of merged) { const A = area(poly[0]); if (A > bestA) { bestA = A; best = poly[0]; } }

let ring = visvalingam(dp(best, 0.0004), TARGET);   // DP thins, VW de-spikes to TARGET pts
ring = ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);

const out = {
  type: 'Feature',
  properties: { name: 'San Francisco land (click_that_hood neighborhoods, unioned + simplified)' },
  geometry: { type: 'Polygon', coordinates: [ring] },
};
writeFileSync(new URL('../data/sf-boundary.geojson', import.meta.url), JSON.stringify(out) + '\n');
console.log(`target=${TARGET} -> ${ring.length} pts, ${JSON.stringify(out).length} bytes`);

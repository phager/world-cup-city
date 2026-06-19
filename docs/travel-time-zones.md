# Plan: travel-time zones (instead of straight-line Voronoi)

**Colleague's question:** "I know it is Voronoi but I wonder whether you could do it
based on travel time to make it less straight-lines-only."

## Is it possible?
**Yes.** A Voronoi diagram assigns every point to the nearest bar by *straight-line*
distance — that's why the edges are straight. Swap the distance metric for **travel time
on the street/transit network** and every point goes to the bar you can *actually reach
fastest*. The boundaries then bend around hills, the bay, one-way streets, freeways, and
BART/Muni lines — organic curves, not straight bisectors. This is a "network/weighted
Voronoi" a.k.a. a **cost-allocation surface** built from **isochrones**.

It stays compatible with everything we already have: the zones are still one-per-bar static
polygons keyed by `barId`, so the **merge mechanic (recolor on result) is unchanged**. Only
how we *generate* the polygons changes.

## Key constraint: precompute offline, ship static
Routing at runtime needs a routing engine + API key + per-request cost — that breaks the
"tiny / free / no-backend" rule. So we do all routing **once at build time** and commit the
result as a static `data/zones.geojson`, exactly like we already do for `sf-boundary.geojson`.
Runtime cost stays zero; the app just loads polygons instead of computing Voronoi.

## Approach (grid → travel-time matrix → allocation → vectorize)
1. **Sample grid.** Lay a grid of points over the SF land polygon (~150 m spacing ≈
   ~3–4k points inside the boundary). Finer = smoother edges + bigger build.
2. **Travel-time matrix.** For each grid point, get travel time to the (nearest ~6) bars.
   Engine options:
   - **OSRM** (self-host via Docker on an OSM extract) — free, fast, no per-request cost;
     use its `table` service for many-to-many. Best fit for "tiny/free".
   - **Valhalla** — supports multimodal incl. pedestrian/transit, also self-hostable.
   - **OpenRouteService / Mapbox Matrix / Isochrone APIs** — hosted, easiest, but rate-limited
     and metered (fine for a one-off build of a few thousand points, watch free-tier caps).
   - **Mode matters:** for fans, **walking + transit** is more meaningful than driving.
     Start with walking (simplest, no schedules); add a transit engine later if wanted.
3. **Allocate.** Assign each grid cell to the bar with the **minimum travel time** → a
   labeled raster (one team/bar id per cell).
4. **Vectorize.** Polygonize contiguous same-label cells (marching squares, e.g. `d3-contour`
   or `topojson`/`mapshaper`), then **smooth** (Chaikin) and **simplify** (Douglas-Peucker,
   reuse the logic in `scripts/build-boundary.mjs`). Clip to `sf-boundary.geojson`.
5. **Emit** `data/zones.geojson`: a FeatureCollection of 32 features with `properties.id`
   = `barId` — drop-in replacement for the current `voronoiCells()` output.

## Code changes
- New `scripts/build-zones.mjs` — does steps 1–5 (build-time only; needs the routing engine).
- `src/app.js` — if `data/zones.geojson` exists, load it; else fall back to `voronoiCells()`.
  (Keep Voronoi as the zero-dependency default so the site never hard-depends on a build.)
- `src/logic.js` — unchanged. Optionally add a `nearestByTime(point, costs)` helper if we
  ever want a live preview, but not needed for the static build.
- Tests — add a check that `zones.geojson`, when present, has 32 features, ids match
  `bars.json`, and every bar point falls inside its own zone.

## Tradeoffs / cost
- **Build complexity:** needs OSRM/Valhalla (Docker) or a metered API for the one-time build.
- **Payload:** organic polygons have more vertices than 32 Voronoi cells. Mitigate with
  simplification; target keeping `zones.geojson` under ~50–100 KB.
- **Determinism:** travel times shift with the OSM extract / engine version — pin the data
  date so rebuilds are reproducible (same pattern as the boundary script).
- **Accuracy vs. effort:** grid resolution and mode (walk/transit/drive) are the main knobs.

## Recommended first cut
Self-hosted **OSRM walking** profile, 150 m grid, nearest-6 bars, Chaikin smooth +
DP simplify, clipped to the SF boundary. Free, reproducible, no runtime cost, and visually
delivers the "curved, travel-aware" boundaries the colleague is after. Driving/transit can be
added as alternate `zones-*.geojson` layers behind a mode toggle later.

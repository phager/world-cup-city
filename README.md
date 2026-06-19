# SF World Cup 2026 — Bar Bracket Map

San Francisco carved into **32 colored zones**, one per Round-of-32 team, each centered
on a real SF bar with TVs. As knockout matches are decided, the **loser's zone is absorbed
by the winner** — the patchwork collapses 32 → 16 → 8 → 4 → 2 until the city is split in
two for the Final (16 bars each).

Map-first, static, zero backend, ~no runtime cost beyond free map tiles.

## Stack
- Plain HTML/CSS/JS, ES modules, **no build step**.
- [Leaflet](https://leafletjs.com) + free CARTO/OSM raster tiles (no API key).
- [`d3-delaunay`](https://github.com/d3/d3-delaunay) for the one-time Voronoi tessellation,
  clipped to an SF land polygon with [`polygon-clipping`](https://github.com/mfogel/polygon-clipping)
  so zones hug the city shape (both loaded in-browser via importmap; installed locally only
  so Node tests can import them).
- Data: three small JSON files in `data/`.

## Run locally
```bash
npm install        # only for tests (d3-delaunay devDependency)
npm run serve      # tiny static server -> http://localhost:8080
```
Or open with any static server (`python3 -m http.server`, etc.). It must be *served*, not
opened as a `file://` URL, because it uses ES modules + `fetch`.

## Test
```bash
npm test           # node --test over the pure logic in src/logic.js (12 tests)
```
The map/DOM code (`src/app.js`) is intentionally thin glue; all real logic — merge
mechanic, search, team status, Voronoi — lives in `src/logic.js` and is unit-tested.

## Updating results during the tournament
Edit `data/bracket.json`. Each match has:
- `winner`: the real result (`null` until played). Set it as matches finish — the live map
  collapses automatically.
- `pick`: a projection used by the **Play** preview / round slider before real results exist.

If an **upset** changes who advances, also update the later-round `a`/`b` team codes so the
next matchup is correct. It's only 31 knockout matches total — tiny and safe to hand-edit.

You can also click **"Set results manually"** in the panel to play out scenarios live
(in-memory only; **Reset** restores `bracket.json`).

## Data files
- `data/bars.json` — 32 venues `{id,name,hood,lat,lng,address,url}`. Coordinates are
  hand-placed and approximate; refine as needed.
- `data/teams.json` — 48 teams `{code,name,color,flag}`. First 32 are seeded into the
  bracket; the other 16 are searchable and shown as "group stage".
- `data/bracket.json` — `seed` (bar → team) + 31 `matches`.
- `data/sf-boundary.geojson` — simplified SF land polygon; Voronoi zones are clipped to it.

> **Venue note:** these are seeded as bars (21+). If you want an **all-ages** map
> (sports cafés, restaurants with TVs, plazas, fan zones), swap the entries in `bars.json`
> and add a `notes` field — the rest of the app is unchanged.

## Travel-time zones (optional, organic boundaries)

By default zones are a straight-line **Voronoi**. You can replace them with **walking
travel-time** zones (each point belongs to the bar you can walk to fastest → curved,
network-aware borders) by generating a static `data/zones.geojson`. If that file exists,
the app loads it instead of computing Voronoi; if not, it falls back automatically.

It's precomputed offline against a local **OSRM** walking server (free, no API keys), so
runtime cost stays zero.

**1. Run OSRM (foot profile) with Docker Desktop** — a NorCal extract covers SF:
```bash
mkdir -p osrm && cd osrm
curl -L -o norcal.osm.pbf https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf
IMG=ghcr.io/project-osrm/osrm-backend
docker run -t -v "${PWD}:/data" $IMG osrm-extract  -p /opt/foot.lua /data/norcal.osm.pbf
docker run -t -v "${PWD}:/data" $IMG osrm-partition /data/norcal.osrm
docker run -t -v "${PWD}:/data" $IMG osrm-customize /data/norcal.osrm
docker run -t -i -p 5000:5000 -v "${PWD}:/data" $IMG \
  osrm-routed --algorithm mld --max-table-size 100000 /data/norcal.osrm
```
The first `osrm-extract` is the slow step (downloads/builds the graph); the rest are quick.
Leave `osrm-routed` running.

**2. Generate the zones** (in another terminal, from the repo root):
```bash
node scripts/build-zones.mjs          # walking; OSRM_URL defaults to http://localhost:5000
# knobs: STEP_M=120 node scripts/build-zones.mjs   (finer grid = smoother + bigger file)
# node scripts/build-zones.mjs --mock              (straight-line; pipeline test only, not real)
```
Commit `data/zones.geojson` to ship it. Delete it to revert to Voronoi. Transit/driving can
be added later as alternate layers (swap the OSRM profile).

## Deploy (free)
Static files only. Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy
from `main`, root). No build, no server, no keys. `node_modules` is gitignored and never
served.

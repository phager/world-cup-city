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

## Deploy (free)
Static files only. Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy
from `main`, root). No build, no server, no keys. `node_modules` is gitignored and never
served.

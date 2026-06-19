// Pure logic — no DOM, no Leaflet. Runs in browser (via importmap) and in Node (tests).
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';

export const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F'];
export const ROUND_LABEL = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals',
  SF: 'Semi-finals', F: 'Final',
};

export function roundIndex(r) { return ROUNDS.indexOf(r); }

function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Winner of a match. projected=true falls back to the `pick` projection when undecided.
export function winnerOf(match, projected = false) {
  if (match.winner) return match.winner;
  return projected ? (match.pick || null) : null;
}

// Recompute every matchup from the bracket tree so that setting a result flows downstream:
// R32 pairs are ranked[i] vs ranked[n-1-i]; each later match takes the (real-or-projected)
// winners of its two feeder matches. `pick` is refreshed to the better seed of the actual
// pair, and a stored `winner` that no longer belongs to the (changed) pair is cleared.
export function resolveBracket(bracket) {
  const ranked = bracket.ranked;
  const rankOf = Object.fromEntries(ranked.map((c, i) => [c, i]));
  const winnerAt = {};
  const byRound = Object.fromEntries(ROUNDS.map(r => [r, []]));
  for (const m of bracket.matches) byRound[m.round]?.push(m);
  for (const r of ROUNDS) byRound[r].forEach((m, i) => { if (m.winner) winnerAt[`${r}:${i}`] = m.winner; });

  const matches = [];
  let prev = null;
  for (let ri = 0; ri < ROUNDS.length; ri++) {
    const round = ROUNDS[ri];
    const count = 16 >> ri; // 16, 8, 4, 2, 1
    const cur = [];
    for (let i = 0; i < count; i++) {
      let a, b;
      if (ri === 0) { a = ranked[i]; b = ranked[ranked.length - 1 - i]; }
      else { const L = prev.length; a = winnerOf(prev[i], true); b = winnerOf(prev[L - 1 - i], true); }
      const pick = rankOf[a] <= rankOf[b] ? a : b;
      let winner = winnerAt[`${round}:${i}`] || null;
      if (winner !== a && winner !== b) winner = null; // stale after an upstream upset
      const m = { round, a, b, winner, pick };
      cur.push(m); matches.push(m);
    }
    prev = cur;
  }
  return { ...bracket, matches };
}

// owners: { barId -> teamCode } after applying decided merges through `through` rounds.
// `through` is a count: 0 = seed (32 zones), 5 = champion (1 zone).
export function computeOwners(bracket, through = ROUNDS.length, opts = {}) {
  const { projected = false } = opts;
  const owners = { ...bracket.seed };
  for (let i = 0; i < through; i++) {
    const round = ROUNDS[i];
    for (const m of bracket.matches) {
      if (m.round !== round) continue;
      const w = winnerOf(m, projected);
      if (!w) continue;
      const loser = m.a === w ? m.b : m.a;
      for (const bar of Object.keys(owners)) {
        if (owners[bar] === loser) owners[bar] = w; // absorb loser's whole territory
      }
    }
  }
  return owners;
}

// Ordered owner snapshots for the Play animation: frame[0]=seed ... frame[5]=champion.
export function mergeFrames(bracket, opts = {}) {
  const frames = [];
  for (let k = 0; k <= ROUNDS.length; k++) frames.push(computeOwners(bracket, k, opts));
  return frames;
}

// How far real results have progressed: highest round whose matches are all decided.
export function liveThrough(bracket) {
  let through = 0;
  for (let i = 0; i < ROUNDS.length; i++) {
    const ms = bracket.matches.filter(m => m.round === ROUNDS[i]);
    if (ms.length && ms.every(m => m.winner)) through = i + 1;
    else break;
  }
  return through;
}

export function zoneForTeam(teamCode, owners) {
  return Object.keys(owners).filter(bar => owners[bar] === teamCode);
}

// active | eliminated(round) | not_qualified — covers all 48 teams (real results only).
export function teamStatus(teamCode, bracket) {
  const seeded = new Set(Object.values(bracket.seed));
  if (!seeded.has(teamCode)) return { state: 'not_qualified' };
  for (const round of ROUNDS) {
    for (const m of bracket.matches) {
      if (m.round !== round || !m.winner) continue;
      if ((m.a === teamCode || m.b === teamCode) && m.winner !== teamCode) {
        return { state: 'eliminated', round };
      }
    }
  }
  return { state: 'active' };
}

// Per-venue story for the detail card: who started here, who holds it, when it flipped.
export function barHistory(barId, bracket) {
  const origin = bracket.seed[barId] || null;
  const frames = mergeFrames(bracket, { projected: false });
  let absorbedRound = null;
  for (let k = 1; k < frames.length; k++) {
    if (frames[k][barId] !== frames[k - 1][barId]) { absorbedRound = ROUNDS[k - 1]; break; }
  }
  return { origin, current: frames[frames.length - 1][barId] || origin, absorbedRound };
}

// The round a team lost within the first `through` rounds of the given view (projected or
// real). Returns the round code (e.g. 'R32') or null if they're still alive in that view.
export function eliminationRound(teamCode, bracket, through = ROUNDS.length, opts = {}) {
  const { projected = false } = opts;
  for (let i = 0; i < through; i++) {
    for (const m of bracket.matches) {
      if (m.round !== ROUNDS[i]) continue;
      const w = winnerOf(m, projected);
      if (!w) continue;
      if ((m.a === teamCode || m.b === teamCode) && w !== teamCode) return ROUNDS[i];
    }
  }
  return null;
}

// Ranked team matches: exact > prefix > substring, then alphabetical. Diacritic-insensitive.
export function searchTeams(query, teams) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const t of teams) {
    const name = norm(t.name), code = norm(t.code);
    let score = -1;
    if (name === q || code === q) score = 0;
    else if (name.startsWith(q) || code.startsWith(q)) score = 1;
    else if (name.includes(q) || code.includes(q)) score = 2;
    if (score >= 0) scored.push({ t, score });
  }
  scored.sort((x, y) => x.score - y.score || x.t.name.localeCompare(y.t.name));
  return scored.map(s => s.t);
}

// One Voronoi polygon per bar, clipped to bbox=[minLng,minLat,maxLng,maxLat].
// If `clip` (a Polygon coordinates array, e.g. an SF land boundary) is given, each cell
// is intersected with it so zones hug the city shape. Returns GeoJSON Features.
export function voronoiCells(bars, bbox, clip = null) {
  const points = bars.map(b => [b.lng, b.lat]);
  const voronoi = Delaunay.from(points).voronoi(bbox);
  return bars.map((b, i) => {
    const ring = voronoi.cellPolygon(i); // closed ring of [lng,lat], or null if degenerate
    let geometry = ring ? { type: 'Polygon', coordinates: [ring] } : null;
    if (geometry && clip) geometry = clipToPolygon(geometry.coordinates, clip);
    return { type: 'Feature', properties: { id: b.id }, geometry };
  });
}

// Intersect Polygon coords with a clip Polygon. Returns Polygon/MultiPolygon geometry or null.
function clipToPolygon(polyCoords, clipCoords) {
  const out = polygonClipping.intersection(polyCoords, clipCoords);
  if (!out || out.length === 0) return null;
  return out.length === 1
    ? { type: 'Polygon', coordinates: out[0] }
    : { type: 'MultiPolygon', coordinates: out };
}

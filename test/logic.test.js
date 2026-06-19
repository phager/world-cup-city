import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUNDS, computeOwners, mergeFrames, liveThrough, zoneForTeam,
  teamStatus, searchTeams, voronoiCells, barHistory, winnerOf,
} from '../src/logic.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const bracket = read('../data/bracket.json');
const bars = read('../data/bars.json');
const teams = read('../data/teams.json');
const sf = read('../data/sf-boundary.geojson');

// Small synthetic bracket for deterministic merge tests.
const mini = {
  rounds: ROUNDS,
  seed: { z1: 'JPN', z2: 'BRA', z3: 'FRA', z4: 'GHA' },
  matches: [
    { round: 'R32', a: 'JPN', b: 'BRA', winner: 'BRA', pick: 'JPN' },
    { round: 'R32', a: 'FRA', b: 'GHA', winner: 'FRA', pick: 'FRA' },
    { round: 'R16', a: 'BRA', b: 'FRA', winner: 'FRA', pick: 'BRA' },
  ],
};

test('winnerOf respects real result, falls back to pick only when projected', () => {
  assert.equal(winnerOf({ winner: 'BRA', pick: 'JPN' }), 'BRA');
  assert.equal(winnerOf({ winner: null, pick: 'JPN' }), null);
  assert.equal(winnerOf({ winner: null, pick: 'JPN' }, true), 'JPN');
});

test('computeOwners: loser bars transfer to winner', () => {
  const o = computeOwners(mini, 1); // after R32
  assert.equal(o.z1, 'BRA'); // JPN lost -> BRA
  assert.equal(o.z2, 'BRA');
  assert.equal(o.z3, 'FRA');
  assert.equal(o.z4, 'FRA'); // GHA lost -> FRA
});

test('computeOwners: merges chain across rounds', () => {
  const o = computeOwners(mini, 2); // after R16: FRA beat BRA
  assert.deepEqual(o, { z1: 'FRA', z2: 'FRA', z3: 'FRA', z4: 'FRA' });
});

test('computeOwners through=0 is the seed (no merges)', () => {
  assert.deepEqual(computeOwners(mini, 0), mini.seed);
});

test('owner count halves each round on the real bracket projection', () => {
  const frames = mergeFrames(bracket, { projected: true });
  const distinct = frames.map(f => new Set(Object.values(f)).size);
  assert.deepEqual(distinct, [32, 16, 8, 4, 2, 1]);
});

test('liveThrough reflects only fully-decided rounds', () => {
  assert.equal(liveThrough(bracket), 0); // seed bracket: nothing decided
  assert.equal(liveThrough(mini), 2);    // R32 and R16 both fully decided
});

test('zoneForTeam returns the bars a team currently holds', () => {
  const o = computeOwners(mini, 1);
  assert.deepEqual(zoneForTeam('BRA', o).sort(), ['z1', 'z2']);
  assert.deepEqual(zoneForTeam('JPN', o), []);
});

test('teamStatus: active / eliminated(round) / not_qualified', () => {
  assert.deepEqual(teamStatus('FRA', mini), { state: 'active' });
  assert.deepEqual(teamStatus('JPN', mini), { state: 'eliminated', round: 'R32' });
  assert.deepEqual(teamStatus('BRA', mini), { state: 'eliminated', round: 'R16' });
  assert.deepEqual(teamStatus('ARG', mini), { state: 'not_qualified' });
});

test('barHistory tells the origin, current owner, and absorption round', () => {
  assert.deepEqual(barHistory('z1', mini), { origin: 'JPN', current: 'FRA', absorbedRound: 'R32' });
  assert.deepEqual(barHistory('z3', mini), { origin: 'FRA', current: 'FRA', absorbedRound: null });
});

test('searchTeams: case/diacritic-insensitive, exact ranked first', () => {
  assert.equal(searchTeams('usa', teams)[0].code, 'USA');
  assert.equal(searchTeams('USA', teams)[0].code, 'USA');
  assert.equal(searchTeams('united', teams)[0].code, 'USA');
  assert.equal(searchTeams('mexico', teams)[0].code, 'MEX'); // matches "México"? data is ascii, sanity check
  assert.deepEqual(searchTeams('', teams), []);
  assert.ok(searchTeams('zzzz', teams).length === 0);
});

test('searchTeams covers all 48 teams (qualified + eliminated)', () => {
  assert.equal(teams.length, 48);
  // a non-qualified team is still findable
  assert.equal(searchTeams('iran', teams)[0].code, 'IRN');
  assert.deepEqual(teamStatus('IRN', bracket), { state: 'not_qualified' });
});

test('voronoiCells with SF clip: 32 cells, none bleed past the boundary box', () => {
  const lats = bars.map(b => b.lat), lngs = bars.map(b => b.lng), pad = 0.025;
  const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad,
                Math.max(...lngs) + pad, Math.max(...lats) + pad];
  const ring = sf.geometry.coordinates[0];
  const bx = [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
              Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
  const cells = voronoiCells(bars, bbox, sf.geometry.coordinates);
  assert.equal(cells.length, 32);
  for (const c of cells) {
    assert.ok(c.geometry, 'every seeded bar keeps a clipped cell');
    assert.ok(['Polygon', 'MultiPolygon'].includes(c.geometry.type));
    // flatten all coords; clipped cells must stay within the SF bounding box
    const coords = JSON.stringify(c.geometry.coordinates).match(/-?\d+\.\d+/g).map(Number);
    for (let i = 0; i < coords.length; i += 2) {
      const lng = coords[i], lat = coords[i + 1];
      assert.ok(lng >= bx[0] - 1e-6 && lng <= bx[2] + 1e-6, 'clipped lng within SF bounds');
      assert.ok(lat >= bx[1] - 1e-6 && lat <= bx[3] + 1e-6, 'clipped lat within SF bounds');
    }
  }
});

test('voronoiCells: one valid polygon per bar, within bbox', () => {
  const lats = bars.map(b => b.lat), lngs = bars.map(b => b.lng);
  const pad = 0.02;
  const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad,
                Math.max(...lngs) + pad, Math.max(...lats) + pad];
  const cells = voronoiCells(bars, bbox);
  assert.equal(cells.length, 32);
  for (const c of cells) {
    assert.equal(c.geometry.type, 'Polygon');
    const ring = c.geometry.coordinates[0];
    assert.ok(ring.length >= 4, 'closed ring needs >=4 points');
    for (const [lng, lat] of ring) {
      assert.ok(lng >= bbox[0] - 1e-6 && lng <= bbox[2] + 1e-6, 'lng in bbox');
      assert.ok(lat >= bbox[1] - 1e-6 && lat <= bbox[3] + 1e-6, 'lat in bbox');
    }
  }
});

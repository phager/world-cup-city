// Build data/bracket.json from a geographic seed (bar -> team) and a strength ranking.
// Run: node scripts/build-bracket.mjs
//
// `seed` places the 32 *likely* Round-of-32 qualifiers (top 2 of each group + 8 best
// thirds, per the current WC2026 standings) onto SF bars. Placement is audited for taste
// (see notes below). `ranked` (1=strongest) is only used to seed the projection bracket
// `pick` field used by the Play preview; real results go in each match's `winner`.
import { writeFileSync, readFileSync } from 'node:fs';

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F'];

// bar -> team. Audited pairings:
//  - MEX in the Mission (Bender's), KOR next door (Phone Booth) -> Voronoi-adjacent.
//  - Hi Tops (LGBTQ+ sports bar) -> Netherlands; Wild Side West (lesbian bar) -> Sweden;
//    El Rio (Latin/queer) -> Ecuador. Tasteful, not mocking.
//  - Alcohol-restrictive nations placed at plainly-named neighborhood bars, never at the
//    LGBTQ+ venues: Saudi Arabia -> Connecticut Yankee, Iran -> Hockey Haven,
//    Morocco -> Pig & Whistle.
//  - Trad'r Sam (Polynesian-kitsch tiki) -> Czechia, to avoid pairing a Pacific nation
//    with a culturally-appropriative theme; New Zealand -> The Riptide (a beach bar).
const seed = {
  b01: 'USA', b02: 'CAN', b03: 'BEL', b04: 'BRA', b05: 'ENG', b06: 'FRA', b07: 'COL',
  b08: 'GER', b09: 'AUS', b10: 'POR', b11: 'SCO', b12: 'JPN', b13: 'BIH', b14: 'NOR',
  b15: 'NED', b16: 'AUT', b17: 'ESP', b18: 'KOR', b19: 'MEX', b20: 'ECU', b21: 'COD',
  b22: 'SWE', b23: 'KSA', b24: 'GHA', b25: 'SUI', b26: 'URU', b27: 'ARG', b28: 'MAR',
  b29: 'CIV', b30: 'CZE', b31: 'IRN', b32: 'NZL',
};

// Strength order (1 = strongest) from current standings: pts, then GD, then GF.
const ranked = [
  'MEX', 'CAN', 'SUI', 'GER', 'SWE', 'USA', 'NOR', 'ARG', 'ENG', 'COL', 'FRA', 'AUT',
  'AUS', 'SCO', 'CIV', 'GHA', 'KOR', 'NED', 'NZL', 'JPN', 'IRN', 'URU', 'MAR', 'KSA',
  'COD', 'BRA', 'BEL', 'POR', 'ESP', 'CZE', 'BIH', 'ECU',
];

// sanity: seed and ranked must be the same 32 teams, all present in teams.json
const teams = new Set(JSON.parse(readFileSync(new URL('../data/teams.json', import.meta.url))).map(t => t.code));
const seedSet = new Set(Object.values(seed));
if (seedSet.size !== 32) throw new Error('seed must have 32 distinct teams, got ' + seedSet.size);
for (const c of seedSet) if (!teams.has(c)) throw new Error('seed team not in teams.json: ' + c);
if (ranked.length !== 32 || new Set(ranked).size !== 32) throw new Error('ranked must be 32 distinct');
for (const c of ranked) if (!seedSet.has(c)) throw new Error('ranked team not seeded: ' + c);

// Standard seeding bracket (i vs n-1-i); better rank is the projected `pick`.
const rankOf = Object.fromEntries(ranked.map((c, i) => [c, i]));
const matches = [];
let alive = ranked.slice();
for (const round of ROUNDS) {
  const next = [];
  for (let i = 0; i < alive.length / 2; i++) {
    const a = alive[i], b = alive[alive.length - 1 - i];
    const pick = rankOf[a] < rankOf[b] ? a : b;
    matches.push({ round, a, b, winner: null, pick });
    next.push(pick);
  }
  alive = next;
}

const bracket = {
  rounds: ROUNDS,
  note: 'winner=real result (null=undecided). pick=projection used by the Play preview. ' +
        'Edit winner as matches finish; if an upset changes who advances, update later a/b too.',
  seed,
  matches,
};
writeFileSync(new URL('../data/bracket.json', import.meta.url), JSON.stringify(bracket, null, 2) + '\n');
console.log(`seed=${seedSet.size} matches=${matches.length} champion-pick=${alive[0]}`);

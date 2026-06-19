import L from 'leaflet';
import {
  ROUNDS, ROUND_LABEL, computeOwners, voronoiCells, zoneForTeam,
  teamStatus, searchTeams, barHistory, liveThrough, eliminationRound,
} from './logic.js';

// ---- load static data -------------------------------------------------------
const [bars, teams, bracket0, sf] = await Promise.all(
  ['data/bars.json', 'data/teams.json', 'data/bracket.json', 'data/sf-boundary.geojson']
    .map(u => fetch(u).then(r => r.json()))
);
let bracket = structuredClone(bracket0);          // mutable working copy (manual results)
const teamBy = Object.fromEntries(teams.map(t => [t.code, t]));
const barBy = Object.fromEntries(bars.map(b => [b.id, b]));
const colorOf = code => (teamBy[code]?.color) || '#888';

// ---- map --------------------------------------------------------------------
const map = L.map('map', { zoomControl: false, attributionControl: true })
  .setView([37.766, -122.446], 12.4);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; OpenStreetMap &copy; CARTO',
}).addTo(map);

// ---- one-time Voronoi geometry from the 32 bars -----------------------------
const lats = bars.map(b => b.lat), lngs = bars.map(b => b.lng), pad = 0.025;
const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad,
              Math.max(...lngs) + pad, Math.max(...lats) + pad];
const cells = voronoiCells(bars, bbox, sf.geometry.coordinates);

let owners = {};          // barId -> teamCode  (current view)
let selected = null;      // highlighted team code

const zoneLayer = L.geoJSON({ type: 'FeatureCollection', features: cells }, {
  style: f => styleFor(f.properties.id),
  onEachFeature: (f, layer) => layer.on('click', () => openBarPopup(f.properties.id, layer)),
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);

function styleFor(barId) {
  const code = owners[barId];
  const isSel = selected && code === selected;
  return {
    fillColor: colorOf(code), fillOpacity: 0.55,
    color: isSel ? '#fff' : 'rgba(255,255,255,0.35)',
    weight: isSel ? 3 : 0.8,
  };
}

// star = a team's original home base; dot = territory it absorbed.
function renderMarkers() {
  markerLayer.clearLayers();
  for (const b of bars) {
    const code = owners[b.id];
    const home = bracket.seed[b.id] === code;       // still held by its original team?
    const c = colorOf(code);
    const html = home
      ? `<span class="m-star" style="color:${c}">★</span>`
      : `<span class="m-dot" style="background:${c}"></span>`;
    L.marker([b.lat, b.lng], {
      icon: L.divIcon({ className: 'm-icon', html, iconSize: [18, 18] }),
    }).on('click', () => openBarPopup(b.id)).addTo(markerLayer);
  }
}

// ---- render a given tournament depth ---------------------------------------
function render(through) {
  owners = computeOwners(bracket, through, { projected: true });
  zoneLayer.setStyle(f => styleFor(f.properties.id));
  renderMarkers();
  const n = new Set(Object.values(owners)).size;
  document.getElementById('round-name').textContent =
    through === 0 ? 'Round of 32 (start)' : ROUND_LABEL[ROUNDS[through - 1]] + ' done';
  document.getElementById('zone-count').textContent = `${n} zone${n > 1 ? 's' : ''}`;
  if (selected) showTeam(selected, false);          // refresh detail without re-zoom
}

// ---- popup ------------------------------------------------------------------
function openBarPopup(barId, layer) {
  const b = barBy[barId];
  const code = owners[barId];
  const t = teamBy[code];
  const h = barHistory(barId, bracket);
  // Resolve to the actual named venue (coords are approximate, a lat/lng pin can miss the door).
  const place = encodeURIComponent(`${b.name}, ${b.address}, San Francisco, CA`);
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${place}`;
  const listing = `https://www.google.com/maps/search/?api=1&query=${place}`;
  let story = `Home base of <b>${flagName(h.origin)}</b> fans.`;
  if (h.origin !== code) story = `${flagName(h.origin)}'s zone — absorbed by <b>${flagName(code)}</b>` +
    (h.absorbedRound ? ` in the ${ROUND_LABEL[h.absorbedRound]}` : '') + '.';
  const html =
    `<div class="popup"><b>${b.name}</b><br>` +
    `<span class="meta">${b.hood} · ${b.address}</span><br>` +
    `<span style="color:${colorOf(code)}">${t?.flag || ''} ${t?.name || code}</span><br>` +
    `<span class="meta">${story}</span><br>` +
    `<a href="${dir}" target="_blank" rel="noopener">Directions</a> · ` +
    `<a href="${listing}" target="_blank" rel="noopener">Listing</a></div>`;
  const popup = L.popup({ maxWidth: 240 }).setLatLng([b.lat, b.lng]).setContent(html);
  map.openPopup(popup);
}
const flagName = code => `${teamBy[code]?.flag || ''} ${teamBy[code]?.name || code}`;

// ---- round slider + play ----------------------------------------------------
const slider = document.getElementById('round');
slider.value = String(liveThrough(bracket));        // start at real progress (seed: 0)
slider.addEventListener('input', () => render(+slider.value));

let playing = null;
document.getElementById('play').addEventListener('click', e => {
  if (playing) { clearInterval(playing); playing = null; e.target.textContent = '▶ Play tournament'; return; }
  e.target.textContent = '⏸ Pause';
  let k = 0; slider.value = '0'; render(0);
  playing = setInterval(() => {
    k++; slider.value = String(k); render(k);
    if (k >= ROUNDS.length) { clearInterval(playing); playing = null; e.target.textContent = '▶ Play tournament'; }
  }, 1400);
});
document.getElementById('reset').addEventListener('click', () => {
  bracket = structuredClone(bracket0);
  selected = null; document.getElementById('search').value = ''; renderResults('');
  slider.value = String(liveThrough(bracket)); buildMatchList(); render(+slider.value);
});

// ---- manual result setting --------------------------------------------------
function buildMatchList() {
  const box = document.getElementById('matches');
  box.innerHTML = '';
  bracket.matches.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'match';
    const btn = (code) => {
      const won = m.winner === code;
      return `<button data-i="${i}" data-w="${code}" class="${won ? 'win' : ''}">` +
        `${teamBy[code]?.flag || ''} ${code}</button>`;
    };
    row.innerHTML = `<span class="rd">${m.round}</span>${btn(m.a)}<span class="vs">v</span>${btn(m.b)}`;
    box.appendChild(row);
  });
  box.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    const i = +btn.dataset.i, w = btn.dataset.w, m = bracket.matches[i];
    m.winner = (m.winner === w) ? null : w;         // toggle
    const idx = ROUNDS.indexOf(m.round) + 1;
    if (+slider.value < idx) slider.value = String(idx);
    buildMatchList(); render(+slider.value);
  }));
}

// ---- search over all 48 teams ----------------------------------------------
const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => renderResults(searchEl.value));
function renderResults(q) {
  const box = document.getElementById('results');
  const hits = searchTeams(q, teams).slice(0, 8);
  box.innerHTML = hits.map(t => {
    const st = teamStatus(t.code, bracket);
    const label = st.state === 'not_qualified' ? 'group stage'
      : st.state === 'eliminated' ? `out ${st.round}` : 'in';
    return `<div class="result" data-code="${t.code}">` +
      `<span class="swatch" style="background:${t.color}"></span>` +
      `<span class="flag">${t.flag}</span><span>${t.name}</span>` +
      `<span class="st">${label}</span></div>`;
  }).join('');
  box.querySelectorAll('.result').forEach(el =>
    el.addEventListener('click', () => { searchEl.value = teamBy[el.dataset.code].name; box.innerHTML = ''; showTeam(el.dataset.code, true); }));
  if (!q) document.getElementById('team-detail').innerHTML = '';
}

function showTeam(code, zoom) {
  selected = code;
  zoneLayer.setStyle(f => styleFor(f.properties.id));
  const t = teamBy[code];
  const barIds = zoneForTeam(code, owners);
  const st = teamStatus(code, bracket);
  let head;
  if (st.state === 'not_qualified') head = 'Did not reach the Round of 32.';
  else if (barIds.length === 0) {
    // Use the round they lost in the CURRENT view (projected bracket), not real-only status.
    const lost = eliminationRound(code, bracket, +slider.value, { projected: true }) || st.round;
    head = lost ? `Eliminated in the ${ROUND_LABEL[lost] || lost} — zone absorbed.` : 'Zone absorbed.';
  } else head = `Holds <b>${barIds.length}</b> zone${barIds.length > 1 ? 's' : ''} at this point.`;
  const list = barIds.map(id => `<li>${barBy[id].name} <span style="color:var(--muted)">· ${barBy[id].hood}</span></li>`).join('');
  document.getElementById('team-detail').innerHTML =
    `<h3>${t.flag} ${t.name}</h3><div>${head}</div>` + (list ? `<ul>${list}</ul>` : '');
  if (zoom && barIds.length) {
    const b = L.latLngBounds(barIds.map(id => [barBy[id].lat, barBy[id].lng]));
    map.fitBounds(b.pad(0.4), { maxZoom: 14 });
  }
}

// ---- panel collapse ---------------------------------------------------------
document.getElementById('panel-toggle').addEventListener('click', e => {
  const collapsed = document.getElementById('panel').classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  e.currentTarget.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
});

// ---- go ---------------------------------------------------------------------
buildMatchList();
render(+slider.value);

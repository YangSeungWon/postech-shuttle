'use strict';

/* ------------------------------------------------------------------ *
 * POSTECH 셔틀버스 지도
 * 위치는 공개 시간표를 보간해 계산한 "예상" 위치입니다 (실시간 GPS 아님).
 * ------------------------------------------------------------------ */

const CENTER = [36.0175, 129.3235];
const CANON = DATA.canon || {};
const canon = n => CANON[n] || n;
const LS_COORDS = 'postech-shuttle-stop-coords';

/* 저장해 둔 보정 좌표가 있으면 덮어씀 */
let STOPS = Object.assign({}, DATA.stops);
try {
  const saved = JSON.parse(localStorage.getItem(LS_COORDS) || 'null');
  if (saved) Object.assign(STOPS, saved);
} catch (e) { /* 저장소 접근 불가 — 기본 좌표 사용 */ }

/* ---------- 시간 ---------- */
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmt = min => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
let simMinutes = null;                        // null이면 실제 시각
function nowMin() {
  if (simMinutes !== null) return simMinutes;
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/* ---------- 거리 ---------- */
const R = 6371000;
function dist(a, b) {                          // 미터
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const la = (a[0] + b[0]) / 2 * Math.PI / 180;
  const x = dLng * Math.cos(la);
  return R * Math.hypot(dLat, x);
}
const humanDist = m => m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km';
const walkMin = m => Math.max(1, Math.round(m * 1.35 / 75));  // 목록용 어림값 (직선 + 우회 보정)

/* ---------- 경로: 누적거리 미리 계산 ---------- */
for (const p of Object.values(DATA.paths)) {
  p.cum = [0];
  for (let i = 1; i < p.coords.length; i++) p.cum.push(p.cum[i - 1] + dist(p.coords[i - 1], p.coords[i]));
}

/* 노선 i번째 구간에서 진행률 f(0~1)일 때의 좌표 */
function posOnLeg(path, legIdx, f) {
  const a = path.idx[legIdx], b = path.idx[legIdx + 1];
  if (a === b) return path.coords[a];
  const target = path.cum[a] + (path.cum[b] - path.cum[a]) * f;
  let lo = a, hi = b;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; (path.cum[mid] <= target ? lo = mid : hi = mid); }
  const span = path.cum[hi] - path.cum[lo];
  const t = span > 0 ? (target - path.cum[lo]) / span : 0;
  const p0 = path.coords[lo], p1 = path.coords[hi];
  return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
}

/* ---------- 노선 인덱스 ---------- */
const ROUTES = DATA.routes.map(r => ({
  ...r,
  path: DATA.paths[r.path],
  tripsMin: r.trips.map(t => t.map(toMin)),
  canonStops: r.stops.map(canon),
}));
const GROUPS = [
  { id: 'route1', label: '순환 1', color: '#2674d9', match: r => r.id === 'route1' },
  { id: 'route2', label: '순환 2', color: '#e0632a', match: r => r.id === 'route2' },
  { id: 'route3', label: '순환 3', color: '#2f9e6e', match: r => r.id === 'route3' },
  { id: 'jigok',  label: '지곡',   color: '#DAB765', match: r => r.id.startsWith('jigok:') },
  { id: 'yugang', label: '유강',   color: '#A61955', match: r => r.id.startsWith('yugang:') },
];
const groupOf = r => GROUPS.find(g => g.match(r));
ROUTES.forEach(r => { const g = groupOf(r); r.color = g.color; r.group = g.id; });

const active = new Set(GROUPS.map(g => g.id));
const isOn = r => active.has(r.group);

/* 마커를 세울 고유 정류장 목록 */
const STOP_LIST = [...new Set(ROUTES.flatMap(r => r.canonStops))]
  .filter(n => STOPS[n]).map(n => ({ name: n, ll: STOPS[n] }));

/* ---------- 도착 예정 계산 ---------- */
/**
 * 해당 정류장에 다음으로 오는 버스들. 같은 노선은 가장 빠른 것만.
 * @returns [{route, eta(분), at(분), after(분|null)}]
 */
function arrivalsAt(stopName, t) {
  const out = [];
  for (const r of ROUTES) {
    if (!isOn(r)) continue;
    const hits = [];
    r.canonStops.forEach((s, i) => { if (s === stopName) hits.push(i); });
    if (!hits.length) continue;
    const times = [];
    for (const trip of r.tripsMin) for (const i of hits) if (trip[i] >= t - 0.5) times.push(trip[i]);
    if (!times.length) continue;
    times.sort((a, b) => a - b);
    out.push({ route: r, at: times[0], eta: times[0] - t, after: times[1] ?? null });
  }
  return out.sort((a, b) => a.eta - b.eta);
}

/* ---------- 운행 중인 버스 ---------- */
function activeBuses(t) {
  const buses = [];
  for (const r of ROUTES) {
    if (!isOn(r)) continue;
    r.tripsMin.forEach((trip, ti) => {
      if (t < trip[0] || t > trip[trip.length - 1]) return;
      let leg = 0;
      while (leg < trip.length - 2 && t >= trip[leg + 1]) leg++;
      const span = trip[leg + 1] - trip[leg];
      const f = span > 0 ? Math.min(1, Math.max(0, (t - trip[leg]) / span)) : 0;
      buses.push({
        key: r.id + '#' + ti,
        route: r,
        ll: posOnLeg(r.path, leg, f),
        from: r.stops[leg], to: r.stops[leg + 1], arriveAt: trip[leg + 1],
      });
    });
  }
  return buses;
}

/* ================================================================== *
 * 지도
 * ================================================================== */
const map = L.map('map', { center: CENTER, zoom: 15, zoomControl: false, attributionControl: true });
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap 기여자'
}).addTo(map);

const layerRoutes = L.layerGroup().addTo(map);
const layerStops  = L.layerGroup().addTo(map);
const layerBuses  = L.layerGroup().addTo(map);

/* --- 노선 폴리라인 --- */
/* 노선들이 같은 도로를 공유하므로 화면상 나란히 어긋나게 그린다.
   픽셀 간격이 일정해야 하니 확대 배율이 바뀔 때마다 다시 계산한다. */
const LANE_PX = 3.4;

function offsetLine(coords, px) {
  if (!px) return coords;
  const pts = coords.map(c => map.latLngToLayerPoint(L.latLng(c)));
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // 진행 방향의 법선 방향으로 밀어낸다
    const p = pts[i];
    out.push(map.layerPointToLatLng(L.point(p.x - dy / len * px, p.y + dx / len * px)));
  }
  return out;
}

function drawRoutes() {
  layerRoutes.clearLayers();
  const seen = new Set(), lines = [];
  for (const r of ROUTES) {
    if (!isOn(r) || seen.has(r.path)) continue;   // 같은 경로는 한 번만
    seen.add(r.path);
    lines.push(r);
  }
  const mid = (lines.length - 1) / 2;
  const shifted = lines.map((r, i) => ({ r, line: offsetLine(r.path.coords, (i - mid) * LANE_PX) }));
  // 흰 테두리를 먼저 전부 깔아야 나중 노선이 앞 노선 색을 지우지 않는다
  for (const { line } of shifted) {
    L.polyline(line, { color: '#fff', weight: 6.5, opacity: .85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layerRoutes);
  }
  for (const { r, line } of shifted) {
    L.polyline(line, { color: r.color, weight: 3.4, opacity: .95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layerRoutes);
  }
}
map.on('zoomend', drawRoutes);

/* --- 정류장 마커 --- */
let selected = null;
const stopMarkers = new Map();
function drawStops() {
  layerStops.clearLayers(); stopMarkers.clear();
  for (const s of STOP_LIST) {
    const m = L.marker(s.ll, {
      icon: L.divIcon({
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<div class="stop-marker"></div><div class="stop-label">${s.name}</div>`
      }),
      draggable: editMode, zIndexOffset: 100,
    }).addTo(layerStops);
    m.on('click', () => selectStop(s.name));
    m.on('dragend', e => {
      const ll = e.target.getLatLng();
      STOPS[s.name] = s.ll = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)];
      for (const [alias, target] of Object.entries(CANON)) if (target === s.name) STOPS[alias] = STOPS[s.name];
      try { localStorage.setItem(LS_COORDS, JSON.stringify(STOPS)); } catch (err) {}
      render();
    });
    stopMarkers.set(s.name, m);
  }
  paintSelection(); paintLabels();
}
function paintSelection() {
  for (const [name, m] of stopMarkers) m.getElement()?.classList.toggle('sel', name === selected);
}
/* 축소 상태에서는 라벨이 서로 겹치므로 선택한 정류장만 이름을 보여 준다 */
function paintLabels() {
  document.getElementById('map').classList.toggle('labels-off', map.getZoom() < 16);
}
map.on('zoomend', paintLabels);

/* --- 버스 마커 --- */
const busMarkers = new Map();
function drawBuses(t) {
  const live = activeBuses(t), keep = new Set();
  for (const b of live) {
    keep.add(b.key);
    let m = busMarkers.get(b.key);
    const label = b.route.number;
    if (!m) {
      m = L.marker(b.ll, {
        icon: L.divIcon({
          className: '', iconSize: [30, 22], iconAnchor: [15, 11],
          html: `<div class="bus" style="background:${b.route.color}">${label}</div>`
        }),
        zIndexOffset: 400,
      }).addTo(layerBuses);
      busMarkers.set(b.key, m);
    } else {
      m.setLatLng(b.ll);
    }
    m.bindTooltip(
      `<b>${b.route.name}</b><br>${b.to} 방면 · ${fmt(b.arriveAt)} 도착 예정`,
      { direction: 'top', offset: [0, -12] }
    );
  }
  for (const [k, m] of busMarkers) if (!keep.has(k)) { layerBuses.removeLayer(m); busMarkers.delete(k); }
  return live.length;
}

/* --- 내 위치 --- */
let myLL = null, myMarker = null, myCircle = null, watchId = null, followMe = false;
function startLocate() {
  if (!navigator.geolocation) { alert('이 브라우저에서는 위치 기능을 쓸 수 없습니다.'); return; }
  followMe = true;
  document.getElementById('btnLoc').classList.add('on');
  if (watchId !== null) { if (myLL) map.setView(myLL, 16); return; }
  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    myLL = [latitude, longitude];
    if (!myMarker) {
      myMarker = L.marker(myLL, {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="me"></div>' }),
        zIndexOffset: 500, interactive: false,
      }).addTo(map);
      myCircle = L.circle(myLL, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
      map.setView(myLL, 16);
    } else {
      myMarker.setLatLng(myLL); myCircle.setLatLng(myLL).setRadius(accuracy);
      if (followMe) map.setView(myLL, map.getZoom());
    }
    render();
  }, err => {
    followMe = false;
    document.getElementById('btnLoc').classList.remove('on');
    alert('위치를 가져오지 못했습니다: ' + err.message + '\n(HTTPS 또는 localhost에서만 동작합니다)');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}
map.on('dragstart', () => { followMe = false; document.getElementById('btnLoc').classList.remove('on'); });

function selectStop(name) {
  selected = selected === name ? null : name;
  paintSelection();
  if (selected) map.panTo(STOPS[selected]);
  render();
}

/* ================================================================== *
 * 패널
 * ================================================================== */
const $ = id => document.getElementById(id);

function drawFilters() {
  $('filters').innerHTML = GROUPS.map(g => `
    <button class="chip ${active.has(g.id) ? 'on' : ''}" data-g="${g.id}"
            style="${active.has(g.id) ? `background:${g.color}` : `color:${g.color}`}">
      <span class="dot"></span>${g.label}
    </button>`).join('');
  $('filters').querySelectorAll('.chip').forEach(el => el.onclick = () => {
    const g = el.dataset.g;
    active.has(g) ? active.delete(g) : active.add(g);
    if (!active.size) active.add(g);            // 최소 1개는 켜 둠
    drawFilters(); drawRoutes(); render();
  });
}

function etaText(eta) {
  if (eta < 0.5) return '곧 도착';
  if (eta < 1.5) return '1분';
  return Math.round(eta) + '분';
}

function stopCard(name, t, distM) {
  const arr = arrivalsAt(name, t);
  const rows = arr.length ? arr.slice(0, 3).map(a => `
    <div class="arr">
      <span class="badge" style="background:${a.route.color}">${a.route.number}</span>
      <span class="arr-eta ${a.eta <= 3 ? 'soon' : ''}">${etaText(a.eta)}</span>
      <span class="arr-at">${fmt(a.at)}</span>
      ${a.after !== null ? `<span class="arr-next">다음 ${fmt(a.after)}</span>` : ''}
    </div>`).join('')
    : `<div class="empty">오늘 남은 운행이 없습니다.</div>`;
  return `
    <div class="stop ${selected === name ? 'active' : ''}" data-stop="${name}">
      <div class="stop-head">
        <span class="stop-name">${name}</span>
        ${distM != null ? `<span class="stop-dist">${humanDist(distM)} · 도보 ${walkMin(distM)}분</span>` : ''}
      </div>
      <div class="arrivals">${rows}</div>
    </div>`;
}

function render() {
  const t = nowMin();
  const running = drawBuses(t);

  $('clock').textContent = fmt(t);
  $('clock').classList.toggle('sim', simMinutes !== null);

  let html = '';

  if ($('trip').classList.contains('show')) {
    if (tripPlans.length) {
      html += `<div class="sec-title">추천 경로 <span class="count">${tripPlans.length}개</span></div>`;
      html += tripPlans.map(planCard).join('');
      html += `<div class="notice">도보 구간은 <b>OSM 실제 보행로</b>를 따라 계산했고(4.5km/h, 계단 가중), 승·하차 시각은 <b>공개 시간표 기준 예상</b>입니다.</div>`;
      $('panelScroll').innerHTML = html;
      $('panelScroll').querySelectorAll('.itin').forEach(el => el.onclick = () => {
        $('panelScroll').querySelectorAll('.itin').forEach(x => x.classList.remove('best'));
        el.classList.add('best');
        drawPlan(tripPlans[+el.dataset.plan]);
      });
      return;
    }
    if (tripFrom && tripTo) {
      $('panelScroll').innerHTML =
        `<div class="notice warn">이 시각에 <b>${tripFrom.label}</b>에서 <b>${tripTo.label}</b>까지 가는 셔틀 경로를 찾지 못했습니다. 운행 시간대(07:40–18:30)인지 확인해 보세요.</div>`;
      return;
    }
    html += `<div class="notice">출발지와 도착지를 입력하면 <b>도보 → 승차 → 환승 → 하차</b> 순서로 경로를 안내합니다.</div>`;
  }

  if (selected) {
    html += `<div class="sec-title">선택한 정류장</div>` + stopCard(selected, t, myLL ? dist(myLL, STOPS[selected]) : null);
  }

  const near = STOP_LIST
    .map(s => ({ ...s, d: myLL ? dist(myLL, s.ll) : null }))
    .filter(s => s.name !== selected);

  if (myLL) {
    near.sort((a, b) => a.d - b.d);
    html += `<div class="sec-title">내 주변 정류장 <span class="count">가까운 순</span></div>`;
    html += near.slice(0, 6).map(s => stopCard(s.name, t, s.d)).join('');
  } else {
    near.sort((a, b) => {
      const ea = arrivalsAt(a.name, t)[0]?.eta ?? 1e9;
      const eb = arrivalsAt(b.name, t)[0]?.eta ?? 1e9;
      return ea - eb;
    });
    html += `<div class="sec-title">곧 버스가 오는 정류장</div>`;
    html += near.slice(0, 6).map(s => stopCard(s.name, t, null)).join('');
    html += `<div class="notice">◎ 버튼을 누르면 <b>내 위치</b> 기준으로 가까운 정류장부터 정렬합니다.</div>`;
  }

  if (running === 0) {
    html += `<div class="notice warn">지금은 운행 중인 셔틀이 없습니다. 상단 <b>시간 이동</b>으로 운행 시간대(07:40–18:30)를 확인해 보세요.</div>`;
  }
  html += `<div class="notice">표시되는 버스 위치는 <b>공개 시간표를 보간한 예상 위치</b>이며 실제 차량 GPS가 아닙니다. 교통 상황에 따라 1~2분 차이가 날 수 있으니 <b>출발 시각 전에 도착</b>해 주세요.</div>`;

  $('panelScroll').innerHTML = html;
  $('panelScroll').querySelectorAll('.stop').forEach(el =>
    el.onclick = () => selectStop(el.dataset.stop));
}

/* ================================================================== *
 * 조작
 * ================================================================== */
$('btnLoc').onclick = startLocate;
$('btnFit').onclick = () => {
  const on = ROUTES.filter(isOn);
  map.fitBounds(L.latLngBounds(on.flatMap(r => r.path.coords)), { padding: [40, 40] });
};

/* --- 시간 이동 --- */
$('btnSim').onclick = () => {
  const bar = $('simbar'), showing = bar.classList.toggle('show');
  $('btnSim').classList.toggle('on', showing);
  if (showing) {
    const t = Math.round(nowMin());
    $('simRange').value = Math.min(1140, Math.max(420, t));
    setSim(+$('simRange').value);
  } else {
    simMinutes = null; render();
  }
};
function setSim(m) { simMinutes = m; $('simLabel').textContent = fmt(m); render(); }
$('simRange').oninput = e => setSim(+e.target.value);
$('simReset').onclick = () => { simMinutes = null; $('simbar').classList.remove('show'); $('btnSim').classList.remove('on'); render(); };

/* --- 좌표 보정 --- */
let editMode = false;
$('btnEdit').onclick = () => {
  editMode = !editMode;
  $('btnEdit').classList.toggle('on', editMode);
  $('editbar').classList.toggle('show', editMode);
  drawStops();
};
$('btnCopy').onclick = async () => {
  const txt = JSON.stringify(STOPS, null, 2);
  try { await navigator.clipboard.writeText(txt); alert('보정된 좌표를 클립보드에 복사했습니다.\nstops.py 의 STOPS 에 반영하세요.'); }
  catch (e) { prompt('아래 좌표를 복사하세요', txt); }
};
$('btnResetCoords').onclick = () => {
  if (!confirm('보정한 좌표를 모두 버리고 기본값으로 되돌릴까요?')) return;
  try { localStorage.removeItem(LS_COORDS); } catch (e) {}
  STOPS = Object.assign({}, DATA.stops);
  STOP_LIST.forEach(s => s.ll = STOPS[s.name]);
  drawStops(); render();
};


/* ================================================================== *
 * 길찾기
 * ================================================================== */
/* ---------- 보행 그래프 어댑터 ---------- *
 * 정류장은 그래프 노드에 한 번만 스냅해 두고, 정류장 간 도보는
 * 정류장 수(17)만큼의 Dijkstra로 미리 채워 둔다.
 */
const WALK_MPM = 75;                       // 도보 4.5km/h
const toMinutes = m => m < 40 ? 0 : Math.max(1, Math.round(m / WALK_MPM));

const walkNet = (() => {
  const snaps = STOP_LIST.map(s => WalkGraph.snap(s.ll));
  let matrix = null;                        // 정류장 × 정류장 (지연 계산)

  const leg = (res, node, offset) => {
    if (!res || node < 0 || !isFinite(res.dist[node])) return null;
    const tr = WalkGraph.trace(res.prev, node);
    const m = tr.meters + res.offset + offset;
    return { min: toMinutes(m), m, coords: tr.coords };
  };

  function fromPoint(ll) {
    const res = WalkGraph.from(ll);
    if (!res) return STOP_LIST.map(() => null);
    return snaps.map(s => leg(res, s.node, s.offset));
  }
  function between(i, j) {
    if (!matrix) {
      matrix = snaps.map(a => {
        const res = WalkGraph.from([WalkGraph.lat[a.node], WalkGraph.lng[a.node]]);
        return snaps.map(b => leg(res, b.node, a.offset + b.offset));
      });
    }
    return matrix[i][j];
  }
  function direct(a, b) {
    const res = WalkGraph.from(a);
    const s = WalkGraph.snap(b);
    return leg(res, s.node, s.offset);
  }
  return { fromPoint, between, direct };
})();


const POIS = DATA.pois || [];
/* 검색 대상: 정류장 + 캠퍼스 건물 */
const PLACES = [
  ...STOP_LIST.map(s => ({ name: s.name, ll: s.ll, kind: 'stop' })),
  ...POIS.map(p => ({ name: p.n, ll: p.ll, kind: p.k })),
];
const KIND_LABEL = {
  stop: '정류장', university: '건물', dormitory: '기숙사', library: '도서관',
  cafe: '카페', restaurant: '식당', fast_food: '식당', convenience: '편의점',
  supermarket: '마트', fitness_centre: '체육', sports_centre: '체육',
  school: '건물', commercial: '건물', bank: '은행', public: '건물',
  clinic: '의원', pharmacy: '약국', books: '서점',
};

let tripFrom = null, tripTo = null, tripPlans = [], activeField = null;
const layerTrip = L.layerGroup().addTo(map);

function openTrip(on) {
  const show = on ?? !$('trip').classList.contains('show');
  $('trip').classList.toggle('show', show);
  $('btnRoute').classList.toggle('on', show);
  if (!show) { tripFrom = tripTo = null; tripPlans = []; layerTrip.clearLayers(); $('suggest').innerHTML = ''; }
  render();
}
$('btnRoute').onclick = () => openTrip();
$('btnCloseTrip').onclick = () => openTrip(false);

function search(q, near) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return PLACES
    .map(p => ({ ...p, d: near ? dist(near, p.ll) : null }))
    .filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => (a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
                 || (a.kind === 'stop' ? -1 : 1)
                 || (a.d ?? 0) - (b.d ?? 0))
    .slice(0, 8);
}

function drawSuggest(list) {
  $('suggest').innerHTML = list.map((p, i) => `
    <div class="sug" data-i="${i}">
      <span class="kind ${p.kind === 'stop' ? 'stop' : ''}">${KIND_LABEL[p.kind] || '장소'}</span>
      <span>${p.name}</span>
      ${p.d != null ? `<span class="d">${humanDist(p.d)}</span>` : ''}
    </div>`).join('');
  $('suggest').querySelectorAll('.sug').forEach(el => el.onclick = () => {
    const p = list[+el.dataset.i];
    if (activeField === 'from') { tripFrom = { ll: p.ll, label: p.name }; $('inFrom').value = p.name; }
    else                        { tripTo   = { ll: p.ll, label: p.name }; $('inTo').value   = p.name; }
    $('suggest').innerHTML = '';
    runTrip();
  });
}

for (const [id, field] of [['inFrom', 'from'], ['inTo', 'to']]) {
  $(id).addEventListener('input', e => { activeField = field; drawSuggest(search(e.target.value, myLL)); });
  $(id).addEventListener('focus', e => { activeField = field; if (e.target.value) drawSuggest(search(e.target.value, myLL)); });
}
$('btnHere').onclick = () => {
  if (!myLL) { startLocate(); alert('위치 권한을 허용하면 출발지에 내 위치가 들어갑니다.'); return; }
  tripFrom = { ll: myLL, label: '내 위치' };
  $('inFrom').value = '내 위치';
  runTrip();
};
$('btnSwap').onclick = () => {
  [tripFrom, tripTo] = [tripTo, tripFrom];
  $('inFrom').value = tripFrom?.label || '';
  $('inTo').value = tripTo?.label || '';
  runTrip();
};

function runTrip() {
  if (!tripFrom || !tripTo) { tripPlans = []; layerTrip.clearLayers(); render(); return; }
  const t = nowMin();
  $('tripWhen').textContent = `${fmt(t)} 출발 기준`;
  tripPlans = planTrip(tripFrom, tripTo, t, { ROUTES, STOP_LIST, isOn, walk: walkNet });
  drawPlan(tripPlans[0]);
  render();
}

/* --- 선택한 경로를 지도에 그린다 --- */
function drawPlan(plan) {
  layerTrip.clearLayers();
  if (!plan) return;
  const pts = [];
  for (const leg of plan.legs) {
    if (leg.kind === 'walk') {
      const a = leg.from === tripFrom.label ? tripFrom.ll : STOPS[canon(leg.from)];
      const b = leg.to === tripTo.label ? tripTo.ll : STOPS[canon(leg.to)];
      const line = leg.coords?.length > 1 ? [a, ...leg.coords, b] : [a, b];
      L.polyline(line, { color: '#5c6470', weight: 4.5, opacity: .9, dashArray: '1 9', lineCap: 'round' }).addTo(layerTrip);
      pts.push(...line);
    } else {
      const p = leg.route.path;
      const seg = p.coords.slice(p.idx[leg.fromIdx], p.idx[leg.toIdx] + 1);
      L.polyline(seg, { color: '#fff', weight: 11, opacity: .9, lineCap: 'round' }).addTo(layerTrip);
      L.polyline(seg, { color: leg.route.color, weight: 6.5, opacity: 1, lineCap: 'round' }).addTo(layerTrip);
      pts.push(...seg);
    }
  }
  for (const [pt, cls] of [[tripFrom.ll, 'from'], [tripTo.ll, 'to']]) {
    L.marker(pt, {
      icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        html: `<div class="trip-pin ${cls}"></div>` }), zIndexOffset: 600,
    }).addTo(layerTrip);
  }
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 17, animate: false });
}

function planCard(plan, i) {
  const dur = Math.round(plan.arrive - plan.depart);
  const rides = plan.legs.filter(l => l.kind === 'ride');
  const legs = plan.legs.map(l => l.kind === 'walk'
    ? `<div class="leg">
         <span class="ic">보행</span>
         <span class="txt"><b>${l.to}</b>까지 도보 ${l.min}분
           <span class="sub">${Math.round(l.m)}m · ${fmt(l.depart)} → ${fmt(l.arrive)}</span></span>
       </div>`
    : `<div class="leg">
         <span class="ic" style="background:${l.route.color}">${l.route.number}</span>
         <span class="txt"><b>${l.from}</b>에서 승차 → <b>${l.to}</b> 하차
           <span class="sub">${l.route.name} · ${fmt(l.depart)} 출발${l.wait >= 1 ? ` (${Math.round(l.wait)}분 대기)` : ''} · ${l.stops}정거장 · ${fmt(l.arrive)} 도착</span></span>
       </div>`).join('');
  const tag = plan.walkOnly ? '도보만' : (rides.length > 1 ? `환승 ${rides.length - 1}회` : '환승 없음');
  return `
    <div class="itin ${i === 0 ? 'best' : ''}" data-plan="${i}">
      <div class="itin-head">
        <span class="itin-dur">${dur}분</span>
        <span class="itin-time">${fmt(plan.depart)} → ${fmt(plan.arrive)}</span>
        <span class="itin-tag">${tag}</span>
      </div>
      ${legs}
    </div>`;
}

/* ---------- 시작 ---------- */
drawFilters();
drawRoutes();
drawStops();
render();
setInterval(() => { if (simMinutes === null) render(); }, 1000);

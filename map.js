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
  { id: 'route1', ko: '순환 1', en: 'Loop 1',  color: '#2674d9', match: r => r.id === 'route1' },
  { id: 'route2', ko: '순환 2', en: 'Loop 2',  color: '#e0632a', match: r => r.id === 'route2' },
  { id: 'route3', ko: '순환 3', en: 'Loop 3',  color: '#2f9e6e', match: r => r.id === 'route3' },
  { id: 'jigok',  ko: '지곡',   en: 'Jigok',   color: '#DAB765', match: r => r.id.startsWith('jigok:') },
  { id: 'yugang', ko: '유강',   en: 'Yugang',  color: '#A61955', match: r => r.id.startsWith('yugang:') },
];
const groupLabel = id => { const g = GROUPS.find(x => x.id === id); return g ? g[LANG] || g.ko : id; };
const groupOf = r => GROUPS.find(g => g.match(r));
ROUTES.forEach(r => { const g = groupOf(r); r.color = g.color; r.group = g.id; });
/* 배지 글자. 순환은 번호로 충분하지만 확장노선은 한 글자로는 알 수 없다. */
const BADGE = {
  jigok:  { ko: '지곡', en: 'Jigok' },
  yugang: { ko: '유강', en: 'Yugang' },
};
const badge = r => BADGE[r.group]?.[LANG] || r.number;

/* 노선 표시는 한 번에 하나만. 다섯 노선이 캠퍼스 중앙 도로를 공유해서
   동시에 색으로 그리면 무지개 리본이 된다. 기본값은 '전체'로, 이때는
   길 모양만 회색으로 보여 주고 색은 정류장·버스에만 쓴다. */
let focusGroup = null;                 // null = 전체
const isOn = r => focusGroup === null || r.group === focusGroup;

/* 마커를 세울 고유 정류장 목록 */
const STOP_LIST = [...new Set(ROUTES.flatMap(r => r.canonStops))]
  .filter(n => STOPS[n]).map(n => ({ name: n, ll: STOPS[n] }));

/* "지곡회관"과 "지곡회관 건너"는 같은 장소의 양방향이고 18m 남짓 떨어져 있다.
   낮은 배율에서는 1px 도 안 되니 한 마커로 합치고, 확대하면 갈라 놓는다. */
const SPLIT_ZOOM = 17;
const baseName = n => n.replace(/\s*건너$/, '');
const STOP_GROUPS = (() => {
  const by = new Map();
  for (const s of STOP_LIST) {
    const b = baseName(s.name);
    (by.get(b) || by.set(b, []).get(b)).push(s);
  }
  return [...by].map(([name, members]) => ({
    name, members,
    ll: [members.reduce((a, m) => a + m.ll[0], 0) / members.length,
         members.reduce((a, m) => a + m.ll[1], 0) / members.length],
  }));
})();
/* 지금 배율에서 지도에 세울 지점들 */
const mapStops = () => map.getZoom() >= SPLIT_ZOOM
  ? STOP_LIST.map(s => ({ name: s.name, ll: s.ll, members: [s] }))
  : STOP_GROUPS;

/* ---------- 도착 예정 계산 ---------- */
/**
 * 해당 정류장에 다음으로 오는 버스들. 같은 노선은 가장 빠른 것만.
 * @returns [{route, eta(분), at(분), after(분|null)}]
 */
function groupOfStop(name) {
  return STOP_GROUPS.find(g => g.name === name)
      || STOP_GROUPS.find(g => g.members.some(m => m.name === name));
}

/** 한 지점(양방향 포함)의 다음 버스들. 방향이 둘이면 어느 쪽인지 표시한다. */
function arrivalsForGroup(name, t) {
  const g = groupOfStop(name);
  if (!g) return arrivalsAt(name, t).map(a => ({ ...a, side: '' }));
  const both = g.members.length > 1;
  return g.members
    .flatMap(m => arrivalsAt(m.name, t)
      .map(a => ({ ...a, side: both && m.name !== g.name ? '건너' : '' })))
    .sort((a, b) => a.eta - b.eta);
}

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
/* 바탕 지도 — 벡터 스타일을 직접 손봐서 쓴다.
   래스터에 흑백 필터를 씌우면 도로 위계와 라벨까지 함께 뭉개져서,
   바탕이 물러나는 게 아니라 그냥 흐려지기만 한다. 벡터라면 땅과 건물은
   물리고 길과 이름만 남길 수 있다. (스타일은 basemap.py 가 만든다) */
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';
const VECTOR_ATTR = OSM_ATTR + ' · <a href="https://openfreemap.org">OpenFreeMap</a>';
const BASE_STYLES = [
  { id: 'muted',  key: 'baseMuted',  icon: '◻',
    style: () => LANG === 'en' ? './style-muted-en.json' : './style-muted.json', attr: VECTOR_ATTR },
  { id: 'detail', key: 'baseDetail', icon: '▦',
    style: () => 'https://tiles.openfreemap.org/styles/liberty', attr: VECTOR_ATTR },
];
const LS_BASE = 'postech-shuttle-basemap';
let baseIdx = Math.max(0, BASE_STYLES.findIndex(b => {
  try { return b.id === localStorage.getItem(LS_BASE); } catch (e) { return false; }
}));
let baseLayer = null;

/* WebGL 이 없으면 래스터로 물러난다.
   maplibregl.supported() 는 v3 에서 없어졌으므로 직접 확인한다. */
const canVector = (() => {
  let ok = null;
  return () => {
    if (ok !== null) return ok;
    try {
      if (typeof maplibregl === 'undefined' || typeof L.maplibreGL !== 'function') return (ok = false);
      const c = document.createElement('canvas');
      ok = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { ok = false; }
    return ok;
  };
})();

function setBasemap(i) {
  baseIdx = ((i % BASE_STYLES.length) + BASE_STYLES.length) % BASE_STYLES.length;
  const b = BASE_STYLES[baseIdx];
  if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  baseLayer = canVector()
    ? L.maplibreGL({ style: b.style(), attribution: b.attr })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  { maxZoom: 19, attribution: OSM_ATTR, className: 'raster-fallback' });
  baseLayer.addTo(map);
  if (baseLayer.bringToBack) baseLayer.bringToBack();
  try { localStorage.setItem(LS_BASE, b.id); } catch (e) {}
  const btn = document.getElementById('btnBase');
  if (btn) { btn.textContent = b.icon; btn.title = T[b.key]; }
}
setBasemap(baseIdx);

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
    if (seen.has(r.path)) continue;             // 같은 경로는 한 번만
    seen.add(r.path);
    lines.push(r);
  }
  // 안내 중인 경로가 있으면 배경 노선은 방향만 알아볼 정도로 죽인다
  const faded = typeof tripPlans !== 'undefined' && tripPlans.length > 0;

  if (faded || focusGroup === null) {
    for (const r of lines) {
      L.polyline(r.path.coords, {
        color: faded ? '#B9BFC8' : '#9AA2AE', weight: faded ? 2.5 : 3.5,
        opacity: faded ? .55 : .5, lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(layerRoutes);
    }
    return;
  }

  // 고른 노선만 색으로. 같은 그룹 안의 여러 경로는 화면상 나란히 어긋나게 그린다.
  const mine = lines.filter(r => r.group === focusGroup);
  for (const r of lines) {
    if (r.group === focusGroup) continue;
    L.polyline(r.path.coords, {
      color: '#C6CBD3', weight: 2.5, opacity: .45,
      lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(layerRoutes);
  }
  const mid = (mine.length - 1) / 2;
  const shifted = mine.map((r, i) => ({ r, line: offsetLine(r.path.coords, (i - mid) * LANE_PX) }));
  for (const { line } of shifted) {
    L.polyline(line, { color: '#fff', weight: 9, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layerRoutes);
  }
  for (const { r, line } of shifted) {
    L.polyline(line, { color: r.color, weight: 5, opacity: .95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layerRoutes);
  }
}
map.on('zoomend', drawRoutes);

/* --- 정류장 마커 --- */
let selected = null;
const stopMarkers = new Map();
function drawStops() {
  layerStops.clearLayers(); stopMarkers.clear();
  const focusing = guiding() && $('trip').classList.contains('done');
  const onTrip = focusing
    ? new Set(tripPlans[0].legs.flatMap(l => [canon(l.from), canon(l.to)]))
    : null;
  // 노선을 하나 고른 상태면 그 노선이 서는 정류장만 남긴다
  const served = focusGroup
    ? new Set(ROUTES.filter(r => r.group === focusGroup).flatMap(r => r.canonStops))
    : null;
  const ringColor = focusGroup ? GROUPS.find(g => g.id === focusGroup).color : null;

  for (const s of mapStops()) {
    if (onTrip && !s.members.some(m => onTrip.has(m.name))) continue;
    if (served && !s.members.some(m => served.has(m.name))) continue;
    const m = L.marker(s.ll, {
      icon: L.divIcon({
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<div class="stop-marker"${ringColor ? ` style="border-color:${ringColor}"` : ''}></div>` +
              `<div class="stop-label">${stopLabel(s.name)}</div>`
      }),
      draggable: editMode && s.members.length === 1,
      zIndexOffset: 100,
    }).addTo(layerStops);
    m.on('click', () => { selectStop(s.name); pointActions(s.ll, stopLabel(s.name)); });
    m.bindTooltip(stopLabel(s.name), { direction: 'right', offset: [10, 0] });
    m.on('dragend', e => {
      const only = s.members[0];
      const ll = e.target.getLatLng();
      STOPS[only.name] = only.ll = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)];
      for (const [alias, target] of Object.entries(CANON)) if (target === only.name) STOPS[alias] = STOPS[only.name];
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
map.on('zoomend', () => { drawStops(); paintLabels(); });

/* --- 버스 마커 --- */
const busMarkers = new Map();
function drawBuses(t) {
  const routeIds = guiding()
    ? new Set(tripPlans[0].legs.filter(l => l.kind === 'ride').map(l => l.route.id))
    : null;
  const live = activeBuses(t).filter(b => !routeIds || routeIds.has(b.route.id));
  const keep = new Set();
  for (const b of live) {
    keep.add(b.key);
    let m = busMarkers.get(b.key);
    const label = badge(b.route);
    if (!m) {
      m = L.marker(b.ll, {
        icon: L.divIcon({
          className: 'bus-icon', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="bus" style="background:${b.route.color}">${label}</div>`
        }),
        zIndexOffset: 400,
      }).addTo(layerBuses);
      busMarkers.set(b.key, m);
    } else {
      m.setLatLng(b.ll);
    }
    m.bindTooltip(
      `<b>${routeLabel(b.route)}</b><br>${stopLabel(b.to)} · ${fmt(b.arriveAt)}`,
      { direction: 'top', offset: [0, -12] }
    );
  }
  for (const [k, m] of busMarkers) if (!keep.has(k)) { layerBuses.removeLayer(m); busMarkers.delete(k); }
  return live.length;
}

/* --- 내 위치 --- */
let myLL = null, myMarker = null, myCircle = null, watchId = null, followMe = false;
let geoError = null;                         // 실패 사유를 패널에 안내한다

/* 브라우저 권한 상태 — 알 수 없으면 null */
async function geoPermission() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch (e) { return null; }
}

/* 거부된 뒤에는 JS 로 프롬프트를 다시 띄울 수 없다. 기기별 복구 경로를 알려 준다. */
function recoverySteps() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return ['주소창 왼쪽 <b>ᴀA</b> → 웹사이트 설정 → 위치 → 허용',
            '설정 앱 → 개인정보 보호 → 위치 서비스 → Safari 확인'];
  }
  if (/Android/.test(ua)) {
    return ['주소창 왼쪽 <b>자물쇠</b> → 권한 → 위치 → 허용',
            '기기 설정 → 위치 켜기'];
  }
  return ['주소창 <b>자물쇠</b> → 위치 → 허용으로 바꾸고 새로고침',
          '기기의 위치 서비스가 켜져 있는지 확인'];
}

/* 권한을 요청하기 전에 왜 필요한지 먼저 보여 준다 */
function askLocation() {
  const el = $('ask');
  $('askTitle').textContent = T.askTitle;
  $('askBody').textContent = T.askBody;
  $('askYes').textContent = T.askYes;
  $('askYes').onclick = () => { el.hidden = true; startLocate(); };
  el.hidden = false;
}

/* 이미 거부된 상태 — 복구 경로만 보여 준다 */
function showRecovery() {
  const el = $('ask');
  $('askTitle').textContent = T.denyTitle;
  $('askBody').innerHTML = '<ol class="ask-steps">' +
    recoverySteps().map(t => `<li>${t}</li>`).join('') + '</ol>';
  $('askYes').textContent = T.askRetry;
  $('askYes').onclick = () => { el.hidden = true; startLocate(); };
  el.hidden = false;
}

/* ◎ 버튼의 진입점 */
async function requestLocation() {
  if (myLL) { followMe = true; $('btnLoc').classList.add('on'); map.setView(myLL, 16); return; }
  const state = await geoPermission();
  if (state === 'granted') startLocate();
  else if (state === 'denied') showRecovery();
  else askLocation();
}

function startLocate() {
  if (!navigator.geolocation) {
    geoError = { title: '이 브라우저에서는 위치 기능을 쓸 수 없습니다.', how: null };
    render(); return;
  }
  if (!window.isSecureContext) {
    geoError = {
      title: '보안 연결에서만 위치를 쓸 수 있습니다.',
      how: 'https:// 주소로 열어 주세요.',
    };
    render(); return;
  }
  followMe = true;
  geoError = null;
  $('btnLoc').classList.add('on');
  if (watchId !== null) { if (myLL) map.setView(myLL, 16); return; }

  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    myLL = [latitude, longitude];
    geoError = null;
    if (!myMarker) {
      myMarker = L.marker(myLL, {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="me"></div>' }),
        zIndexOffset: 500, interactive: false,
      }).addTo(map);
      myCircle = L.circle(myLL, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
      map.setView(offsetForSheet(myLL), 16);
    } else {
      myMarker.setLatLng(myLL); myCircle.setLatLng(myLL).setRadius(accuracy);
      if (followMe) map.setView(myLL, map.getZoom());
    }
    if ($('trip').classList.contains('show') && !tripFrom) {
      tripFrom = { ll: myLL, label: T.here };
      $('inFrom').value = T.here;
      runTrip();
    }
    render();
  }, err => {
    followMe = false;
    watchId = null;
    $('btnLoc').classList.remove('on');
    geoError = explainGeoError(err);
    if (err.code === 1) showRecovery();
    render();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

/** 위치 실패 사유를 사용자가 할 수 있는 행동으로 옮겨 준다 */
function explainGeoError(err) {
  if (err.code === 1) {          // PERMISSION_DENIED
    return {
      title: '위치 권한이 거부되었습니다.',
      how: '주소창의 자물쇠(또는 ⓘ) → 위치 → 허용으로 바꾼 뒤 다시 눌러 주세요. ' +
           '기기 설정에서 위치 서비스가 꺼져 있어도 같은 메시지가 나옵니다.',
    };
  }
  if (err.code === 2) {          // POSITION_UNAVAILABLE
    return {
      title: '현재 위치를 확인할 수 없습니다.',
      how: '실내라 GPS 신호가 약하거나, 데스크톱 브라우저의 측위 서비스가 막혀 있을 수 있습니다. ' +
           '휴대폰에서 열면 대개 잘 잡힙니다.',
    };
  }
  if (err.code === 3) {          // TIMEOUT
    return { title: '위치를 가져오는 데 시간이 너무 오래 걸립니다.', how: '잠시 후 다시 시도해 주세요.' };
  }
  return { title: '위치를 가져오지 못했습니다.', how: err.message || null };
}

map.on('dragstart', () => { followMe = false; document.getElementById('btnLoc').classList.remove('on'); });

function selectStop(name) {
  selected = selected === name ? null : name;
  paintSelection();
  if (selected) {
    sheet.raise(1);
    map.panTo(offsetForSheet(groupOfStop(selected)?.ll || STOPS[selected]));
  }
  render();
}

/* 시트에 가리는 만큼 지도 중심을 위로 올린 좌표 */
const sheetHeight = () => (typeof sheet === 'undefined' ? 0 : sheet.height());
function offsetForSheet(ll) {
  const h = sheetHeight();
  if (!h) return ll;
  const p = map.latLngToContainerPoint(L.latLng(ll));
  return map.containerPointToLatLng(L.point(p.x, p.y + h / 2));
}

/* ================================================================== *
 * 패널
 * ================================================================== */
const $ = id => document.getElementById(id);
/* 길찾기 결과를 안내하는 중인가 — 이때는 관계없는 정보를 감춘다 */
const guiding = () => typeof tripPlans !== 'undefined' && tripPlans.length > 0;

function drawFilters() {
  const chips = [{ id: '', color: '#5C6470' }, ...GROUPS];
  $('filters').innerHTML = chips.map(g => {
    const on = (g.id || null) === focusGroup;
    const label = g.id ? groupLabel(g.id) : T.all;
    return `<button class="chip ${on ? 'on' : ''}" data-g="${g.id}"
              style="${on ? `background:${g.color}` : `color:${g.color}`}">${label}</button>`;
  }).join('');
  $('filters').querySelectorAll('.chip').forEach(el => el.onclick = () => {
    const g = el.dataset.g || null;
    focusGroup = focusGroup === g ? null : g;   // 같은 칩을 다시 누르면 전체로
    drawFilters(); drawRoutes(); drawStops(); render();
  });
}

const FAR_MIN = 90;                  // 이보다 멀면 남은 시간 대신 시각만
function etaText(eta) {
  if (eta < 0.5) return T.due;
  return T.min(Math.max(1, Math.round(eta)));
}

function stopCard(name, t, walk) {
  const arr = arrivalsForGroup(name, t);
  const rows = arr.length ? arr.slice(0, 3).map(a => `
    <div class="arr">
      <span class="badge" style="background:${a.route.color}">${badge(a.route)}</span>
      ${a.eta >= FAR_MIN
        ? `<span class="arr-eta far">${fmt(a.at)}</span>`
        : `<span class="arr-eta ${a.eta <= 3 ? 'soon' : ''}">${etaText(a.eta)}</span>`}
      ${a.side ? `<span class="side">${T.across}</span>` : ''}
      ${a.eta >= FAR_MIN ? '' : `<span class="arr-at">${fmt(a.at)}</span>`}
      ${a.after !== null && a.eta < FAR_MIN ? `<span class="arr-next">${T.next(fmt(a.after))}</span>` : ''}
    </div>`).join('')
    : `<div class="empty">${T.noService}</div>`;
  return `
    <div class="stop ${selected === name ? 'active' : ''}" data-stop="${name}">
      <div class="stop-head">
        <span class="stop-name">${stopLabel(name)}</span>
        ${walk ? `<span class="stop-dist">${T.dist(humanDist(walk.m), walk.min)}</span>` : ''}
      </div>
      <div class="arrivals">${rows}</div>
    </div>`;
}

function render() {
  const t = nowMin();
  $('filters').hidden = guiding();     // 안내 중에는 노선 필터가 필요 없다
  const running = drawBuses(t);

  $('clock').textContent = fmt(t);
  $('clock').classList.toggle('sim', simMinutes !== null);

  let html = '';

  if ($('trip').classList.contains('show')) {
    if (tripPlans.length) {
      html += `<div class="sec-title">${T.suggested}</div>`;
      html += tripPlans.map(planCard).join('');
      $('panelScroll').innerHTML = html;
      $('panelScroll').querySelectorAll('.itin').forEach(el => el.onclick = () => {
        $('panelScroll').querySelectorAll('.itin').forEach(x => x.classList.remove('best'));
        el.classList.add('best');
        drawPlan(tripPlans[+el.dataset.plan]);
      });
      return;
    }
    if (tripFrom && tripTo) {
      $('panelScroll').innerHTML = `<div class="notice warn">${T.noRoute}</div>`;
      return;
    }
    html += '';   // 입력칸 두 개가 곧 설명이다
  }

  const served = focusGroup
    ? new Set(ROUTES.filter(r => r.group === focusGroup).flatMap(r => r.canonStops))
    : null;
  // 실제 보행 경로로 잰 거리·시간 (경사 반영). 스냅된 출발점 기준이라 결과가 캐시된다.
  const walks = myLL ? walkNet.fromPoint(myLL) : null;
  const idxOfStop = new Map(STOP_LIST.map((s, i) => [s.name, i]));
  const walkTo = g => {
    if (!walks) return null;
    return g.members
      .map(m => walks[idxOfStop.get(m.name)])
      .filter(Boolean)
      .sort((a, b) => a.min - b.min)[0] || null;
  };

  if (selected) {
    const g = groupOfStop(selected);
    html += `<div class="sec-title">${T.selected}</div>`
          + stopCard(selected, t, g ? walkTo(g) : null);
  }

  const near = STOP_GROUPS
    .filter(g => !served || g.members.some(m => served.has(m.name)))
    .map(g => ({ ...g, w: walkTo(g) }))
    .filter(g => g.name !== selected);

  if (focusGroup) {
    // 노선을 고르면 정류장을 운행 순서대로 세운다 — 목록이 곧 노선도가 된다
    const seq = [];
    for (const r of ROUTES) {
      if (r.group !== focusGroup) continue;
      for (const n of r.canonStops) if (!seq.includes(baseName(n))) seq.push(baseName(n));
    }
    near.sort((a, b) => seq.indexOf(a.name) - seq.indexOf(b.name));
    html += `<div class="sec-title">${T.routeOrder(groupLabel(focusGroup))}</div>`;
    html += near.map(s => stopCard(s.name, t, s.w)).join('');
  } else if (walks) {
    near.sort((a, b) => (a.w?.min ?? 1e9) - (b.w?.min ?? 1e9));
    html += `<div class="sec-title">${T.nearby}</div>`;
    html += near.slice(0, 6).map(s => stopCard(s.name, t, s.w)).join('');
  } else {
    near.sort((a, b) => {
      const ea = arrivalsForGroup(a.name, t)[0]?.eta ?? 1e9;
      const eb = arrivalsForGroup(b.name, t)[0]?.eta ?? 1e9;
      return ea - eb;
    });
    html += `<div class="sec-title">${T.comingSoon}</div>`;
    html += near.slice(0, 6).map(s => stopCard(s.name, t, null)).join('');
  }

  if (running === 0) {
    html += `<div class="notice warn">${T.notRunning}</div>`;
  }

  html += `<div class="panel-links">
    <a href="./timetable.html">${T.allTimetable}</a>
    <span class="lang" role="group" aria-label="Language">
      <button id="langKo" class="${LANG === 'ko' ? 'on' : ''}">한국어</button
      ><button id="langEn" class="${LANG === 'en' ? 'on' : ''}">English</button>
    </span>
  </div>`;

  $('panelScroll').innerHTML = html;
  $('panelScroll').querySelectorAll('.stop').forEach(el =>
    el.onclick = () => selectStop(el.dataset.stop));
  bindLangButtons();

}

/* ================================================================== *
 * 조작
 * ================================================================== */
$('btnLoc').onclick = requestLocation;
$('btnFit').onclick = () => {
  const on = ROUTES.filter(isOn);
  fitWithSheet(L.latLngBounds(on.flatMap(r => r.path.coords)));
};

/* --- 좌표 보정 --- */
let editMode = false;
function toggleEdit() {
  editMode = !editMode;
  $('btnEdit').classList.toggle('on', editMode);
  $('editbar').classList.toggle('show', editMode);
  if (editMode) {
    sheet.goto(0);
    if (map.getZoom() < SPLIT_ZOOM) map.setZoom(SPLIT_ZOOM);   // 갈라야 각각 끌 수 있다
  }
  drawStops();
}
$('btnEdit').onclick = toggleEdit;
$('btnBase').onclick = () => setBasemap(baseIdx + 1);
$('askNo').onclick = () => { $('ask').hidden = true; };
$('btnCopy').onclick = async () => {
  const txt = JSON.stringify(STOPS, null, 2);
  try { await navigator.clipboard.writeText(txt); alert(T.copied); }
  catch (e) { prompt('아래 좌표를 복사하세요', txt); }
};
$('btnResetCoords').onclick = () => {
  if (!confirm(T.confirmReset)) return;
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
const WALK_MPM = 75;                       // 평지 4.5km/h — 그래프 밖 접근거리에만 쓴다

const walkNet = (() => {
  const snaps = STOP_LIST.map(s => WalkGraph.snap(s.ll));
  let matrix = null;                        // 정류장 × 정류장 (지연 계산)

  const leg = (res, node, offset) => {
    if (!res || node < 0 || !isFinite(res.dist[node])) return null;
    const tr = WalkGraph.trace(res.prev, node);
    const extra = res.offset + offset;                 // 그래프까지의 직선 접근거리
    const m = tr.meters + extra;
    const minutes = res.dist[node] + extra / WALK_MPM;
    return {
      min: m < 40 ? 0 : Math.max(1, Math.round(minutes)),
      m, ascent: Math.round(tr.ascent), coords: tr.coords,
    };
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
/* 검색 대상. name 은 검색용(한글/영문 모두), label 은 화면 표시용 */
const places = () => [
  ...STOP_LIST.map(s => ({ name: s.name, en: stopLabel(s.name), ll: s.ll, kind: 'stop' })),
  ...POIS.map(p => ({ name: p.n, en: p.en || '', ll: p.ll, kind: p.k })),
].map(p => ({ ...p, label: LANG === 'en' && p.en ? p.en : p.name }));

let tripFrom = null, tripTo = null, tripPlans = [], activeField = null;

/* 최근 목적지 — 캠퍼스 이동은 반복이 심해서 이것만으로 대부분 타이핑이 사라진다 */
const LS_RECENT = 'postech-shuttle-recent';
const MAX_RECENT = 6;
let recents = [];
try { recents = JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); } catch (e) {}
function remember(place) {
  if (!place || place.label === T.here || place.label === T.mapPoint) return;
  recents = [{ name: place.label, ll: place.ll },
             ...recents.filter(r => r.name !== place.label)].slice(0, MAX_RECENT);
  try { localStorage.setItem(LS_RECENT, JSON.stringify(recents)); } catch (e) {}
}
const layerTrip = L.layerGroup().addTo(map);

const wideScreen = () => window.matchMedia('(min-width:821px)').matches;

function openTrip(on, suggest = true) {
  // 데스크톱 사이드바에서는 길찾기를 닫지 않는다
  const show = wideScreen() ? true : (on ?? !$('trip').classList.contains('show'));
  $('trip').classList.toggle('show', show);
  $('btnRoute').classList.toggle('on', show);
  sheet.goto(show ? 2 : 1);
  if (!show || on === false) {
    tripFrom = tripTo = null; tripPlans = []; layerTrip.clearLayers();
    $('suggest').innerHTML = ''; $('inFrom').value = $('inTo').value = '';
    collapseForm(false); simMinutes = null; whenLabel(); drawRoutes(); drawStops();
  } else {
    // 출발지는 대개 내 위치다. 이미 알고 있으면 채워 두고 커서를 도착지로 보낸다.
    if (myLL && !tripFrom) { tripFrom = { ll: myLL, label: T.here }; $('inFrom').value = T.here; }
    activeField = tripFrom ? 'to' : 'from';
    if (suggest) { $(tripFrom ? 'inTo' : 'inFrom').focus(); drawSuggest(search('', myLL)); }
  }
  render();
}
$('btnRoute').onclick = () => openTrip();


function search(q, near) {
  q = q.trim().toLowerCase();
  if (!q) return emptyState(near);
  // 한글·영문 어느 쪽으로 쳐도 찾히게 한다
  const hit = p => {
    const i = p.name.toLowerCase().indexOf(q);
    const j = (p.en || '').toLowerCase().indexOf(q);
    if (i < 0 && j < 0) return -1;
    return i < 0 ? j : (j < 0 ? i : Math.min(i, j));
  };
  return places()
    .map(p => ({ ...p, d: near ? dist(near, p.ll) : null, at: hit(p) }))
    .filter(p => p.at >= 0)
    .sort((a, b) => a.at - b.at || (a.kind === 'stop' ? -1 : 1) || (a.d ?? 0) - (b.d ?? 0))
    .slice(0, 8);
}

/* 아직 아무것도 입력하지 않았을 때 — 최근에 간 곳, 그다음 가까운 정류장 */
function emptyState(near) {
  const seen = new Set();
  const out = [];
  for (const r of recents) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ name: r.name, label: r.name, ll: r.ll, kind: 'recent',
               d: near ? dist(near, r.ll) : null });
  }
  const stops = STOP_LIST
    .filter(s => !seen.has(s.name))
    .map(s => ({ name: s.name, label: stopLabel(s.name), ll: s.ll, kind: 'stop',
                 d: near ? dist(near, s.ll) : null }));
  if (near) stops.sort((a, b) => a.d - b.d);
  return out.concat(stops).slice(0, 7);
}

function drawSuggest(list) {
  $('suggest').innerHTML = list.map((p, i) => `
    <div class="sug" data-i="${i}">
      <span class="sug-name">${p.label}</span>
      <span class="sug-kind">${T.kinds[p.kind] || T.kinds.place}</span>
      ${p.d != null ? `<span class="d">${humanDist(p.d)}</span>` : ''}
    </div>`).join('');
  $('suggest').querySelectorAll('.sug').forEach(el => el.onclick = () => {
    const p = list[+el.dataset.i];
    const picked = { ll: p.ll, label: p.label };
    if (activeField === 'from') { tripFrom = picked; $('inFrom').value = p.label; }
    else                        { tripTo   = picked; $('inTo').value   = p.label; remember(picked); }
    $('suggest').innerHTML = '';
    if (!tripTo) { $('inTo').focus(); return; }        // 출발지를 먼저 골랐다면 도착지로
    runTrip();
  });
}

for (const [id, field] of [['inFrom', 'from'], ['inTo', 'to']]) {
  $(id).addEventListener('input', e => { activeField = field; drawSuggest(search(e.target.value, myLL)); });
  $(id).addEventListener('focus', e => { activeField = field; drawSuggest(search(e.target.value, myLL)); });
  $(id).addEventListener('blur', () => setTimeout(() => {
    if (!$('trip').contains(document.activeElement)) $('suggest').innerHTML = '';
  }, 150));
}
$('btnHere').onclick = () => {
  if (!myLL) { requestLocation(); return; }   // 위치를 잡으면 watchPosition 에서 채운다
  tripFrom = { ll: myLL, label: T.here };
  $('inFrom').value = T.here;
  runTrip();
};
/* 출발 시각 — 기본은 지금. 눌러야 시각 입력이 나온다. */
function whenLabel() {
  $('btnWhen').textContent = simMinutes === null ? T.now : T.departAt(fmt(simMinutes));
}
$('btnWhen').onclick = () => {
  const el = $('whenTime');
  el.value = fmt(Math.round(nowMin()));
  el.hidden = false; $('btnWhen').hidden = true;
  el.focus(); el.showPicker?.();
};
$('whenTime').onchange = e => {
  simMinutes = e.target.value ? toMin(e.target.value) : null;
  e.target.hidden = true; $('btnWhen').hidden = false;
  whenLabel(); runTrip(); render();
};
$('whenTime').onblur = e => { e.target.hidden = true; $('btnWhen').hidden = false; };

$('btnSwap').onclick = () => {
  [tripFrom, tripTo] = [tripTo, tripFrom];
  $('inFrom').value = tripFrom?.label || '';
  $('inTo').value = tripTo?.label || '';
  if (tripFrom && tripTo) runTrip(); else { collapseForm(false); render(); }
};

function collapseForm(on) {
  $('trip').classList.toggle('done', on);
  $('tripSummary').hidden = !on;
  if (on) {
    $('tripSummary').innerHTML =
      `<b>${tripFrom.label}</b><span class="arrow">→</span><b>${tripTo.label}</b><span class="edit">${T.edit}</span>`;
  }
}
$('tripSummary').onclick = () => { collapseForm(false); drawStops(); $('inTo').focus(); };

/* --- 지도에서 출발·도착 지정 --- *
 * 정류장을 누르거나 지도를 길게 누르면 그 자리에서 출발·도착으로 삼는다.
 * 검색으로만 입력받으면 이름을 모르는 지점은 지정할 방법이 없다.
 */
function setEndpoint(which, place) {
  if (!$('trip').classList.contains('show')) openTrip(true);
  if (which === 'from') { tripFrom = place; $('inFrom').value = place.label; }
  else                  { tripTo = place;   $('inTo').value = place.label; remember(place); }
  map.closePopup();
  if (tripFrom && tripTo) runTrip();
  else { collapseForm(false); render(); }
}

function pointActions(ll, label) {
  const id = 'pa' + Math.random().toString(36).slice(2, 8);
  L.popup({ closeButton: false, className: 'pa-popup', offset: [0, -8] })
    .setLatLng(ll)
    .setContent(
      `<div class="pa"><div class="pa-name">${label}</div>
       <button data-w="from" id="${id}f">${T.startHere}</button>
       <button data-w="to" id="${id}t">${T.endHere}</button></div>`)
    .openOn(map);
  const place = { ll: [ll[0] ?? ll.lat, ll[1] ?? ll.lng], label };
  setTimeout(() => {
    document.getElementById(id + 'f')?.addEventListener('click', () => setEndpoint('from', place));
    document.getElementById(id + 't')?.addEventListener('click', () => setEndpoint('to', place));
  }, 0);
}

/* 지도 길게 누르기 (터치) 와 오른쪽 클릭 모두 contextmenu 로 들어온다 */
map.on('contextmenu', e => pointActions(e.latlng, T.mapPoint));

function runTrip() {
  if (!tripFrom || !tripTo) { tripPlans = []; collapseForm(false); layerTrip.clearLayers(); render(); return; }
  const t = nowMin();
  tripPlans = planTrip(tripFrom, tripTo, t, { ROUTES, STOP_LIST, isOn, walk: walkNet });
  // 시트를 먼저 낮춰야 지도에 맞출 때 가려지는 높이를 제대로 계산한다
  collapseForm(tripPlans.length > 0);
  if (tripPlans.length) sheet.goto(1);
  drawRoutes();
  drawStops();
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
  for (const leg of plan.legs) {
    if (leg.kind !== 'ride') continue;
    for (const [nm, cls] of [[leg.from, 'board'], [leg.to, 'alight']]) {
      const ll = STOPS[canon(nm)];
      if (!ll) continue;
      L.marker(ll, {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: `<div class="trip-stop ${cls}" style="border-color:${leg.route.color}"></div>` }),
        zIndexOffset: 550,
      }).addTo(layerTrip);
    }
  }
  for (const [pt, cls] of [[tripFrom.ll, 'from'], [tripTo.ll, 'to']]) {
    L.marker(pt, {
      icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        html: `<div class="trip-pin ${cls}"></div>` }), zIndexOffset: 600,
    }).addTo(layerTrip);
  }
  if (pts.length) fitWithSheet(L.latLngBounds(pts), 50);
}

function planCard(plan, i) {
  const dur = Math.round(plan.arrive - plan.depart);
  const rides = plan.legs.filter(l => l.kind === 'ride');
  const legs = plan.legs.map(l => l.kind === 'walk'
    ? `<div class="leg">
         <span class="ic walk"></span>
         <span class="txt">${T.walkTo(stopLabel(l.to), l.min)}
           <span class="sub">${T.walkSub(Math.round(l.m), l.ascent >= 10 ? l.ascent : 0)}</span></span>
       </div>`
    : `<div class="leg">
         <span class="ic" style="background:${l.route.color}">${badge(l.route)}</span>
         <span class="txt"><b>${stopLabel(l.from)}</b> ${fmt(l.depart)} → <b>${stopLabel(l.to)}</b> ${fmt(l.arrive)}
           <span class="sub">${T.rideSub(routeLabel(l.route), l.stops, l.wait >= 1 ? Math.round(l.wait) : 0)}</span></span>
       </div>`).join('');
  const tag = plan.walkOnly ? T.walkOnly : (rides.length > 1 ? T.transfers(rides.length - 1) : '');
  return `
    <div class="itin ${i === 0 ? 'best' : ''}" data-plan="${i}">
      <div class="itin-head">
        <span class="itin-dur">${T.min(dur)}</span>
        <span class="itin-time">${fmt(plan.depart)} → ${fmt(plan.arrive)}</span>
        ${tag ? `<span class="itin-tag">${tag}</span>` : ''}
      </div>
      ${legs}
    </div>`;
}


/* ================================================================== *
 * 바텀시트 (모바일)
 * ================================================================== */
const sheet = (() => {
  const el = $('panel'), grab = $('grab');
  const isMobile = () => window.matchMedia('(max-width:820px)').matches;
  const vh = () => window.innerHeight;
  const snaps = () => [Math.round(vh() * 0.16), Math.round(vh() * 0.46), Math.round(vh() * 0.88)];
  let cur = 1;

  function apply(px, animate = true) {
    el.classList.toggle('dragging', !animate);
    // dvh 와 innerHeight 가 어긋나는 브라우저가 있어 높이를 전부 px 로 통일한다
    const root = document.documentElement.style;
    root.setProperty('--sheet-max', Math.round(vh() * 0.88) + 'px');
    root.setProperty('--sheet', Math.round(px) + 'px');
  }
  function goto(i, animate = true) {
    cur = Math.max(0, Math.min(2, i));
    apply(snaps()[cur], animate);
    return cur;
  }
  function height() { return isMobile() ? snaps()[cur] : 0; }

  /* --- 드래그 --- */
  let startY = 0, startPx = 0, dragging = false;
  const onDown = e => {
    if (!isMobile()) return;
    dragging = true; startY = (e.touches ? e.touches[0] : e).clientY;
    startPx = snaps()[cur];
    el.classList.add('dragging');
  };
  const onMove = e => {
    if (!dragging) return;
    e.preventDefault();
    const y = (e.touches ? e.touches[0] : e).clientY;
    const px = Math.max(60, Math.min(vh() * 0.88, startPx + (startY - y)));
    apply(px, false);
  };
  const onUp = e => {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    const y = (e.changedTouches ? e.changedTouches[0] : e).clientY;
    const px = startPx + (startY - y);
    const s = snaps();
    // 가장 가까운 스냅 지점으로
    let bi = 0;
    s.forEach((v, i) => { if (Math.abs(v - px) < Math.abs(s[bi] - px)) bi = i; });
    goto(bi);
  };
  grab.addEventListener('touchstart', onDown, { passive: true });
  grab.addEventListener('mousedown', onDown);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchend', onUp);
  window.addEventListener('mouseup', onUp);
  grab.addEventListener('click', () => { if (isMobile()) goto(cur === 2 ? 1 : cur + 1); });

  /* 목록을 맨 위까지 올렸을 때만 시트를 끌어내린다 */
  $('panelScroll').addEventListener('touchstart', e => {
    if (!isMobile() || $('panelScroll').scrollTop > 0) return;
    onDown(e);
  }, { passive: true });

  window.addEventListener('resize', () => { if (isMobile()) apply(snaps()[cur], false); });
  if (isMobile()) goto(1, false);
  const raise = i => { if (isMobile() && cur < i) goto(i); };
  return { goto, raise, height, isMobile };
})();

/* 경로를 지도에 맞출 때 시트에 가리는 만큼 아래쪽 여백을 준다 */
function fitWithSheet(bounds, extra = 40) {
  map.fitBounds(bounds, {
    paddingTopLeft: [extra, extra],
    paddingBottomRight: [extra, extra + sheetHeight()],
    maxZoom: 17, animate: false,
  });
}

/* ---------- 시작 ---------- */
whenLabel();
// 데스크톱은 폼만 펴 두고 제안 목록은 입력칸을 누를 때 띄운다
if (wideScreen()) openTrip(true, false);
drawFilters();
drawRoutes();
drawStops();
render();
// 처음에는 캠퍼스(순환노선)에 맞춘다 — 지곡·유강까지 넣으면 캠퍼스가 너무 작아진다
fitWithSheet(L.latLngBounds(
  ROUTES.filter(r => r.kind === 'circulation').flatMap(r => r.path.coords)), 24);
setInterval(() => { if (simMinutes === null) render(); }, 1000);

/* ================================================================== *
 * 언어 전환
 * ================================================================== */
function applyLang() {
  setLang(LANG);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('brandShort', T.brandShort);
  set('brandLong', T.brandLong);
  set('tagline', T.tagline);
  set('btnRoute', T.route);
  set('lnkTimetable', T.timetable);
  set('pinFrom', T.from);
  set('pinTo', T.to);
  set('editHint', T.editHint);
  set('btnCopy', T.copyJson);
  set('btnResetCoords', T.resetCoords);
  set('askNo', T.askNo);
  $('inFrom').placeholder = T.fromPh;
  $('inTo').placeholder = T.toPh;
  $('btnHere').title = T.here;
  $('btnSwap').title = T.swap;
  $('btnLoc').title = T.myLocation;
  $('btnFit').title = T.fitAll;
  $('btnBase').title = T[BASE_STYLES[baseIdx].key];
  if ($('btnEdit')) $('btnEdit').title = T.fixCoords;
  // 출발·도착이 "내 위치"였다면 그 표기도 함께 바꾼다
  for (const [pt, id] of [[tripFrom, 'inFrom'], [tripTo, 'inTo']]) {
    if (pt && (pt.label === STRINGS.ko.here || pt.label === STRINGS.en.here)) {
      pt.label = T.here;
      $(id).value = T.here;
    }
  }
  whenLabel();
  for (const [k, m] of busMarkers) { layerBuses.removeLayer(m); busMarkers.delete(k); }
  drawFilters();
  drawStops();
  if (tripPlans.length) collapseForm(true);
  render();
}

function bindLangButtons() {
  for (const [id, lang] of [['langKo', 'ko'], ['langEn', 'en']]) {
    const el = $(id);
    if (!el) continue;
    el.onclick = e => {
      e.stopPropagation();
      if (LANG === lang) return;
      LANG = lang;
      applyLang();
      setBasemap(baseIdx);       // 지도 라벨 언어도 함께 바꾼다
    };
  }
}
applyLang();

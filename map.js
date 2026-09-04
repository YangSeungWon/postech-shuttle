'use strict';

/* ------------------------------------------------------------------ *
 * POSTECH 셔틀버스 지도
 * 위치는 공개 시간표를 보간해 계산한 "예상" 위치입니다 (실시간 GPS 아님).
 * ------------------------------------------------------------------ */

const $ = id => document.getElementById(id);
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
/* 운행일 판단 — 셔틀은 평일만 운행한다.
   시각을 옮겨 보는 중에는(simMinutes) 날짜는 그대로 오늘로 둔다. */
const SERVICE = DATA.service || { weekdaysOnly: true, holidays: {} };
function serviceDay(d = new Date()) {
  const dow = d.getDay();
  if (SERVICE.weekdaysOnly && (dow === 0 || dow === 6)) return { runs: false, why: 'weekend' };
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
            + `${String(d.getDate()).padStart(2, '0')}`;
  const name = SERVICE.holidays?.[iso];
  if (name) return { runs: false, why: 'holiday', name };
  return { runs: true };
}
const today = () => serviceDay();

let simMinutes = null;                        // null이면 실제 시각
function realNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function nowMin() {
  return simMinutes !== null ? simMinutes : realNow();
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
/* 노선 색은 학교 안내와 맞춘다 — 순환 1 빨강, 2 파랑, 3 초록, 유강 주황, 지곡 보라.
   배지·칩에 흰 글씨나 색 글씨를 얹으므로 흰색 대비 4.5:1 이상인 색조로 골랐다.
   색만으로 구분하지는 않는다 — 배지에 번호·이름이 있고 지도는 한 번에 한 노선만 칠한다. */
const GROUPS = [
  { id: 'route1', ko: '순환 1', en: 'Loop 1',  color: '#C62828', match: r => r.id === 'route1' },
  { id: 'route2', ko: '순환 2', en: 'Loop 2',  color: '#1565C0', match: r => r.id === 'route2' },
  { id: 'route3', ko: '순환 3', en: 'Loop 3',  color: '#2E7D32', match: r => r.id === 'route3' },
  { id: 'jigok',  ko: '지곡',   en: 'Jigok',   color: '#6A1B9A', match: r => r.id.startsWith('jigok:') },
  { id: 'yugang', ko: '유강',   en: 'Yugang',  color: '#BF360C', match: r => r.id.startsWith('yugang:') },
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
/* 지곡·유강은 출퇴근 단방향 노선이라 오전·오후가 서로 다른 경로다.
   한쪽만 보여 주지 않으면 왕복 노선처럼 읽힌다. */
let focusPeriod = null;                // '오전' | '오후'
const isExt = g => g === 'jigok' || g === 'yugang';
const isOn = r => focusGroup === null
  || (r.group === focusGroup && (!focusPeriod || r.period === focusPeriod));

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
  if (!today().runs) return [];
  const out = [];
  for (const r of ROUTES) {
    if (!isOn(r)) continue;
    // 마지막 정류장은 그 운행의 종점이라 탈 수 없다. 들어오는 차를 "곧 도착"
    // 으로 보여 주면 못 타는 차를 기다리게 된다. 순환노선도 종점에 들어온 뒤
    // 다시 나가는 시각이 따로 있으므로 그것만 보여 주면 된다.
    const last = r.canonStops.length - 1;
    const hits = [];
    r.canonStops.forEach((s, i) => { if (s === stopName && i !== last) hits.push(i); });
    if (!hits.length) continue;
    // 어느 방향으로 가는 차인지 — 라이더의 실제 질문은 "어느 쪽에서 타나"다
    const times = [];
    for (const trip of r.tripsMin) for (const i of hits) if (trip[i] >= t - 0.5) times.push([trip[i], i]);
    if (!times.length) continue;
    times.sort((a, b) => a[0] - b[0]);
    const [at, idx] = times[0];
    const next = r.stops[idx + 1];
    out.push({
      route: r, at, eta: at - t, after: times[1]?.[0] ?? null,
      toward: next ? baseName(canon(next)) : null,
    });
  }
  return out.sort((a, b) => a.eta - b.eta);
}

/* ---------- 운행 중인 버스 ---------- */
/* 출발을 기다리는 차도 이미 정류장에 서 있다. 언제부터 서 있는지는
   직전 운행이 끝난 시각으로 본다 — 순환 1 은 09:10 에 들어와 09:15 에 나간다.
   첫차처럼 앞선 운행이 없으면 최대 이만큼 앞부터 보여 준다. */
const MAX_WAIT = 10;

function activeBuses(t) {
  if (!today().runs) return [];
  const buses = [];
  for (const r of ROUTES) {
    if (!isOn(r)) continue;
    r.tripsMin.forEach((trip, ti) => {
      const start = trip[0], end = trip[trip.length - 1];

      if (t >= start && t <= end) {
        let leg = 0;
        while (leg < trip.length - 2 && t >= trip[leg + 1]) leg++;
        const span = trip[leg + 1] - trip[leg];
        const f = span > 0 ? Math.min(1, Math.max(0, (t - trip[leg]) / span)) : 0;
        buses.push({
          key: r.id + '#' + ti,
          route: r,
          ll: posOnLeg(r.path, leg, f),
          from: r.stops[leg], to: r.stops[leg + 1], arriveAt: trip[leg + 1],
          trip, legIdx: leg,
        });
        return;
      }

      const prevEnd = ti > 0 ? r.tripsMin[ti - 1][r.tripsMin[ti - 1].length - 1] : -Infinity;
      const waitFrom = Math.max(prevEnd, start - MAX_WAIT);
      if (t >= waitFrom && t < start) {
        buses.push({
          key: r.id + '#' + ti + 'w',
          route: r,
          ll: r.path.coords[r.path.idx[0]],
          waiting: true, at: r.stops[0], departAt: start,
          trip, legIdx: -1,
        });
      }
    });
  }
  return buses;
}

/* ================================================================== *
 * 지도
 * ================================================================== */
const map = L.map('map', {
  center: CENTER, zoom: 15, zoomControl: false, attributionControl: true,
  maxBoundsViscosity: 1,          // 경계 밖으로는 끌리지 않게
});
/* 확대·축소도 다른 지도 버튼과 같은 모양으로 둔다 */
$('btnZoomIn').onclick = () => map.zoomIn();
$('btnZoomOut').onclick = () => map.zoomOut();
function paintZoom() {
  $('btnZoomIn').disabled = map.getZoom() >= map.getMaxZoom();
  $('btnZoomOut').disabled = map.getZoom() <= map.getMinZoom();
}
map.on('zoomend', paintZoom);
/* 바탕 지도 — 벡터 스타일을 직접 손봐서 쓴다.
   래스터에 흑백 필터를 씌우면 도로 위계와 라벨까지 함께 뭉개져서,
   바탕이 물러나는 게 아니라 그냥 흐려지기만 한다. 벡터라면 땅과 건물은
   물리고 길과 이름만 남길 수 있다. (스타일은 basemap.py 가 만든다) */
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';
const VECTOR_ATTR = OSM_ATTR + ' · <a href="https://openfreemap.org">OpenFreeMap</a>';
const BASE_STYLES = [
  { id: 'muted',  key: 'baseMuted',
    style: () => LANG === 'en' ? './style-muted-en.json' : './style-muted.json', attr: VECTOR_ATTR },
  { id: 'detail', key: 'baseDetail',
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
  // 아이콘은 그대로 두고 상태만 표시한다 (글자로 덮어쓰면 아이콘이 사라진다)
  const btn = document.getElementById('btnBase');
  if (btn) {
    btn.classList.toggle('on', b.id === 'detail');
    btn.title = btn.ariaLabel = T[b.key];
    btn.setAttribute('aria-pressed', String(b.id === 'detail'));
  }
}
setBasemap(baseIdx);

const layerRoutes = L.layerGroup().addTo(map);
const layerStops  = L.layerGroup().addTo(map);
const layerBuses  = L.layerGroup().addTo(map);
const layerXing   = L.layerGroup().addTo(map);

/* 횡단보도 — 129개를 늘 그리면 소음이라 가까이 봤을 때만 옅게 깔고,
   길찾기 중에는 그 경로가 실제로 건너는 곳만 진하게 보여 준다. */
const XING_ZOOM = 17;
function drawCrossings(routeXings) {
  layerXing.clearLayers();
  if (map.getZoom() >= XING_ZOOM) {
    for (const c of DATA.walk.crossings || []) {
      L.polyline(c, { color: '#9AA1AC', weight: 7, opacity: .45,
                      dashArray: '2 3', lineCap: 'butt', interactive: false }).addTo(layerXing);
    }
  }
  // 건널목 선은 도로를 가로지르므로, 굵게 깔고 흰 줄무늬를 얹으면 얼룩말 무늬로 읽힌다
  for (const c of routeXings || []) {
    L.polyline(c, { color: '#2F3540', weight: 13, opacity: .95,
                    lineCap: 'butt', interactive: false }).addTo(layerXing);
    L.polyline(c, { color: '#fff', weight: 13, opacity: .95, dashArray: '3 4',
                    lineCap: 'butt', interactive: false }).addTo(layerXing);
  }
}
map.on('zoomend', () => drawCrossings(tripXings));
let tripXings = [];

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

/* 진행 방향 화살표. 지곡·유강은 단방향이고 순환도 도는 방향이 있어,
   선만 그려서는 어느 쪽으로 가는지 알 수 없다. */
function arrowsAlong(coords, color, everyPx = 110) {
  const pts = coords.map(c => map.latLngToLayerPoint(L.latLng(c)));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    acc += len;
    if (acc < everyPx) continue;
    acc = 0;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    L.marker(map.layerPointToLatLng(L.point((pts[i].x + pts[i - 1].x) / 2,
                                            (pts[i].y + pts[i - 1].y) / 2)), {
      icon: L.divIcon({
        className: 'arrow-icon', iconSize: null, iconAnchor: [0, 0],
        html: `<div class="arrow" style="transform:translate(-50%,-50%) rotate(${deg}deg);color:${color}">➤</div>`,
      }),
      interactive: false, keyboard: false, zIndexOffset: 50,
    }).addTo(layerRoutes);
  }
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
  const mine = lines.filter(r => r.group === focusGroup
    && (!focusPeriod || r.period === focusPeriod));
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
  for (const { r, line } of shifted) arrowsAlong(line, r.color);
}
map.on('zoomend', drawRoutes);

/* 노선이 지나는 만큼만 돌아다니게 한다. 캠퍼스 셔틀 지도에서 전국을 볼 이유가
   없고, 오프라인 타일 캐시가 쓸데없이 커진다. */
/* 가장자리 여유는 거리로 준다. 비율로 주면 남북으로만 넓어진다.
   남쪽은 모바일에서 시트가 가리므로 조금 더 둔다. */
const EDGE_M = 150, SOUTH_EXTRA_M = 1400;
const NETWORK = (() => {
  const b = L.latLngBounds(ROUTES.flatMap(r => r.path.coords));
  const dLat = EDGE_M / 111000, dLng = EDGE_M / 90000;
  return L.latLngBounds(
    [b.getSouth() - dLat - SOUTH_EXTRA_M / 111000, b.getWest() - dLng],
    [b.getNorth() + dLat, b.getEast() + dLng]);
})();
function clampToNetwork() {
  map.setMaxBounds(NETWORK);
  // 전체가 한 화면에 들어오는 배율까지만 (inside 를 켜면 반대로 잠긴다)
  map.setMinZoom(Math.max(11, Math.floor(map.getBoundsZoom(NETWORK))));
}
clampToNetwork();
paintZoom();
addEventListener('resize', () => { clampToNetwork(); paintZoom(); });

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
    ? new Set(ROUTES.filter(isOn).flatMap(r => r.canonStops))
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
      alt: stopLabel(s.name),
    }).addTo(layerStops);
    m.getElement()?.setAttribute('aria-label', stopLabel(s.name));
    m.getElement()?.setAttribute('role', 'button');
    m.on('click', () => {
      // 경로를 안내하는 중에는 출발·도착이 이미 정해져 있다. 그 자리에서
      // 다시 찍을 일이 없으므로 표지를 띄우지 않는다.
      if (guiding()) return;
      selectStop(s.name);
      pointActions(s.ll, stopLabel(s.name));
    });
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
          html: `<div class="bus ${b.waiting ? 'waiting' : ''}" style="--c:${b.route.color}">
                   <span class="bus-body"><span class="bus-win"></span>${label}</span>
                   <i class="wheel"></i><i class="wheel r"></i>
                 </div>`
        }),
        zIndexOffset: 400,
      }).addTo(layerBuses);
      m.on('click', () => selectBus(b.key));
      m.getElement()?.setAttribute('role', 'button');
      busMarkers.set(b.key, m);
    } else {
      m.setLatLng(b.ll);
      m.getElement()?.firstElementChild?.classList.toggle('waiting', !!b.waiting);
    }
    m.getElement()?.setAttribute('aria-label', b.waiting
      ? T.waitingAt(stopLabel(b.at), Math.max(1, Math.round(b.departAt - t)), fmt(b.departAt))
      : `${routeLabel(b.route)} · ${T.toward(shortLabel(baseName(canon(b.to))))}`);
    m.bindTooltip(
      b.waiting
        ? `<b>${routeLabel(b.route)}</b><br>${T.waitingAt(stopLabel(b.at), Math.max(1, Math.round(b.departAt - t)), fmt(b.departAt))}`
        : `<b>${routeLabel(b.route)}</b><br>${stopLabel(b.to)} · ${fmt(b.arriveAt)}`,
      { direction: 'top', offset: [0, -12] }
    );
  }
  for (const [k, m] of busMarkers) if (!keep.has(k)) { layerBuses.removeLayer(m); busMarkers.delete(k); }
  return live;
}

/* --- 누른 버스의 경로 --- *
 * "이 차 어디로 가지?" 에 답한다. 지나온 길은 흐리게, 남은 길은 진하게 그린다.
 */
let selectedBus = null;
const layerBusPath = L.layerGroup().addTo(map);

function selectBus(key) {
  selectedBus = selectedBus === key ? null : key;
  render();
}

function drawBusPath(b) {
  layerBusPath.clearLayers();
  if (!b) return;
  const p = b.route.path;
  const here = b.legIdx < 0 ? p.idx[0] : p.idx[b.legIdx];
  const done = p.coords.slice(0, here + 1);
  const rest = p.coords.slice(here);
  if (done.length > 1) {
    L.polyline(done, { color: b.route.color, weight: 4, opacity: .3,
                       lineCap: 'round', interactive: false }).addTo(layerBusPath);
  }
  L.polyline(rest, { color: '#fff', weight: 11, opacity: .9, lineCap: 'round', interactive: false }).addTo(layerBusPath);
  L.polyline(rest, { color: b.route.color, weight: 6, opacity: 1, lineCap: 'round', interactive: false }).addTo(layerBusPath);
  for (let i = b.legIdx < 0 ? 0 : b.legIdx + 1; i < b.route.stops.length; i++) {
    const ll = STOPS[canon(b.route.stops[i])];
    if (!ll) continue;
    L.marker(ll, {
      icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<div class="trip-stop" style="border-color:${b.route.color};width:13px;height:13px;border-width:3px"></div>` }),
      zIndexOffset: 350, interactive: false, keyboard: false,
    }).addTo(layerBusPath);
  }
}

/* --- 내 위치 --- */
let myLL = null, myMarker = null, myCircle = null, watchId = null, followMe = false;
let geoError = null;                         // 실패 사유를 패널에 안내한다

/* 브라우저 권한 상태 — 알 수 없으면 null */
async function geoPermission() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch (e) { return null; }
}

/* 사이트가 권한을 켜 줄 수는 없다. 다만 사용자가 설정에서 풀면
   새로고침 없이 바로 잡히도록 상태 변화를 지켜본다. */
(async () => {
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    st.onchange = () => {
      if (st.state === 'granted') { $('ask').hidden = true; geoError = null; startLocate(); }
    };
  } catch (e) { /* Permissions API 없음 — 그냥 넘어간다 */ }
})();

/* 권한을 못 얻을 때의 대비책 — 지도를 눌러 내 위치를 직접 찍는다 */
let pickingMe = false;
function pickMyLocation() {
  pickingMe = true;
  closeAsk();
  document.getElementById('map').classList.add('picking');
  $('pickHint').hidden = false;
}
map.on('click', e => {
  if (!pickingMe) return;
  pickingMe = false;
  document.getElementById('map').classList.remove('picking');
  $('pickHint').hidden = true;
  setMyLocation([e.latlng.lat, e.latlng.lng], 0);
});
$('pickCancel').onclick = () => {
  pickingMe = false;
  document.getElementById('map').classList.remove('picking');
  $('pickHint').hidden = true;
};

/* 지도 위에 얹힌 UI 는 #map 안에 있어 클릭이 지도까지 전파된다.
   막지 않으면 버튼을 누른 자리가 지도 클릭으로도 잡힌다. */
for (const id of ['ask', 'pickHint', 'updateHint', 'editbar']) {
  const el = $(id);
  if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); }
}
for (const el of document.querySelectorAll('.mapbtns')) {
  L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
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
let askReturn = null;                 // 카드를 닫은 뒤 초점을 돌려줄 곳
function openAsk(el) {
  askReturn = document.activeElement;
  el.hidden = false;
  $('askYes').focus();
}
function closeAsk() {
  $('ask').hidden = true;
  askReturn?.focus?.();
  askReturn = null;
}

function askLocation() {
  const el = $('ask');
  $('askTitle').textContent = T.askTitle;
  $('askBody').textContent = T.askBody;
  $('askYes').textContent = T.askYes;
  $('askYes').onclick = () => { closeAsk(); startLocate(); };
  $('askNo').textContent = T.askNo;
  $('askNo').onclick = closeAsk;
  openAsk(el);
}

/* 이미 거부된 상태 — 복구 경로만 보여 준다 */
function showRecovery() {
  const el = $('ask');
  $('askTitle').textContent = T.denyTitle;
  $('askBody').innerHTML = '<ol class="ask-steps">' +
    recoverySteps().map(t => `<li>${t}</li>`).join('') + '</ol>';
  $('askYes').textContent = T.askRetry;
  $('askYes').onclick = () => { closeAsk(); startLocate(); };
  $('askNo').textContent = T.pickOnMap;
  $('askNo').onclick = pickMyLocation;
  openAsk(el);
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
    setMyLocation([latitude, longitude], accuracy);
  }, err => {
    followMe = false;
    watchId = null;
    $('btnLoc').classList.remove('on');
    geoError = explainGeoError(err);
    if (err.code === 1) showRecovery();
    render();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function setMyLocation(ll, accuracy) {
  {
    myLL = ll;
    const [latitude, longitude] = ll;
    geoError = null;
    $('btnLoc').classList.add('on');
    if (!myMarker) {
      myMarker = L.marker(myLL, {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="me"></div>' }),
        zIndexOffset: 500, interactive: false, keyboard: false,
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
  }
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
  selectedBus = null;
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
/* 길찾기 결과를 안내하는 중인가 — 이때는 관계없는 정보를 감춘다 */
const guiding = () => typeof tripPlans !== 'undefined' && tripPlans.length > 0;

function drawFilters() {
  const chips = [{ id: '', color: '#5C6470' }, ...GROUPS];
  $('filters').innerHTML = chips.map(g => {
    const on = (g.id || null) === focusGroup;
    const label = g.id ? groupLabel(g.id) : T.all;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-g="${g.id}"
              aria-pressed="${on}"
              style="${on ? `background:${g.color}` : `color:${g.color}`}">${label}</button>`;
  }).join('');
  $('filters').querySelectorAll('.chip').forEach(el => el.onclick = () => {
    const g = el.dataset.g || null;
    focusGroup = focusGroup === g ? null : g;   // 같은 칩을 다시 누르면 전체로
    focusPeriod = isExt(focusGroup) ? (nowMin() < 12 * 60 ? '오전' : '오후') : null;
    drawFilters(); drawRoutes(); drawStops(); render();
  });
}

const FAR_MIN = 90;                  // 이보다 멀면 남은 시간 대신 시각만
function etaText(eta) {
  if (eta < 0.5) return T.due;
  return T.min(Math.max(1, Math.round(eta)));
}

/* 누른 버스의 정류장 순서. 지나온 곳·지금·남은 곳을 한눈에. */
function busCard(b, t) {
  const rows = b.route.stops.map((name, i) => {
    const at = b.trip[i];
    const passed = b.legIdx >= 0 && i <= b.legIdx;
    const next = i === (b.legIdx < 0 ? 0 : b.legIdx + 1);
    return `<div class="bs ${passed ? 'passed' : ''} ${next ? 'next' : ''}">
      <span class="bs-dot"${next ? ` style="background:${b.route.color};border-color:${b.route.color}"` : ''}></span>
      <span class="bs-name">${stopLabel(name)}</span>
      <span class="bs-at">${fmt(at)}</span>
    </div>`;
  }).join('');
  const head = b.waiting
    ? T.waitingAt(stopLabel(b.at), Math.max(1, Math.round(b.departAt - t)), fmt(b.departAt))
    : T.toward(shortLabel(baseName(canon(b.to))));
  return `<div class="buscard" style="--c:${b.route.color}">
    <div class="buscard-head">
      <span class="badge" style="background:${b.route.color}">${badge(b.route)}</span>
      <span class="buscard-title">${routeLabel(b.route)}</span>
      <button type="button" class="buscard-x" id="busClose" aria-label="${T.close}">✕</button>
    </div>
    <div class="buscard-sub">${head}</div>
    <div class="bs-list">${rows}</div>
  </div>`;
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
      ${a.toward ? `<span class="arr-toward">${T.toward(shortLabel(a.toward))}</span>` : ''}
    </div>`).join('')
    : `<div class="empty">${T.noService}</div>`;
  return `
    <button type="button" class="stop ${selected === name ? 'active' : ''}"
            data-stop="${name}" aria-pressed="${selected === name}">
      <div class="stop-head">
        <span class="stop-name">${stopLabel(name)}</span>
        ${walk ? `<span class="stop-dist">${T.dist(humanDist(walk.m), walk.min)}</span>` : ''}
      </div>
      <div class="arrivals">${rows}</div>
    </button>`;
}

/* 접힌 상태에서 보이는 한 줄. 첫 화면의 답은 이것 하나면 된다. */
let heroHTML = '';
function setHero(el, html, onclick, label) {
  if (html !== heroHTML) {
    el.innerHTML = html;
    heroHTML = html;
    // 화면에 보이는 조각들을 그대로 읽으면 뜻이 안 통한다. 문장으로 준다.
    if (label) el.setAttribute('aria-label', label); else el.removeAttribute('aria-label');
  }
  el.onclick = onclick;
}
function drawHero(t, walks, walkTo) {
  const el = $('hero');
  // 길찾기 중에는 입력칸이 그 자리를 쓴다
  if (guiding() || $('trip').classList.contains('show')) { el.hidden = true; return; }
  el.hidden = false;

  if (!myLL) {
    setHero(el, `<span class="hero-ask"><span aria-hidden="true">◎</span> ${T.heroAsk}</span>`,
            requestLocation, T.heroAsk);
    return;
  }
  const near = STOP_GROUPS
    .map(g => ({ g, w: walkTo(g) }))
    .filter(x => x.w)
    .sort((a, b) => a.w.min - b.w.min);
  const best = near.find(x => arrivalsForGroup(x.g.name, t).length) || near[0];
  const day = today();
  if (!day.runs) {
    const quiet = day.why === 'weekend' ? T.noWeekend : T.noHoliday(day.name);
    setHero(el, `<span class="hero-quiet">${quiet}</span>`, () => sheet.goto(1), quiet);
    return;
  }
  if (!best) { setHero(el, `<span class="hero-quiet">${T.notRunning}</span>`, null, T.notRunning); return; }

  const a = arrivalsForGroup(best.g.name, t)[0];
  const html = a
    ? `<span class="badge" style="background:${a.route.color}">${badge(a.route)}</span>
       <span class="hero-stop">${stopLabel(best.g.name)}</span>
       <span class="hero-walk">${T.walkShort(best.w.min)}</span>
       <span class="hero-eta">
         <b class="${a.eta <= 3 ? 'soon' : ''}">${a.eta >= FAR_MIN ? fmt(a.at) : etaText(a.eta)}</b>
         ${a.eta >= FAR_MIN ? '' : `<span class="at">${fmt(a.at)}</span>`}
       </span>`
    : `<span class="hero-quiet">${T.notRunning}</span><span class="hero-chev" aria-hidden="true">▲</span>`;
  const label = a
    ? T.heroLabel(stopLabel(best.g.name), best.w.min, routeLabel(a.route),
                  a.eta >= FAR_MIN ? fmt(a.at) : etaText(a.eta))
    : T.notRunning;
  setHero(el, html, () => { selectStop(best.g.name); sheet.goto(1); }, label);
}

function render() {
  const t = nowMin();
  $('filters').hidden = guiding();     // 안내 중에는 노선 필터가 필요 없다
  const live = drawBuses(t);
  const running = live.length;

  // 콜론을 깜빡여 지금 시각임을 드러낸다. 시각을 옮겨 둔 상태에서는 멈춘다.
  // 매초 다시 만들면 애니메이션이 리셋되므로 숫자만 갈아 끼운다.
  const [hh, mm] = fmt(tripMode === 'arrive' ? realNow() : t).split(':');
  if (!$('clockH')) { /* 모바일에는 상단바가 없다 */ } else
  if ($('clockH').textContent !== hh) $('clockH').textContent = hh;
  if ($('clockM') && $('clockM').textContent !== mm) {
    $('clockM').textContent = mm;
    $('clock').setAttribute('aria-label', T.clockLabel(hh, mm));
  }
  $('clock').classList.toggle('sim', simMinutes !== null);

  let html = '';

  if ($('trip').classList.contains('show')) {
    $('hero').hidden = true;
    if (tripPlans.length) {
      html += `<div class="sec-title">${T.suggested}</div>`;
      if (tripPlans[0]?.late) html += `<div class="notice warn">${T.tooLate(fmt(simMinutes))}</div>`;
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
    ? new Set(ROUTES.filter(isOn).flatMap(r => r.canonStops))
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

  const bus = selectedBus ? live.find(b => b.key === selectedBus) : null;
  if (selectedBus && !bus) selectedBus = null;      // 운행이 끝나면 놓아 준다
  drawBusPath(bus);
  if (bus) html += busCard(bus, t);

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
      if (!isOn(r)) continue;
      for (const n of r.canonStops) if (!seq.includes(baseName(n))) seq.push(baseName(n));
    }
    near.sort((a, b) => seq.indexOf(a.name) - seq.indexOf(b.name));
    if (isExt(focusGroup)) html += periodSwitch();
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

  const day = today();
  if (!day.runs) {
    html += `<div class="notice warn">${day.why === 'weekend' ? T.noWeekend : T.noHoliday(day.name)}</div>`;
  } else if (running === 0) {
    html += `<div class="notice warn">${T.notRunning}</div>`;
  }

  if (sourceAge() > STALE_DAYS) {
    html += `<div class="notice warn">${T.staleWarn(DATA.source.checkedAt)}</div>`;
  }
  html += `<div class="source">${sourceNote()}</div>`;
  html += `<div class="panel-links">
    <a href="./timetable.html">${T.allTimetable}</a>
    <span class="lang" role="group" aria-label="Language">
      <button type="button" id="langKo" class="${LANG === 'ko' ? 'on' : ''}"
              aria-pressed="${LANG === 'ko'}" lang="ko">한국어</button
      ><button type="button" id="langEn" class="${LANG === 'en' ? 'on' : ''}"
              aria-pressed="${LANG === 'en'}" lang="en">English</button>
    </span>
  </div>`;

  drawHero(t, walks, walkTo);
  $('panelScroll').innerHTML = html;
  $('panelScroll').querySelectorAll('.stop').forEach(el =>
    el.onclick = () => selectStop(el.dataset.stop));
  bindLangButtons();
  const bx = $('busClose');
  if (bx) bx.onclick = e => { e.stopPropagation(); selectedBus = null; render(); };
  $('panelScroll').querySelectorAll('.period button').forEach(el => el.onclick = () => {
    focusPeriod = el.dataset.p;
    drawRoutes(); drawStops(); render();
  });

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
/* 좌표 보정은 유지보수용이다. 정류장이 다 맞춰진 뒤로는 감춰 두고,
   주소에 ?edit 를 붙였을 때만 꺼낸다. */
if (new URLSearchParams(location.search).has('edit')) $('btnEdit').hidden = false;
$('btnEdit').onclick = toggleEdit;
$('btnBase').onclick = () => setBasemap(baseIdx + 1);
$('askNo').onclick = closeAsk;

/* Esc 로 지금 열려 있는 것을 닫는다 */
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('ask').hidden) { closeAsk(); return; }
  if (pickingMe) { $('pickCancel').click(); return; }
  if (map.getPane('popupPane')?.querySelector('.leaflet-popup')) { map.closePopup(); return; }
  if (!wideScreen() && $('trip').classList.contains('show')) openTrip(false);
});
/* 카드 안에서 Tab 이 밖으로 새지 않게 */
$('ask').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const f = [$('askNo'), $('askYes')];
  const i = f.indexOf(document.activeElement);
  if (i < 0) return;
  const next = e.shiftKey ? (i + f.length - 1) % f.length : (i + 1) % f.length;
  e.preventDefault();
  f[next].focus();
});
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
      m, ascent: Math.round(tr.ascent), coords: tr.coords, crossings: tr.crossings,
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
  $('btnRoute').setAttribute('aria-expanded', String(show));
  // 닫으면 첫 화면 상태(접힘)로 돌아간다. 고른 정류장이 있으면 그것만 보이게 절반.
  sheet.goto(show ? 2 : (selected ? 1 : 0));
  if (!show || on === false) {
    tripFrom = tripTo = null; tripPlans = []; layerTrip.clearLayers();
    $('suggest').innerHTML = ''; $('inFrom').value = $('inTo').value = '';
    collapseForm(false); simMinutes = null; tripMode = 'depart'; whenLabel();
    tripXings = []; drawCrossings(tripXings); drawRoutes(); drawStops();
  } else {
    // 출발지는 대개 내 위치다. 이미 알고 있으면 채워 두고 커서를 도착지로 보낸다.
    if (myLL && !tripFrom) { tripFrom = { ll: myLL, label: T.here }; $('inFrom').value = T.here; }
    activeField = tripFrom ? 'to' : 'from';
    if (suggest) focusEmptyField();
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
    <div class="sug" data-i="${i}" role="option" tabindex="0" aria-selected="false">
      <span class="sug-name">${p.label}</span>
      <span class="sug-kind">${T.kinds[p.kind] || T.kinds.place}</span>
      ${p.d != null ? `<span class="d">${humanDist(p.d)}</span>` : ''}
    </div>`).join('');
  $('suggest').querySelectorAll('.sug').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    };
    el.onclick = () => {
    const p = list[+el.dataset.i];
    const picked = { ll: p.ll, label: p.label };
    if (activeField === 'from') { tripFrom = picked; $('inFrom').value = p.label; }
    else                        { tripTo   = picked; $('inTo').value   = p.label; remember(picked); }
    $('suggest').innerHTML = '';
    if (!tripFrom || !tripTo) { focusEmptyField(); return; }
    runTrip();
    };
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
/* 출발 시각 — 기본은 지금. 눌러야 시각 입력이 나온다.
   도착 기준으로 바꾸면 "그 시각 전에 도착"하는 경로를 찾는다. */
let tripMode = 'depart';                       // 'depart' | 'arrive'
function whenLabel() {
  $('btnMode').textContent = tripMode === 'depart' ? T.modeDepart : T.modeArrive;
  $('btnWhen').textContent = simMinutes === null
    ? (tripMode === 'depart' ? T.now : T.pickTime)
    : (tripMode === 'depart' ? T.departAt(fmt(simMinutes)) : T.arriveBy(fmt(simMinutes)));
}
$('btnMode').onclick = () => {
  tripMode = tripMode === 'depart' ? 'arrive' : 'depart';
  if (tripMode === 'arrive' && simMinutes === null) simMinutes = Math.round(nowMin()) + 30;
  whenLabel();
  runTrip();
};
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
  if (!on) return;
  const end = (which, pin, label) =>
    `<button type="button" class="ts-end" data-end="${which}"
             aria-label="${which === 'from' ? T.editFrom : T.editTo}">
       <span class="pin ${which}">${pin}</span><span>${label}</span>
     </button>`;
  $('tripSummary').innerHTML =
    end('from', T.from, tripFrom.label)
    + `<span class="arrow" aria-hidden="true">→</span>`
    + end('to', T.to, tripTo.label)
    + `<button type="button" class="mini" id="tsSwap" aria-label="${T.swap}">⇅</button>`;
  $('tripSummary').querySelectorAll('.ts-end').forEach(el => el.onclick = () => editEnd(el.dataset.end));
  $('tsSwap').onclick = () => $('btnSwap').click();
}

/* 고칠 칸을 눌러 연다. 글자를 다 선택해 두어 바로 새로 칠 수 있게 한다. */
function editEnd(which) {
  collapseForm(false);
  drawStops();
  activeField = which;
  const field = $(which === 'from' ? 'inFrom' : 'inTo');
  field.focus();
  field.select();
  drawSuggest(search('', myLL));
}

/* --- 지도에서 출발·도착 지정 --- *
 * 정류장을 누르거나 지도를 길게 누르면 그 자리에서 출발·도착으로 삼는다.
 * 검색으로만 입력받으면 이름을 모르는 지점은 지정할 방법이 없다.
 */
function setEndpoint(which, place) {
  // openTrip 이 먼저 포커스를 잡아 버리므로 제안 목록은 여기서 직접 그린다
  if (!$('trip').classList.contains('show')) openTrip(true, false);
  if (which === 'from') { tripFrom = place; $('inFrom').value = place.label; }
  else                  { tripTo = place;   $('inTo').value = place.label; remember(place); }
  map.closePopup();
  if (tripFrom && tripTo) { runTrip(); return; }
  collapseForm(false);
  focusEmptyField();
  render();
}

/* 아직 비어 있는 칸으로 포커스를 옮긴다.
   방금 채운 칸에 포커스가 남아 있으면 목록에서 고른 것이 그 칸을 덮어쓴다. */
function focusEmptyField() {
  activeField = tripFrom ? 'to' : 'from';
  $(tripFrom ? 'inTo' : 'inFrom').focus();
  drawSuggest(search('', myLL));
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
map.on('contextmenu', e => { if (!guiding()) pointActions(e.latlng, T.mapPoint); });

function runTrip() {
  if (!tripFrom || !tripTo) { tripPlans = []; collapseForm(false); layerTrip.clearLayers(); render(); return; }
  const t = nowMin();
  const ctx = { ROUTES, STOP_LIST, isOn, walk: walkNet };
  // 기한이 이미 지났으면 다음 운행일로 본다 (시간표가 하루치뿐이다)
  const earliest = tripMode === 'arrive' && simMinutes < realNow() ? 0 : Math.round(realNow());
  tripPlans = tripMode === 'arrive' && simMinutes !== null
    ? planArriveBy(tripFrom, tripTo, simMinutes, earliest, ctx)
    : planTrip(tripFrom, tripTo, t, ctx);
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
  tripXings = [];
  if (!plan) { drawCrossings(tripXings); return; }
  for (const leg of plan.legs) if (leg.kind === 'walk' && leg.crossings) tripXings.push(...leg.crossings);
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
        zIndexOffset: 550, interactive: false, keyboard: false,
      }).addTo(layerTrip);
    }
  }
  for (const [pt, cls] of [[tripFrom.ll, 'from'], [tripTo.ll, 'to']]) {
    L.marker(pt, {
      icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        html: `<div class="trip-pin ${cls}"></div>` }),
      zIndexOffset: 600, interactive: false, keyboard: false,
    }).addTo(layerTrip);
  }
  drawCrossings(tripXings);
  if (pts.length) fitWithSheet(L.latLngBounds(pts), 50);
}

/* 출근·퇴근 전환. 그 시간대에 실제로 언제 출발하는지 함께 보여 준다. */
function periodSwitch() {
  const runs = p => ROUTES
    .filter(r => r.group === focusGroup && r.period === p)
    .map(r => fmt(r.tripsMin[0][0]))
    .sort();
  const btn = (p, label) =>
    `<button type="button" class="${focusPeriod === p ? 'on' : ''}"
             data-p="${p}" aria-pressed="${focusPeriod === p}">${label}</button>`;
  return `<div class="period">
    ${btn('오전', T.commuteAm)}${btn('오후', T.commutePm)}
    <span class="period-time">${T.departsAt(runs(focusPeriod).join(' · '))}</span>
  </div>`;
}

/* 어느 시점의 시간표인지 밝힌다. 시간표가 바뀌었는데 모르고 쓰는 것이
   이 앱에서 가장 조용히 위험한 상황이다. */
/* 주간 갱신이 멈추면 이 날짜도 멈춘다. 세 번을 거르면 무언가 잘못된 것이니
   날짜를 읽어 알아채기를 기대하지 말고 앱이 말하게 한다. */
const STALE_DAYS = 21;

function sourceAge() {
  const d = DATA.source?.checkedAt;
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
}

function sourceNote() {
  const s = DATA.source || {};
  const age = sourceAge();
  const stale = age !== null && age > STALE_DAYS;
  const parts = [];
  parts.push(s.effectiveFrom ? T.effectiveFrom(s.effectiveFrom) : T.effectiveUnknown);
  if (s.checkedAt) parts.push(stale ? T.staleCheck(age) : T.checkedAt(s.checkedAt));
  return `<span class="${stale ? 'stale' : ''}">${parts.join(' · ')}</span>`;
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
    <button type="button" class="itin ${i === 0 ? 'best' : ''}" data-plan="${i}"
            aria-pressed="${i === 0}">
      <div class="itin-head">
        <span class="itin-dur">${T.min(dur)}</span>
        <span class="itin-time">${fmt(plan.depart)} → ${fmt(plan.arrive)}</span>
        ${tag ? `<span class="itin-tag">${tag}</span>` : ''}
      </div>
      ${legs}
    </button>`;
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
    // 시트를 끝까지 올리면 지도가 거의 가려진다. 버튼 열이 헤더 뒤로 밀리므로 감춘다.
    document.body.classList.toggle('sheet-full', isMobile() && cur === 2);
    grab.setAttribute('aria-expanded', String(cur > 0));
    grab.setAttribute('aria-label', cur === 0 ? T.sheetOpen : T.sheetClose);
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
  grab.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); goto(cur + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); goto(cur - 1); }
  });

  /* 목록을 맨 위까지 올렸을 때만 시트를 끌어내린다 */
  $('panelScroll').addEventListener('touchstart', e => {
    if (!isMobile() || $('panelScroll').scrollTop > 0) return;
    onDown(e);
  }, { passive: true });

  window.addEventListener('resize', () => { if (isMobile()) apply(snaps()[cur], false); });
  if (isMobile()) goto(0, false);
  const raise = i => { if (isMobile() && cur < i) goto(i); };
  return { goto, raise, height, isMobile, relabel: () => goto(cur, false) };
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
  const has = id => !!$(id);
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
  set('skipLink', T.skip);
  $('btnMode').ariaLabel = T.modeSwitch;
  sheet.relabel();
  set('pickHintText', T.pickHint);
  set('updateText', T.updateReady);
  set('updateNow', T.reload);
  set('pickCancel', T.cancel);
  if (has('clock')) $('clock').setAttribute('aria-label', T.clockLabel('--', '--'));
  $('inFrom').placeholder = $('inFrom').ariaLabel = T.fromPh;
  $('inTo').placeholder = $('inTo').ariaLabel = T.toPh;
  $('btnHere').title = $('btnHere').ariaLabel = T.here;
  $('btnSwap').title = $('btnSwap').ariaLabel = T.swap;
  $('btnLoc').title = $('btnLoc').ariaLabel = T.myLocation;
  $('btnFit').title = $('btnFit').ariaLabel = T.fitAll;
  $('btnBase').title = $('btnBase').ariaLabel = T[BASE_STYLES[baseIdx].key];
  if ($('btnEdit')) $('btnEdit').title = $('btnEdit').ariaLabel = T.fixCoords;
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

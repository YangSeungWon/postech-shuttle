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
  /* 밀리초까지 센다. 초 단위로 끊으면 버스가 1초에 한 걸음씩 뛰어서,
     아무리 자주 다시 그려도 뚝뚝 끊겨 보인다. */
  return d.getHours() * 60 + d.getMinutes()
       + (d.getSeconds() + d.getMilliseconds() / 1000) / 60;
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

/* 두 점 사이의 방위(도). 경도 차이는 위도만큼 좁아진다. */
function bearingOf(a, b) {
  if (!a || !b) return null;
  const la = (a[0] + b[0]) / 2 * Math.PI / 180;
  const dLat = b[0] - a[0], dLng = (b[1] - a[1]) * Math.cos(la);
  if (!dLat && !dLng) return null;
  return Math.atan2(dLng, dLat) * 180 / Math.PI;
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
let view = 'stops';                    // 'stops' | 'timetable'
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

/* 다음 운행일. 밤에 오늘 차가 다 끊기면 내일 첫차를 보고 싶어진다.
   주말·공휴일이 끼면 며칠 건너뛴다 — 금요일 밤에는 월요일 첫차다. */
function nextServiceDay(from = new Date()) {
  for (let i = 1; i <= 10; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (serviceDay(d).runs) return { days: i, date: d };
  }
  return null;
}

function arrivalsAt(stopName, t, day = 0) {
  // 오늘 차가 없으면(운행일이 아니거나 다 끊겼으면) 다음 운행일 첫차를 본다
  if (day === 0 && !today().runs) return arrivalsAt(stopName, -1e9, 1);
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
    // 시각이 지나도 1분은 그 정류장에 남겨 둔다 — 학교 안내가 앞뒤 1~2분
    // 오차를 말하므로, 조금 늦는 차를 곧바로 지워 버릴 이유가 없다.
    const grace = 1;
    for (const trip of r.tripsMin) for (const i of hits) if (trip[i] >= t - grace) times.push([trip[i], i]);
    if (!times.length) continue;
    times.sort((a, b) => a[0] - b[0]);
    const [at, idx] = times[0];
    const next = r.stops[idx + 1];
    out.push({
      route: r, at, eta: at - t, after: times[1]?.[0] ?? null, day,
      toward: next ? baseName(canon(next)) : null,
    });
  }
  if (!out.length && day === 0) {
    const nx = nextServiceDay();
    // -1e9 를 넘겨 그날 첫차부터 담는다
    if (nx) return arrivalsAt(stopName, -1e9, nx.days);
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
        /* 정류장에 닿을 때와 떠날 때는 느려진다. 등속으로 미끄러지면
           서지 않고 지나가는 것처럼 보인다. 가운데가 빠르고 양 끝이 느린
           곡선(smoothstep) — 평균 속도는 그대로라 시간표는 안 흔들린다. */
        const fe = f * f * (3 - 2 * f);
        const at = posOnLeg(r.path, leg, fe);
        // 향한 쪽은 지금 자리 앞뒤로 잰다
        const ahead = posOnLeg(r.path, leg, Math.min(1, fe + 0.04));
        const back  = posOnLeg(r.path, leg, Math.max(0, fe - 0.04));
        buses.push({
          key: r.id + '#' + ti,
          route: r,
          ll: at, dir: bearingOf(back, ahead),
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
/* 배경과 노선이 같은 엔진 안에 있어야 돌릴 때 따로 놀지 않는다.
   Leaflet 을 걷어내고 MapLibre 로 옮겼다 — glmap.js 가 Leaflet 이 쓰던
   이름만큼만 흉내내므로 아래 그리는 코드는 그대로다. */
const map = L.map('map', {
  center: CENTER, zoom: 15,
  style: LANG === 'en' ? './style-muted-en.json' : './style-muted.json',
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
let started = false;              // 첫 스타일은 지도를 만들 때 이미 걸렸다

function setBasemap(i) {
  baseIdx = ((i % BASE_STYLES.length) + BASE_STYLES.length) % BASE_STYLES.length;
  const b = BASE_STYLES[baseIdx];
  /* 스타일을 갈면 우리가 얹은 노선·정류장 소스도 함께 지워진다.
     glmap 이 styledata 를 듣고 다시 얹는다. */
  if (started) map._gl.setStyle(b.style());
  started = true;
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
/* 고른 자리에 세우는 물방울 핀. 표지를 지도에 띄우는 대신 이것만 두고,
   출발·도착 버튼은 시트 카드로 내렸다 — 표지는 자리를 어디에 잡아도
   마커나 시트와 부딪혔고, 시트에는 이미 그 정류장 카드가 있다. */
const layerPick = L.layerGroup().addTo(map);
/* 출발·도착 핀. 경로가 나온 뒤가 아니라 찍는 즉시 세운다 — 지도의 한
   지점을 골랐을 때는 그 핀 말고는 어디를 골랐는지 알 길이 없다.
   글자를 붙이는 이유도 같다. 지도 위에서는 자리로 구별할 수가 없어 색만
   남는데, 색 하나에 뜻을 다 실을 수는 없다. */
const layerEnds = L.layerGroup().addTo(map);
/* 출발·도착 물방울. 지도에 세우는 것과 자리를 고를 때 따라다니는 것이
   같은 모양·같은 색이어야 무엇을 찍는 중인지 알 수 있다. */
function pinHTML(cls, label) {
  return `<div class="trip-pin ${cls}">
      <svg viewBox="-23 -23 46 55" aria-hidden="true">
        <path d="M0 30 L-14.7 12.03 A19 19 0 1 1 14.7 12.03 Z"/>
      </svg><span>${label}</span>
    </div>`;
}

function drawEnds() {
  layerEnds.clearLayers();
  if (pickingFor) setTimeout(hideEndsUnderCursor, 0);
  for (const [pt, cls, label] of [[tripFrom?.ll, 'from', T.from], [tripTo?.ll, 'to', T.to]]) {
    if (!pt) continue;
    L.marker(pt, {
      // 물방울 끝이 지점이다 — 가운데가 아니라 아래 끝에 맞춘다
      // 물방울 꼭짓점(아래 한가운데)이 실제 지점이다
      icon: L.divIcon({ className: 'end-icon', iconSize: [46, 55], iconAnchor: [23, 53],
        html: pinHTML(cls, label) }),
      zIndexOffset: 600, interactive: false, keyboard: false,
    }).addTo(layerEnds);
  }
}
function drawPick(ll) {
  layerPick.clearLayers();
  if (!ll) return;
  L.marker(ll, {
    anchor: 'bottom',
    icon: L.divIcon({ className: 'pick-icon', iconSize: null,
      html: '<div class="pick-pin"></div>' }),
    zIndexOffset: 460, interactive: false, keyboard: false,
  }).addTo(layerPick);
}

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
/* 경계와 최소 배율.

   setMaxBounds 는 쓰지 않는다. MapLibre 는 경계가 화면을 다 못 채우면 채울
   때까지 강제로 확대하는데, 노선 범위가 가로 1.4km 뿐이라 가로가 넓은
   화면에서는 축소가 아예 막혔다. 경계를 화면만큼 넓혀 주면 축소는 되지만
   "캠퍼스를 벗어나지 마라" 가 무의미해진다.

   대신 배율 제한과 같은 방식으로 — 벗어나면 밀어냈다 돌려놓는다. */
function clampToNetwork() {
  map.setMinZoom(Math.max(11, Math.floor(map.getBoundsZoom(NETWORK))));
}
clampToNetwork();
/* 여기서 바로 panTo 하면 안 된다. 진행 중이던 움직임을 끊으면서 moveend 가
   그 자리에서 다시 나는데, 그때도 중심은 아직 바깥이라 또 panTo 한다 —
   끝없이 돈다. 실제로 경로 카드를 골라 지도를 옮길 때 이걸로 터졌다.
   한 박자 미루고, 되돌리는 동안에는 다시 걸리지 않게 한다. */
let clamping = false;
map.on('moveend', () => {
  if (clamping) return;
  const c = map.getCenter();
  const lat = Math.min(Math.max(c.lat, NETWORK.getSouth()), NETWORK.getNorth());
  const lng = Math.min(Math.max(c.lng, NETWORK.getWest()), NETWORK.getEast());
  if (lat === c.lat && lng === c.lng) return;
  clamping = true;
  requestAnimationFrame(() => {
    map.panTo([lat, lng]);
    setTimeout(() => { clamping = false; }, 500);
  });
});
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
        className: 'stop-icon', iconSize: [14, 14], iconAnchor: [7, 7],
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
  /* 갈라진 직후에는 '건너' 짝이 15px 밖에 안 떨어져 있다. 그때만 누르는
     자리를 좁혀 서로의 점을 잡아먹지 않게 한다. */
  document.getElementById('map').classList.toggle('tight',
    map.getZoom() >= SPLIT_ZOOM && map.getZoom() < SPLIT_ZOOM + 1.4);
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
          /* 버스를 좌표 한가운데 놓으면 정류장에 섰을 때 정류장 마커를
             통째로 덮어, 정류장을 누를 수가 없다. 아래 끝을 좌표에 맞춰
             정류장 위에 서게 한다. */
          className: 'bus-icon', anchor: 'bottom', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="bus ${b.waiting ? 'waiting' : ''}" style="--c:${b.route.color}">
                   <i class="bus-dir"></i>
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
    // 향한 쪽. 서 있는 차에는 붙이지 않는다 — 아직 갈 방향이 없다.
    // 매 프레임 도는 자리라 요소는 한 번 찾아 두고 쓴다.
    const dir = m._dirEl || (m._dirEl = m.getElement()?.querySelector('.bus-dir'));
    if (dir) {
      dir.hidden = b.dir == null;
      if (b.dir != null) {
        /* 구간이 바뀌면 방위가 확 튄다. 목표까지 조금씩 따라가게 두면
           휙 도는 대신 스르륵 돈다. 짧은 쪽으로 돌아야 한 바퀴 안 돈다. */
        const prev = parseFloat(dir.dataset.deg);
        const shown = Number.isNaN(prev) ? b.dir
          : prev + (((b.dir - prev + 540) % 360) - 180) * 0.18;
        dir.dataset.deg = shown.toFixed(2);
        // 눈에 안 보일 만큼의 차이로 style 을 건드리면 그때마다 다시 그린다
        const deg = (shown - map.getBearing()).toFixed(1);
        if (dir._deg !== deg) { dir._deg = deg; dir.style.transform = `rotate(${deg}deg)`; }
      }
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
  /* 정류장을 고른 채로 버스를 누르면 그 정류장의 출발·도착 표지가 지도에
     그대로 떠 있었다. 이제 버스를 보겠다는 뜻이니 정류장은 놓는다 —
     selectStop 이 버스를 놓는 것과 같다. */
  map.closePopup();
  if (selected) { selected = null; paintSelection(); drawPick(null); }
  selectedBus = selectedBus === key ? null : key;
  if (selectedBus) {
    if (sheet.isMobile() && tab === 'near') sheet.raise(1);
    /* 시트가 올라오면서 방금 누른 버스를 덮는다. 정류장과 같이, 가려질
       때만 가려지지 않을 만큼 민다. */
    const b = activeBuses(nowMin()).find(x => x.key === selectedBus);
    if (b) reveal(b.ll);
  }
  render();
}

let busPathKey = null;
function drawBusPath(b) {
  /* 자취는 버스가 다음 구간으로 넘어갈 때만 달라진다. 그런데 render 가
     매번 부르는 바람에 1초마다 선과 화살표를 통째로 새로 그리고 있었다 —
     깜빡임의 정체다. 달라졌을 때만 그린다. */
  const key = b ? b.key + '@' + b.legIdx : null;
  if (key === busPathKey) return;
  busPathKey = key;
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
  /* 진행 방향은 버스 자신이 달고 있다. 선 위에 또 뿌리면 같은 말을 두 번
     하는 데다, 고리 노선은 같은 도로를 오갈 때 반대 방향 화살표가 한 줄에
     겹쳐 오히려 못 읽는다. */
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

/* 진행 방향은 버스가 스스로 달고 다닌다. 선 위에 화살표를 뿌려 봤지만
   작아서 알아보기 어려웠고, 고리 노선에서는 오가는 방향이 한 줄에 겹쳤다. */

/* 마커(DOM)와 캔버스(GL)가 어긋나는지 눈으로 가리는 자리.
   주소에 ?debug 를 붙이면 정류장마다 같은 좌표에 GL 원을 그린다. 원은
   노선·배경과 같은 캔버스에 그려지므로, 마커가 원 위에 정확히 앉아 있으면
   배치는 맞는 것이고 아니면 마커 쪽이 어긋난 것이다. */
if (new URLSearchParams(location.search).has('debug')) {
  const dbg = L.layerGroup().addTo(map);
  for (const s of STOP_LIST) {
    // 캔버스에 그리는 원 (노선·배경과 같은 자리)
    L.circle(s.ll, { radius: 6, color: '#00E5FF', fillOpacity: .9 }).addTo(dbg);
    /* DOM 으로 놓는 십자. 정류장 마커와 똑같은 방식으로 놓되 아무 CSS 도
       걸지 않았다. 이 십자가 원 위에 있으면 DOM 배치는 맞는 것이고,
       그런데도 정류장 점이 어긋나 있으면 그 점의 CSS 가 밀고 있는 것이다. */
    L.marker(s.ll, {
      icon: L.divIcon({ className: 'dbg-cross', iconSize: [21, 21], iconAnchor: [10.5, 10.5],
        html: '<i></i><b></b>' }),
      zIndexOffset: 900, interactive: false, keyboard: false,
    }).addTo(dbg);
  }

  /* 마커가 있어야 할 자리(project)와 실제로 놓인 자리(transform)를 견준다.
     둘이 다르고 그 차이가 중심에서 멀수록 커지면 배치가 축척을 잘못 쓰는 것이다. */
  const readXY = el => {
    const t = getComputedStyle(el).transform;           // matrix(a,b,c,d,e,f)
    const n = t && t.startsWith('matrix') ? t.slice(t.indexOf('(') + 1, -1).split(',').map(Number) : null;
    return n ? { x: n[4], y: n[5], sx: n[0], sy: n[3] } : null;
  };
  const check = () => {
    /* 마커를 project() 와 견주는 것은 뜻이 없다 — 둘이 같은 계산을 쓰므로
       그 계산이 틀려도 일치한다. 캔버스가 '실제로' 어떤 크기로 화면에
       그려지는지를 컨테이너와 견줘야 어긋남이 드러난다. */
    const cv = map._gl.getCanvas();
    const box = document.getElementById('map');
    const tr = map._gl.transform;
    console.log('[debug] 컨테이너', box.clientWidth + '×' + box.clientHeight,
                '| 캔버스 CSS', cv.clientWidth + '×' + cv.clientHeight,
                '| 캔버스 버퍼', cv.width + '×' + cv.height,
                '| 지도가 아는 크기', Math.round(tr.width) + '×' + Math.round(tr.height),
                '| DPR', devicePixelRatio);
    /* DOM 이 실제로 놓인 자리(getBoundingClientRect)를 project() 와 견준다.
       앞서 transform 값과 견준 것은 같은 계산을 되물은 셈이라 늘 0 이었다.
       상자 크기도 함께 찍는다 — MapLibre 는 -50% 로 가운데를 잡으므로
       상자가 iconSize 와 다르면 그만큼 밀린다. */
    const box0 = document.getElementById('map').getBoundingClientRect();
    for (const [name, mk] of stopMarkers) {
      const el = mk.getElement();
      const r = el.getBoundingClientRect();
      const want = map.latLngToContainerPoint(mk.getLatLng());
      const gotX = r.left + r.width / 2 - box0.left;
      const gotY = r.top + r.height / 2 - box0.top;
      console.log(`[debug] ${name}: 상자 ${r.width.toFixed(1)}×${r.height.toFixed(1)}`
        + ` (지정 ${el.style.width || '?'}×${el.style.height || '?'})`
        + ` · 어긋남 (${(gotX - want.x).toFixed(1)}, ${(gotY - want.y).toFixed(1)})px`);
    }
    {
      const h = $('hero');
      console.log('[debug] hero 숨김', h.hidden, '· offsetTop', h.offsetTop, '· 높이', h.offsetHeight,
                  '| --sheet', document.documentElement.style.getPropertyValue('--sheet'));
    }
    console.log('[debug] 방위', map.getBearing().toFixed(1), '· 기울기',
                (map._gl.getPitch?.() ?? 0).toFixed(1));
    /* 캔버스에 실제로 찍힌 하늘색 원을 찾아, 마커가 있어야 할 자리와 견준다.
       이것만이 자기 계산을 되묻지 않는 측정이다. */
    const ctx = cv.getContext('webgl2') || cv.getContext('webgl');
    if (ctx) {
      const dpr = cv.width / cv.clientWidth, R = 70;
      for (const [name, mk] of stopMarkers) {
        const p = map.latLngToContainerPoint(mk.getLatLng());
        if (p.x < R || p.y < R || p.x > cv.clientWidth - R || p.y > cv.clientHeight - R) continue;
        const w = Math.round(2 * R * dpr), x0 = Math.round((p.x - R) * dpr);
        // WebGL 은 아래에서 위로 읽는다
        const y0 = Math.round((cv.clientHeight - p.y - R) * dpr);
        const buf = new Uint8Array(w * w * 4);
        ctx.readPixels(x0, y0, w, w, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
        let sx2 = 0, sy2 = 0, n = 0;
        for (let i = 0; i < w * w; i++) {
          const r = buf[i * 4], gg = buf[i * 4 + 1], b = buf[i * 4 + 2];
          if (r < 110 && gg > 170 && b > 200) { sx2 += i % w; sy2 += (i / w) | 0; n++; }
        }
        if (n < 12) { console.log('[debug] 원 못 찾음', name); continue; }
        const cx = sx2 / n / dpr - R, cy = R - sy2 / n / dpr;   // 화면 좌표로
        const c2 = map.getSize();
        console.log(`[debug] ${name}: 원이 마커에서 (${cx.toFixed(1)}, ${cy.toFixed(1)})px 만큼 벗어남`
          + ` · 중심에서 ${Math.round(Math.hypot(p.x - c2.x / 2, p.y - c2.y / 2))}px`);
      }
    }
    const sx = cv.clientWidth / tr.width, sy = cv.clientHeight / tr.height;
    console.log('[debug] 늘어난 배율  가로', sx.toFixed(4), ' 세로', sy.toFixed(4),
                (Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002)
                  ? '← 여기가 원인이다' : '(1 이면 정상)');
    const c = map.getSize();
    const rows = [];
    for (const [name, mk] of stopMarkers) {
      // MapLibre 는 우리가 준 요소 자체에 transform 을 건다 (부모가 아니다)
      const el = mk.getElement();
      const got = el && readXY(el);
      if (!got) { console.log('[debug]', name, '변환값 없음', el && getComputedStyle(el).transform); continue; }
      const want = map.latLngToContainerPoint(mk.getLatLng ? mk.getLatLng() : STOPS[name]);
      const half = { x: el.offsetWidth / 2, y: el.offsetHeight / 2 };
      rows.push({
        정류장: name,
        중심에서: Math.round(Math.hypot(want.x - c.x / 2, want.y - c.y / 2)),
        어긋남: Math.round(Math.hypot(got.x + half.x - want.x, got.y + half.y - want.y)),
        배율: got.sx.toFixed(3),
      });
    }
    rows.sort((a, b) => a.중심에서 - b.중심에서);
    console.log('[debug] 배율', map.getZoom().toFixed(2), '| 컨테이너', c.x + '×' + c.y,
                '| 잰 마커', rows.length + '개');
    // console.table 이 없는 콘솔도 있어 한 줄씩도 찍는다
    for (const r of rows) {
      console.log(`[debug] 중심에서 ${String(r.중심에서).padStart(4)}px  어긋남 ${String(r.어긋남).padStart(3)}px  배율 ${r.배율}  ${r.정류장}`);
    }
    if (console.table) console.table(rows);
  };
  map.on('moveend', check);
  setTimeout(check, 1200);
  // 어느 코드가 돌고 있는지 헷갈리지 않게 표시를 남긴다
  console.log('[debug] BUILD-6 · 정류장', STOP_LIST.length,
              '곳에 GL 원. 지도를 한 번 움직이면 줄이 나온다');

  /* 길찾기 결과를 콘솔에서 바로 확인한다: __plan('무은재삼거리','체육관','13:20') */
  window.__plan = (a, b, hhmm) => {
    const at = n => { const s = STOP_LIST.find(x => x.name === n);
                      return s ? { ll: s.ll, label: s.name } : null; };
    const [H, M] = String(hhmm).split(':').map(Number);
    /* 지도에서 한 노선만 보고 있다고 해서 그 노선으로만 길을 찾으면 안 된다.
     isOn 은 화면에 무엇을 그릴지 고르는 것이지 어느 차를 탈 수 있는지가
     아니다 — 유강을 켜 둔 채 길찾기를 하면 순환이 통째로 사라졌다. */
  const ctx = { ROUTES, STOP_LIST, isOn: () => true, walk: walkNet };
    return { all:    planTrip(at(a), at(b), H * 60 + M, ctx),
             series: planTripSeries(at(a), at(b), H * 60 + M, ctx) };
  };
}

/* --- 내 위치 --- */
let myLL = null, myMarker = null, myCircle = null, watchId = null, followMe = false;
let geoError = null;                         // 실패 사유를 패널에 안내한다

/* ---------- 앱으로 설치 ---------- *
 * 조건은 다 갖췄지만 알려 주는 것이 없으면 사용자가 브라우저 메뉴를 뒤져야 한다.
 * 안드로이드·데스크톱 크롬은 프롬프트를 잡아 두었다가 띄우고,
 * iOS 사파리는 프롬프트가 없으므로 방법을 알려 준다.
 */
/* 한 번 물러나면 다시 권하지 않는다 */
const LS_NUDGE = 'postech-shuttle-install-nudge';
let nudgeOff = false;
try { nudgeOff = localStorage.getItem(LS_NUDGE) === 'off'; } catch (e) {}
const showNudge = () => canInstall() && !nudgeOff;
function dismissNudge() {
  nudgeOff = true;
  try { localStorage.setItem(LS_NUDGE, 'off'); } catch (e) {}
  paintInstallBar();
}
function paintInstallBar() {
  const bar = $('installBar');
  if (bar) bar.hidden = !showNudge();
}

let installPrompt = null;
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = () => navigator.userAgent;
const isIOS = () => /iPad|iPhone|iPod/.test(ua());
const isAndroid = () => /Android/.test(ua());
/* 데스크톱 크롬 계열 — beforeinstallprompt 가 늦거나 오지 않아도 설치는 된다 */
const isChromium = () => /Chrome|Chromium|Edg\//.test(ua()) && !/Firefox/.test(ua());

/* 지금 창이 앱이면(standalone) 권하지 않는다. 그 밖에는 설치가 아예 불가능한
   경우(데스크톱 파이어폭스·사파리)만 빼고 보여 준다.
   "설치했지만 브라우저 탭으로 보는 중"은 크롬에서만 알 수 있어 기준으로 쓰지 않는다. */
const canInstall = () =>
  !isStandalone() && (!!installPrompt || isIOS() || isAndroid() || isChromium());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; paintInstallBar(); });
addEventListener('appinstalled', () => { installPrompt = null; dismissNudge(); });

/* 브라우저마다 경로가 다르다 */
function installSteps() {
  if (isIOS()) return T.stepsIOS;
  if (isAndroid()) return /Firefox/.test(ua()) ? T.stepsFirefox : T.stepsAndroid;
  return T.stepsDesktop;
}

async function install() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    paintInstallBar();
    return;
  }
  // 프롬프트를 주지 않는 브라우저 — 경로를 알려 준다
  const el = $('ask');
  $('askTitle').textContent = T.installTitle;
  $('askBody').innerHTML = '<ol class="ask-steps">'
    + installSteps().map(x => `<li>${x}</li>`).join('') + '</ol>';
  $('askYes').textContent = T.gotIt;
  $('askYes').onclick = closeAsk;
  $('askNo').textContent = T.askNo;
  $('askNo').onclick = closeAsk;
  openAsk(el);
}

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

/* 지도에서 자리 고르기.

   예전에는 "지도를 눌러 주세요" 였는데, 손가락으로 한 점을 정확히 찍는 것은
   무리다. 핀을 화면 가운데 붙박아 두고 지도를 움직여 맞추게 한다 — 지도
   앱들이 쓰는 방식이고, 확대해서 미세하게 맞출 수도 있다.
   which: 'from' | 'to' | 'me' */
let pickingFor = null;
function pickOnMap(which) {
  pickingFor = which;
  /* 여기로 들어오면 입력칸이 blur 된다. 그 blur 는 "고르지 않고 나갔다" 로
     보고 아까 것을 되돌려 놓는데, 지금은 지도에서 고르는 중이므로 되돌리면
     안 된다. 되돌릴 것을 버리고 그 자리도 비워 둔다. */
  if (which === 'from' || which === 'to') {
    held = null;
    if (which === 'from') { tripFrom = null; $('inFrom').value = ''; }
    else { tripTo = null; $('inTo').value = ''; }
    tripPlans = [];
    layerTrip.clearLayers();
    tripXings = []; drawCrossings(tripXings);
    drawEnds();
    render();
  }
  closeAsk();
  $('pickHintText').textContent = which === 'me' ? T.pickHintMe : T.pickHint;
  $('pickHint').hidden = false;
  // 무엇을 찍는 중인지 핀이 말한다 — 지도에 세울 것과 같은 모양·같은 색
  $('pickPin').innerHTML = pinHTML(
    which === 'me' ? 'me' : which,
    which === 'from' ? T.from : which === 'to' ? T.to : T.here);
  $('pickPin').hidden = false;
  sheet.goto(0);
  // 핀이 서는 자리는 위쪽 가림도 셈해야 한다
  document.documentElement.style.setProperty('--pick-top', topInset() + 'px');
  // 시트가 자리를 잡은 뒤라야 커서 자리가 맞다
  for (const d of [0, 60, 260, 420]) setTimeout(hideEndsUnderCursor, d);
}
function endPick() {
  pickingFor = null;
  $('pickHint').hidden = true;
  $('pickPin').hidden = true;
  hideEndsUnderCursor();
}

/* 커서가 이미 서 있는 물방울과 딱 겹치면 둘이 하나로 보인다. 출발을 찍고
   이어서 도착을 찍을 때가 그렇다 — 지도를 움직이지 않았으니 커서가 출발
   물방울 자리에 그대로 선다. 가려지는 동안만 아래 것을 감춘다. */
function hideEndsUnderCursor() {
  const cur = $('pickPin');
  const on = pickingFor && !cur.hidden;
  const r = on ? cur.getBoundingClientRect() : null;
  for (const el of document.querySelectorAll('.end-icon')) {
    if (!on) { el.classList.remove('under-cursor'); continue; }
    const e = el.getBoundingClientRect();
    el.classList.toggle('under-cursor',
      Math.abs((e.left + e.width / 2) - (r.left + r.width / 2)) < 24 &&
      Math.abs(e.bottom - r.bottom) < 24);
  }
}
map.on('move', hideEndsUnderCursor);
function pickMyLocation() { pickOnMap('me'); }
/* 핀이 가리키는 자리는 지도 한가운데가 아니다 — 위(입력칸)와 아래(시트·탭)에
   가려지는 만큼을 뺀 '보이는 가운데'에 선다. 그런데 여기서는 map.getCenter()
   를 적어 두어서, 찍은 자리보다 40px 남짓 위에 물방울이 섰다. 화면에 그려진
   꼭짓점 자리를 그대로 읽는다. */
function pickPoint() {
  const r = $('pickPin').getBoundingClientRect();
  const m = map.getContainer().getBoundingClientRect();
  return map.containerPointToLatLng(
    L.point(r.left + r.width / 2 - m.left, r.bottom - 2 - m.top));
}
$('pickOk').onclick = () => {
  const which = pickingFor;
  if (!which) return;
  const c = pickPoint();
  endPick();
  if (which === 'me') setMyLocation([c.lat, c.lng], 0);
  else setEndpoint(which, { ll: [c.lat, c.lng], label: T.mapPoint });
};

map.on('click', e => {
  if (pickingFor) return;              // 고르는 중에는 지도 누르기가 뜻이 없다
  /* 빈 곳을 누르면 고른 것을 놓는다. 손잡이를 없앤 뒤로 시트를 접을 길이
     없었다 — 지도 앱들이 쓰는 몸짓이고 화면을 차지하지도 않는다. */
  if (selected || selectedBus) {
    selected = null; selectedBus = null;
    map.closePopup();
    drawPick(null);
    paintSelection();
    render();
  }
  if (sheet.isMobile() && tab === 'near') sheet.goto(0);
});
$('pickCancel').onclick = endPick;

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

/* 열자마자 한 번. 이 앱의 첫 질문이 "가장 가까운 정류장이 어디고 버스는
   언제냐" 인데, 위치 없이는 답할 수가 없다.
   이미 허락돼 있으면 아무것도 띄우지 않고 조용히 잡는다. 아직 안 물어본
   상태면 우리 안내 카드부터 — 브라우저 프롬프트를 맨몸으로 띄웠다가
   반사적으로 차단되면 설정에 들어가지 않고는 되돌릴 수 없다. */
const ASKED_KEY = 'geo-asked';
(async () => {
  const st = await geoPermission();
  if (st === 'granted') { startLocate(true); return; }
  if (st === 'denied') return;                 // 다시 물어도 프롬프트가 안 뜬다
  /* Permissions API 가 없는 브라우저(state === null, 사파리)는 허락받았는지
     알 수 없다. 한 번 물어본 적이 있으면 그냥 잡아 본다 — 그때 허락했다면
     조용히 잡히고, 거부했다면 오류만 돌아온다(그때는 아무것도 띄우지 않는다).
     예전에는 여기서 그냥 물러나는 바람에, 두 번째 방문부터는 허락해 둔
     사파리에서도 위치를 잡지 않았다. */
  let asked = false;
  try { asked = !!localStorage.getItem(ASKED_KEY); } catch (e) { /* 무시 */ }
  if (asked) { startLocate(true); return; }
  try { localStorage.setItem(ASKED_KEY, '1'); } catch (e) { /* 무시 */ }
  askLocation();
})();

/* --- 폰이 향한 쪽 --- *
 * Leaflet 은 지도를 돌리지 못한다(MapLibre 는 되지만 그 위에 얹은 Leaflet
 * 레이어가 따라 돌지 않아 어긋난다). 그래서 지도를 돌리는 대신 내 위치에
 * 부채꼴을 띄워 어느 쪽을 보고 있는지 알린다.
 */
let headingOn = false, heading = null, headingBound = false;

/* 지도가 돌아가면 마커 안의 방향 표시는 따라 돌지 않는다(똑바로 서 있어야
   읽히니 일부러 그렇게 둔다). 방위 θ 는 화면에서 θ − bearing 쪽을 가리킨다 —
   MapLibre 의 bearing 은 '화면 위쪽이 가리키는 방위'다. */
function applyMapRotation() {
  const b = map.getBearing();
  for (const el of document.querySelectorAll('.bus-dir')) {
    el.style.transform = `rotate(${(parseFloat(el.dataset.deg || '0') - b).toFixed(0)}deg)`;
  }
  const beam = $('meBeam');
  if (beam && heading !== null) beam.style.transform = `rotate(${(heading - b).toFixed(0)}deg)`;
  // 나침반은 돌아가 있을 때만 나온다. 바늘은 늘 북쪽을 가리킨다.
  const n = $('btnNorth');
  if (n) {
    n.hidden = Math.abs(((b + 180) % 360) - 180) < 0.5;
    n.querySelector('svg').style.transform = `rotate(${(-b).toFixed(0)}deg)`;
  }
}
map.on('rotate', applyMapRotation);
$('btnNorth').onclick = () => {
  map.setBearing(0, true);
  // 손으로 북쪽에 맞췄으면 방향 따라가기는 그만둔다 — 안 그러면 곧 다시 돌아간다
  if (headingOn) { headingOn = false; heading = null; $('btnLoc').classList.remove('heading'); }
  applyHeading();
};

function applyHeading() {
  // ◎ 는 상태가 셋이라 버튼 이름도 따라가야 한다
  $('btnLoc').ariaLabel = headingOn ? T.headingOn : (followMe ? T.following : T.myLocation);
  const w = $('meWrap');
  if (!w) return;
  w.classList.toggle('heading', headingOn && heading !== null);
  applyMapRotation();
}

function onOrientation(e) {
  // iOS 는 진북 기준 값을 따로 준다. 안드로이드는 alpha 가 반시계라 뒤집는다.
  const h = e.webkitCompassHeading != null ? e.webkitCompassHeading
          : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  if (h == null || Number.isNaN(h)) return;
  // 나침반은 가만히 있어도 1~2° 씩 떤다. 그만큼은 흘려보낸다.
  if (heading !== null && Math.abs(((h - heading + 540) % 360) - 180) < 1.2) return;
  heading = h;
  // 내가 보는 쪽이 화면 위로 오게 — MapLibre 의 bearing 이 곧 '위쪽 방위'다
  if (headingOn) map.setBearing(h);
  applyHeading();
}

async function toggleHeading() {
  if (headingOn) {                       // 끄기
    headingOn = false; heading = null;
    $('btnLoc').classList.remove('heading');
    map.setBearing(0, true);             // 방향 모드를 껐으면 북쪽으로
    applyHeading();
    return;
  }
  // iOS 13+ 는 사용자가 누른 그 자리에서 물어봐야 한다
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      if (await DOE.requestPermission() !== 'granted') return;
    } catch (e) { return; }
  } else if (!DOE) {
    return;                              // 나침반이 없는 기기 — 조용히 넘어간다
  }
  headingOn = true;
  $('btnLoc').classList.add('heading');
  if (!headingBound) {
    headingBound = true;
    addEventListener('deviceorientationabsolute', onOrientation);
    addEventListener('deviceorientation', onOrientation);
  }
  applyHeading();
}

/* ◎ 버튼의 진입점. 세 단계로 돈다 — 끔 → 따라가기 → 방향까지. */
async function requestLocation() {
  if (myLL && followMe) { toggleHeading(); return; }
  if (myLL) {
    followMe = true; $('btnLoc').classList.add('on');
    pingMe();                            // 눌렀다는 것이 보여야 한다
    map.setView(myLL, 16); return;
  }
  const state = await geoPermission();
  if (state === 'granted') startLocate();
  else if (state === 'denied') showRecovery();
  else askLocation();
}

/* quiet: 열자마자 자동으로 잡는 경우. 위치만 얻고 지도는 건드리지 않는다 —
   보고 있던 화면이 저 혼자 움직이면 그게 더 당황스럽다. */
function startLocate(quiet = false) {
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
  followMe = !quiet;
  geoError = null;
  $('btnLoc').classList.toggle('on', !quiet);
  if (watchId !== null) { if (myLL && !quiet) map.setView(myLL, 16); return; }

  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    setMyLocation([latitude, longitude], accuracy);
  }, err => {
    followMe = false;
    watchId = null;
    $('btnLoc').classList.remove('on');
    geoError = explainGeoError(err);
    // 저절로 잡으려던 것이면 실패해도 조용히 넘어간다 — 묻지도 않았는데
    // 되돌리는 방법을 늘어놓을 일은 아니다
    if (err.code === 1 && !quiet) showRecovery();
    render();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function setMyLocation(ll, accuracy) {
  {
    myLL = ll;
    const [latitude, longitude] = ll;
    geoError = null;
    // ◎ 는 "내 위치를 따라간다" 는 뜻이다. 저절로 잡힌 것만으로는 켜지 않는다.
    $('btnLoc').classList.toggle('on', followMe);
    if (!myMarker) {
      myMarker = L.marker(myLL, {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          /* 부채꼴은 위(-y)를 향하게 그려 두고 방위만큼 돌린다.
             꼭짓점 (0,0), 반지름 50, 좌우 20° — 끝점은 (∓17.1, -47.0) */
          html: `<div class="me-wrap" id="meWrap">
                   <div class="me-glow"></div><div class="me-ping" id="mePing"></div>
                   <svg class="me-beam" id="meBeam" viewBox="-50 -50 100 100" aria-hidden="true">
                     <defs><radialGradient id="meBeamFill">
                       <stop offset=".18" stop-color="#1a73e8" stop-opacity=".55"/>
                       <stop offset="1" stop-color="#1a73e8" stop-opacity="0"/>
                     </radialGradient></defs>
                     <path d="M0 0 L-17.1 -47 A50 50 0 0 1 17.1 -47 Z" fill="url(#meBeamFill)"/>
                   </svg>
                   <div class="me"></div>
                 </div>` }),
        zIndexOffset: 500, interactive: false, keyboard: false,
      }).addTo(map);
      applyHeading();
      pingMe();                          // 처음 잡았다
      myCircle = L.circle(myLL, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
      /* 위치가 잡혔다고 지도를 옮기지는 않는다. 노선이 캠퍼스 한 뙈기라
         첫 화면에 이미 정류장이 다 들어와 있고, 그중 내가 어디인지는
         파란 점이 말해 준다. 굳이 확대해 들어갈 이유가 없다.
         가운데로 오고 싶으면 ◎ 를 누르면 된다. */
    } else {
      /* watchPosition 은 몇 초마다 들어오고 대개 몇 미터씩 흔들린다. 그때마다
         퍼뜨리면 신호가 아니라 소음이다. 실제로 옮겨 갔을 때만. */
      const was = myMarker.getLatLng();          // 아직 옮기기 전 자리
      const moved = dist([was.lat, was.lng], ll);
      myMarker.setLatLng(myLL); myCircle.setLatLng(myLL).setRadius(accuracy);
      if (moved > 15) pingMe();
      if (followMe) map.setView(myLL, map.getZoom());
    }
    /* 출발지는 거의 언제나 지금 있는 자리다. 비어 있으면 채운다 —
       위치가 늦게 잡혀도, 지웠다가 다시 열어도. 지운 채로 두고 싶으면
       다른 곳을 고르면 되고, 되돌리려면 옆의 ◎ 를 누르면 된다. */
    if ($('trip').classList.contains('show') && !tripFrom && !$('inFrom').value) {
      tripFrom = { ll: myLL, label: T.here };
      $('inFrom').value = T.here;
      // 출발칸에 커서를 두고 기다리던 참이면 이제 도착으로 넘긴다
      if (document.activeElement === $('inFrom')) focusEmptyField();
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

map.on('dragstart', () => {
  followMe = false;
  $('btnLoc').classList.remove('on');
  if (headingOn) { headingOn = false; $('btnLoc').classList.remove('heading'); applyHeading(); }
});

function selectStop(name, center) {
  selectedBus = null;
  selected = selected === name ? null : name;
  paintSelection();
  map.closePopup();
  drawPick(null);
  if (selected) {
    /* 시간표를 보다가 지도에서 정류장을 찍었으면, 그건 그 정류장을 보겠다는
       뜻이다. 시트에 시간표가 그대로 남아 있으면 찍은 보람이 없다. */
    if (view === 'timetable') { view = 'stops'; syncTab('near'); }
    // 카드를 볼 만큼만. 시간표(끝까지)에서 왔으면 내려서 지도를 되돌려 준다
    sheet.goto(1);
    const ll = groupOfStop(selected)?.ll || STOPS[selected];
    /* 지도에서 찍었으면 이미 보고 있는 자리라 밀지 않는다. 목록에서 골랐으면
       그 정류장이 화면에 없을 수도 있으니 데려온다. */
    if (center) centerInView(ll); else reveal(ll);
    drawPick(ll);
  }
  render();
}

/* 시트에 가리는 만큼 지도 중심을 위로 올린 좌표 */
/* 아래가 가려지는 높이. offsetHeight 를 읽으면 그 자리에서 레이아웃이
   걸리는데, 버스를 따라가느라 매 프레임 부르면 그것만으로 화면이 떤다.
   0.25초쯤 묵혀 쓴다 — 시트가 그보다 빨리 오르내리지는 않는다. */
let sheetHCache = { at: -1e9, v: 0 };
const sheetHeight = () => {
  const now = performance.now();
  if (now - sheetHCache.at < 250) return sheetHCache.v;
  const tabs = $('tabs')?.offsetHeight && window.matchMedia('(max-width:820px)').matches
    ? $('tabs').offsetHeight : 0;
  const v = (typeof sheet === 'undefined' ? 0 : sheet.height()) + tabs;
  sheetHCache = { at: now, v };
  return v;
};
/* 방금 잡았다는 신호. 애니메이션을 다시 걸려면 지웠다가 리플로우를 한 번
   거쳐야 한다 — 클래스만 다시 붙이면 브라우저가 같은 상태로 보고 넘긴다. */
function pingMe() {
  const el = $('mePing');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

/* 보이는 영역(위아래 가려지는 만큼을 뺀 곳)의 한가운데로 데려온다 */
function centerInView(ll) {
  const p = map.latLngToContainerPoint(ll);
  const s = map.getSize();
  const mid = (topInset() + (s.y - sheetHeight())) / 2;
  map.panTo(map.containerPointToLatLng(L.point(p.x, p.y + s.y / 2 - mid)));
}

/* 누른 것이 시트나 상단바에 가려질 때만, 가려지지 않을 만큼만 민다.
   가운데로 끌어오면 누를 때마다 화면이 크게 튀어 어디를 보고 있었는지
   잃는다 — 카메라는 되도록 사용자가 둔 자리에 있어야 한다. */
function reveal(ll) {
  const p = map.latLngToContainerPoint(ll);
  const s = map.getSize();
  const m = 46;                              // 핀이 설 자리
  const top = topInset() + 56, bot = s.y - sheetHeight() - m;
  let dx = 0, dy = 0;
  if (p.x < m) dx = p.x - m; else if (p.x > s.x - m) dx = p.x - (s.x - m);
  if (p.y < top) dy = p.y - top; else if (p.y > bot) dy = p.y - bot;
  if (!dx && !dy) return;                    // 이미 잘 보인다
  map.panTo(map.containerPointToLatLng(L.point(s.x / 2 + dx, s.y / 2 + dy)));
}

/* 화면 위(길찾기 입력칸)와 아래(시트·카드 띠·탭)에 가려지는 높이 */
function topInset() {
  const t = $('tripTop');
  return t && !t.hidden ? t.offsetHeight : 0;
}

/* ================================================================== *
 * 패널
 * ================================================================== */
/* 패널 내용은 1초마다 다시 그린다(남은 시간이 바뀌므로). 그때마다 통째로
   갈아 끼우면 스크롤이 맨 앞으로 돌아간다 — 시간표를 옆으로 밀다가 자꾸
   처음으로 튕기던 것이 이것이다. 내용이 같으면 손대지 않고, 갈아 끼울
   때는 세로·가로 스크롤 자리를 되돌려 놓는다. */
let panelHTML = null;
function setPanel(html) {
  const el = $('panelScroll');
  if (html === panelHTML) return false;
  panelHTML = html;
  const top = el.scrollTop;
  const lefts = [...el.querySelectorAll('.tt-wrap')].map(w => w.scrollLeft);
  el.innerHTML = html;
  el.scrollTop = top;
  el.querySelectorAll('.tt-wrap').forEach((w, i) => { if (lefts[i]) w.scrollLeft = lefts[i]; });
  return true;
}

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
    fitFocus();
  });
}

/* 노선을 고르면 그 노선이 한눈에 들어오게 맞춘다. 지곡·유강은 캠퍼스
   밖까지 나가는데, 고르고도 화면이 그대로면 어디로 가는 노선인지 알 수 없다.
   시트에 가리는 만큼은 비켜서 잡는다. */
function fitFocus() {
  if (view === 'timetable') return;        // 시간표를 보는 중엔 지도가 안 보인다
  /* '전체' 로 돌아오면 첫 화면과 같이 캠퍼스에 맞춘다. 지곡·유강까지 넣으면
     2km 가 넘어 캠퍼스가 너무 작아진다. */
  const shown = focusGroup ? ROUTES.filter(isOn)
                           : ROUTES.filter(r => r.kind === 'circulation');
  const pts = shown.flatMap(r => r.path.coords);
  if (!pts.length) return;
  fitWithSheet(L.latLngBounds(pts), focusGroup ? 28 : 24);
}

/* 오늘이 아닌 차에는 며칠 뒤인지 붙인다. 금요일 밤이면 "월요일 07:40" 이다. */
function dayLabel(days) {
  if (!days) return '';
  if (days === 1) return T.tomorrow;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return T.weekdays[d.getDay()];
}

const FAR_MIN = 90;                  // 이보다 멀면 남은 시간 대신 시각만
/* 학교 안내는 "도착시간에 앞뒤 1~2분의 오차가 발생할 수 있다"고 한다.
   그래서 시간표의 09:15 는 09:13 일 수도, 09:16 일 수도 있다. 그 구간에
   "2분"이라고 말하면 이미 와 있는 차를 두고 걸어가게 된다. 앞뒤 어느
   쪽인지 우리는 알 수 없으니, 알 수 없다고 말한다.
   앞으로 1분 30초 — 일찍 올 수 있는 만큼. 뒤로 1분 — 늦게 올 수 있는 만큼.
   그 뒤로는 떠난 것으로 보고 다음 차를 말한다. */
const isDue = eta => eta < 1.5;
function etaText(eta) {
  if (isDue(eta)) return T.due;
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

/* 전체 시간표. 정류장을 가로로, 운행을 세로로 놓은 표.
   좁은 화면에서는 가로로 스크롤한다. '전체' 를 고르면 노선을 모두 이어 붙인다. */
function routeTable(g, t) {
  /* 지곡·유강은 출근과 퇴근이 서로 다른 경로다 — 서는 정류장도 순서도
     달라서 한 표에 담을 수가 없다. 노선을 골랐을 때는 고른 시간대만,
     전체를 볼 때는 둘 다 그린다. 예전에는 전체에서도 오전만 그려서
     퇴근 시간표가 통째로 빠져 있었다. */
  const all = ROUTES.filter(r => r.group === g);
  const periods = isExt(g)
    ? (focusGroup ? [focusPeriod || '오전'] : ['오전', '오후'])
    : [null];
  return periods.map(p => routeTableFor(g, t, all.filter(r => !p || r.period === p), p))
                .filter(Boolean).join('');
}

function routeTableFor(g, t, runs, period) {
  if (!runs.length) return '';

  const stops = runs[0].stops;
  const rows = runs.flatMap(r => r.tripsMin.map(trip => ({ r, trip })))
                   .sort((a, b) => a.trip[0] - b.trip[0]);
  const running = today().runs;
  const nextIdx = running ? rows.findIndex(x => x.trip[0] >= t) : -1;

  const head = stops.map(n => `<th scope="col">${stopLabel(n)}</th>`).join('');
  const body = rows.map(({ trip }, i) => {
    const cls = i === nextIdx ? 'next' : (running && trip[trip.length - 1] < t ? 'past' : '');
    return `<tr class="${cls}">` + trip.map(m => `<td>${fmt(m)}</td>`).join('') + '</tr>';
  }).join('');

  return `<div class="sec-title tt-head">
      <span class="badge" style="background:${GROUPS.find(x => x.id === g).color}">${
        badge(ROUTES.find(r => r.group === g))}</span>${T.routeTimetable(groupLabel(g))}${
        period ? `<span class="tt-period">${period === '오전' ? T.commuteAm : T.commutePm}</span>` : ''}
    </div>
    <div class="tt-wrap"><table class="tt">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
    </table></div>`;
}

function timetableView(t) {
  const groups = focusGroup ? [focusGroup] : GROUPS.map(g => g.id);
  /* 확장노선은 출근·퇴근이 서로 다른 경로라 전환이 필요하다. 순환노선에는
     그런 게 없다 — 전체를 볼 때 그 전환을 띄우면 순환 시간표까지 오전·오후로
     갈리는 것처럼 읽힌다. 고른 노선이 확장노선일 때만 보여 준다. */
  const period = focusGroup && isExt(focusGroup) ? periodSwitch(focusGroup) : '';
  const tables = groups.map(g => routeTable(g, t)).filter(Boolean).join('');
  if (!tables) return `<div class="notice warn">${T.notRunning}</div>`;
  return period + tables + `<div class="notice">${T.timetableHint}</div>`;
}

function stopCard(name, t, walk) {
  const arr = arrivalsForGroup(name, t);
  const rows = arr.length ? arr.slice(0, 3).map(a => `
    <div class="arr">
      <span class="badge" style="background:${a.route.color}">${badge(a.route)}</span>
      ${a.day || a.eta >= FAR_MIN
        ? `<span class="arr-eta far">${a.day ? dayLabel(a.day) + ' ' : ''}${fmt(a.at)}</span>`
        : `<span class="arr-eta ${a.eta <= 3 ? 'soon' : ''} ${isDue(a.eta) ? 'due' : ''}">${etaText(a.eta)}</span>`}
      ${a.side ? `<span class="side">${T.across}</span>` : ''}
      ${a.day || a.eta >= FAR_MIN || isDue(a.eta) ? '' : `<span class="arr-at">${fmt(a.at)}</span>`}
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
    </button>` + (selected === name ? `
    <div class="pa card" role="group" aria-label="${stopLabel(name)}">
      <button data-w="from" data-stop="${name}">${T.startHere}</button>
      <button data-w="to" data-stop="${name}">${T.endHere}</button>
    </div>` : '');
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
  /* hero 는 "아무것도 안 물었을 때의 답"이다 — 가장 가까운 정류장의 다음 차.
     다른 것을 물었으면(이 버스는 어디로 가나, 이 노선은 어디를 서나,
     이 정류장은 언제 오나) 묻지도 않은 답이 맨 위를 차지할 이유가 없다. */
  const idle = !guiding() && !$('trip').classList.contains('show')
    && view !== 'timetable' && !selected && !selectedBus
    && (!sheet.isMobile() || tab === 'near');
  if (!idle) { el.hidden = true; return; }
  el.hidden = false;

  if (!myLL) {
    setHero(el, `<span class="hero-ask"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2"/></svg> ${T.heroAsk}</span>`,
            requestLocation, T.heroAsk);
    return;
  }
  const near = STOP_GROUPS
    .map(g => ({ g, w: walkTo(g) }))
    .filter(x => x.w)
    .sort((a, b) => a.w.min - b.w.min);
  const best = near.find(x => arrivalsForGroup(x.g.name, t).length) || near[0];
  if (view === 'timetable') {
    /* 탭으로 들어온 화면에는 돌아갈 곳이 없다 — 화살표도 "전체 시간표"라는
       제목도 붙이지 않는다. 어느 노선인지는 표마다 머리에 적혀 있다.
       사이드바(데스크톱)에서는 여전히 목록에서 들어오므로 남긴다. */
    let h = (sheet.isMobile() ? '' : `<div class="sec-title view-head">
        <button type="button" class="back" id="ttBack" aria-label="${T.back}">←</button>
        ${T.allTimetable}
      </div>`) + timetableView(t);
    h += `<div class="source">${sourceNote()}</div>`;
    setPanel(h);
    drawFilters();
    const back = $('ttBack');
    if (back) back.onclick = () => { view = 'stops'; sheet.raise(1); render(); };
    $('panelScroll').querySelectorAll('.period button').forEach(el => el.onclick = () => {
      focusPeriod = el.dataset.p; drawRoutes(); drawStops(); render();
    });
    return;
  }

  /* 오늘 안 다니는 날에도 그냥 "주말입니다" 로 끝내지 않는다 — 그때 알고
     싶은 것은 "그럼 언제 다니나" 다. 아래 도착 목록이 다음 운행일 첫차를
     들고 오므로 그대로 흘려보낸다. 다만 가까운 정류장을 모르면(위치 없음)
     보여 줄 것이 없으니 그때만 사유를 적는다. */
  const day = today();
  if (!best) {
    const quiet = day.runs ? T.notRunning
      : (day.why === 'weekend' ? T.noWeekend : T.noHoliday(day.name));
    setHero(el, `<span class="hero-quiet">${quiet}</span>`, () => sheet.goto(1), quiet);
    return;
  }

  const a = arrivalsForGroup(best.g.name, t)[0];
  const html = a
    ? `<span class="badge" style="background:${a.route.color}">${badge(a.route)}</span>
       <span class="hero-stop">${stopLabel(best.g.name)}</span>
       <span class="hero-walk">${T.walkShort(best.w.min)}</span>
       <span class="hero-eta">
         <b class="${a.eta <= 3 && !a.day ? 'soon' : ''} ${!a.day && isDue(a.eta) ? 'due' : ''}">${
           a.day ? dayLabel(a.day) + ' ' + fmt(a.at) : (a.eta >= FAR_MIN ? fmt(a.at) : etaText(a.eta))}</b>
         ${a.day || a.eta >= FAR_MIN || isDue(a.eta) ? '' : `<span class="at">${fmt(a.at)}</span>`}
       </span>`
    : `<span class="hero-quiet">${T.notRunning}</span><span class="hero-chev" aria-hidden="true">▲</span>`;
  const label = a
    ? T.heroLabel(stopLabel(best.g.name), best.w.min, routeLabel(a.route),
                  a.day ? dayLabel(a.day) + ' ' + fmt(a.at)
                        : (a.eta >= FAR_MIN ? fmt(a.at) : etaText(a.eta)))
    : T.notRunning;
  setHero(el, html, () => { selectStop(best.g.name, true); sheet.goto(1); }, label);
}

/* 아래 탭. 시트를 끌어 올려야 나오던 것들을 여기로 꺼냈다.
   끌어야만 볼 수 있는 내용은 원래 하나도 없었고, 드래그는 지도를 얼마나
   볼지만 바꿨다. 이제는 탭이 높이를 정한다. */
let tab = 'near';
/* 탭 표시만 맞춘다. setTab 안에서 openTrip·showTimetable 을 부르고
   그쪽에서 다시 setTab 을 부르면 서로를 되부른다. */
function syncTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}
function setTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  // 다른 탭으로 가면 길찾기와 시간표는 접는다
  if (name !== 'trip' && $('trip').classList.contains('show')) openTrip(false);
  if (name !== 'timetable' && view === 'timetable') view = 'stops';

  if (name === 'trip') { openTrip(true); return; }
  if (name === 'timetable') { showTimetable(); return; }
  if (name === 'routes') {
    sheet.goto(1);
  } else {
    // 주변은 지도가 주인공이다 — hero 한 줄만 남기고 물러난다
    selected = null; selectedBus = null;
    focusGroup = null; focusPeriod = null;
    sheet.goto(0);
  }
  drawFilters(); drawRoutes(); drawStops(); render();
}
for (const b of document.querySelectorAll('.tab')) {
  b.onclick = () => setTab(b.dataset.tab);
}

function showTimetable() {
  view = 'timetable';
  syncTab('timetable');
  if (!focusPeriod) focusPeriod = nowMin() < 12 * 60 ? '오전' : '오후';
  sheet.goto(2);
  render();
}

function render() {
  const t = nowMin();
  // 노선 칩은 '노선' 탭의 것이다 (안내 중에는 어느 탭이든 필요 없다)
  // 노선 칩은 '노선'과 '시간표' 탭의 것이다. 시간표는 길어서 노선을 고를
  // 수 있어야 하고, 주변 탭에서는 지도를 가릴 이유가 없다.
  $('filters').hidden = guiding()
    || (sheet.isMobile() && tab !== 'routes' && tab !== 'timetable');
  const live = drawBuses(t);
  const running = live.length;

  // 콜론을 깜빡여 지금 시각임을 드러낸다. 시각을 옮겨 둔 상태에서는 멈춘다.
  // 매초 다시 만들면 애니메이션이 리셋되므로 숫자만 갈아 끼운다.
  const [hh, mm] = fmt(t).split(':');
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
    // 길찾기로 화면을 채우는 모바일에서만 노선 칩을 접는다
    if (sheet.isMobile()) $('filters').hidden = true;
    document.body.classList.remove('trip-empty');
    if (tripPlans.length) {
      /* "추천 경로" 라는 제목은 두지 않는다 — 출발·도착을 찍고 나온 목록이
         그것 말고 무엇일 수가 없다. 제목 한 줄이 항목 하나를 밀어낸다. */
      html += tripPlans.map(planCard).join('');
      setPanel(html);
      $('panelScroll').querySelectorAll('.itin').forEach(el => el.onclick = () => {
        planIdx = +el.dataset.plan;
        drawPlan(tripPlans[planIdx]);
        render();                        // 고른 것만 펼쳐 다시 그린다
      });
      return;
    }
    if (tripFrom && tripTo) {
      setPanel(`<div class="notice warn">${T.noRoute}</div>`);
      return;
    }
    /* 아직 출발·도착을 안 찍었을 때. 모바일에서는 길찾기가 화면을 통째로
       차지하므로 시트를 비운다 — 아래쪽 "곧 도착하는 버스" 목록이 거기
       있을 자리가 아니다. 데스크톱은 다르다. 사이드바에서는 길찾기 폼이
       늘 펴져 있고 그 아래가 본래 목록 자리다. 여기서 비우면 정류장을
       골라도 아무것도 안 나온다. */
    if (sheet.isMobile()) { document.body.classList.add('trip-empty'); setPanel(''); return; }
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
    /* "선택한 정류장" 이라는 제목은 두지 않는다 — 카드가 맨 위에 있고,
       지도에는 붉은 테두리와 물방울이 그 자리를 가리키고 있다. */
    html += stopCard(selected, t, g ? walkTo(g) : null);
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

  if (view === 'timetable') {
    let h = `<div class="sec-title view-head">
        <button type="button" class="back" id="ttBack" aria-label="${T.back}">←</button>
        ${T.allTimetable}
      </div>` + timetableView(t);
    h += `<div class="source">${sourceNote()}</div>`;
    setPanel(h);
    drawFilters();
    const back = $('ttBack');
    if (back) back.onclick = () => { view = 'stops'; sheet.raise(1); render(); };
    $('panelScroll').querySelectorAll('.period button').forEach(el => el.onclick = () => {
      focusPeriod = el.dataset.p; drawRoutes(); drawStops(); render();
    });
    return;
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
    ${sheet.isMobile() ? '' : `<button type="button" id="lnkTimetable2">${T.allTimetable}</button>`}
    ${canInstall() ? `<button type="button" id="lnkInstall">${T.installApp}</button>` : ''}
    <span class="lang" role="group" aria-label="Language">
      <button type="button" id="langKo" class="${LANG === 'ko' ? 'on' : ''}"
              aria-pressed="${LANG === 'ko'}" lang="ko">한국어</button
      ><button type="button" id="langEn" class="${LANG === 'en' ? 'on' : ''}"
              aria-pressed="${LANG === 'en'}" lang="en">English</button>
    </span>
  </div>`;

  drawHero(t, walks, walkTo);
  setPanel(html);
  $('panelScroll').querySelectorAll('.stop').forEach(el =>
    el.onclick = () => selectStop(el.dataset.stop, true));
  // 고른 정류장 카드의 출발·도착
  $('panelScroll').querySelectorAll('.pa.card button').forEach(el => el.onclick = () => {
    const n = el.dataset.stop;
    setEndpoint(el.dataset.w, { ll: groupOfStop(n)?.ll || STOPS[n], label: stopLabel(n) });
  });
  sheet.refit();
  bindLangButtons();
  const tt = $('lnkTimetable2');
  if (tt) tt.onclick = showTimetable;
  const ins = $('lnkInstall');
  if (ins) ins.onclick = install;

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
$('installYes').onclick = install;
$('installNo').onclick = dismissNudge;
for (const id of ['ask', 'pickHint', 'updateHint', 'editbar', 'installBar', 'tripTop']) {
  const el = $(id);
  if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); }
}
if ($('lnkTimetable')) $('lnkTimetable').onclick = showTimetable;

/* Esc 로 지금 열려 있는 것을 닫는다 */
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('ask').hidden) { closeAsk(); return; }
  if (pickingFor) { endPick(); return; }
  if (map._popup) { map.closePopup(); return; }
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
      m, ascent: Math.round(tr.ascent), coords: tr.coords,
      crossings: tr.crossings, signals: tr.signals,
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

/* 길찾기 폼의 자리. 데스크톱은 사이드바 안, 모바일은 화면 위다.
   한 벌만 두고 옮겨 단다 — 두 벌이면 값과 포커스가 따로 논다. */
function placeTrip() {
  const el = $('trip'), top = $('tripTop');
  const mob = !wideScreen();
  const target = mob ? top : $('panel');
  if (el.parentElement !== target) {
    if (mob) target.appendChild(el);
    else target.insertBefore(el, $('filters'));
  }
  const showing = el.classList.contains('show');
  top.hidden = !(mob && showing);
  // 상단이 겹친다. 길찾기 중에는 설치 안내를 물린다.
  document.body.classList.toggle('trip-top-on', mob && showing);
}

function openTrip(on, suggest = true) {
  // 데스크톱 사이드바에서는 길찾기를 닫지 않는다
  const show = wideScreen() ? true : (on ?? !$('trip').classList.contains('show'));
  $('trip').classList.toggle('show', show);
  showWhen(show);
  placeTrip();
  syncTab(show ? 'trip' : (view === 'timetable' ? 'timetable' : 'near'));
  $('btnRoute').classList.toggle('on', show);
  $('btnRoute').setAttribute('aria-expanded', String(show));
  // 닫으면 첫 화면 상태(접힘)로 돌아간다. 고른 정류장이 있으면 그것만 보이게 절반.
  /* 폼이 위로 빠졌으니 시트에는 결과만 남는다. 아직 결과가 없을 때는
     내려 두어 지도를 보여 준다 — 결과가 나오면 runTrip 이 올린다. */
  sheet.goto(show ? (wideScreen() ? 2 : 0) : (selected ? 1 : 0));
  if (!show) document.body.classList.remove('trip-empty');
  if (!show || on === false) {
    tripFrom = tripTo = null; tripPlans = []; layerTrip.clearLayers(); layerEnds.clearLayers();
    $('suggest').innerHTML = ''; $('inFrom').value = $('inTo').value = '';
    collapseForm(false); simMinutes = null; whenLabel();
    tripXings = []; drawCrossings(tripXings); drawRoutes(); drawStops();
  } else {
    /* 출발지는 대개 내 위치다. 알고 있으면 채워 두고 커서를 도착지로 보낸다.
       아직 모르면 그때 물어본다 — 잡히면 setMyLocation 이 채우고 커서도
       도착으로 옮긴다. 여기까지 온 사람은 어딘가로 가려는 참이다. */
    if (myLL && !tripFrom) { tripFrom = { ll: myLL, label: T.here }; $('inFrom').value = T.here; }
    else if (!myLL && suggest) requestLocation();
    activeField = tripFrom ? 'to' : 'from';
    if (suggest) focusEmptyField();
  }
  render();
}
$('btnRoute').onclick = () => openTrip();
$('tripClose').onclick = () => setTab('near');


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
    .sort((a, b) => a.at - b.at || (a.kind === 'stop' ? -1 : 1) || (a.d ?? 0) - (b.d ?? 0));
}

/* 아직 아무것도 입력하지 않았을 때 — 최근에 간 곳, 그다음 가까운 정류장.
   단 출발지를 고르는 중이라면 가장 가까운 정류장이 맨 위다. 거기서 타는
   것이 거의 언제나 답이기 때문이다. 도착지에서는 반대다 — 지금 서 있는
   자리로 가려는 사람은 없다. */
/* 같은 자리인지는 좌표로 가린다. 최근 목록은 눌렀을 때의 '표시 이름'을
   적어 두는데, 정류장 목록은 원래 이름으로 걸러서 서로를 못 알아봤다 —
   영문에서는 Mueunjae Intersection 과 무은재삼거리 가 다른 말이라 무은재가
   최근과 정류장으로 두 번 떴다. 언어를 바꿔도 좌표는 그대로다. */
const posKey = ll => (ll ? ll[0].toFixed(5) + ',' + ll[1].toFixed(5) : '');

function emptyState(near, field = activeField) {
  const seen = new Set();
  const stopAt = new Map(STOP_LIST.map(s => [posKey(s.ll), s.name]));
  /* 지도 앱들이 이 자리에 두는 두 가지. 내 위치는 출발 칸 옆 ◎ 로만 닿을 수
     있었고(도착 칸에는 길이 없었다), 지도에서 찍기는 길게 누르기뿐이라
     알려 주는 데가 없었다. */
  /* 반대쪽이 이미 내 위치면 이쪽에 또 내밀지 않는다 — 있는 자리에서
     있는 자리로 가는 길을 찾을 일은 없다. */
  const other = field === 'from' ? tripTo : tripFrom;
  const out = [];
  if (other?.label !== T.here) out.push({ kind: 'here', label: T.here, ll: myLL });
  out.push({ kind: 'pick', label: T.pickOnMap });
  const stops = STOP_LIST
    .map(s => ({ name: s.name, label: stopLabel(s.name), ll: s.ll, kind: 'stop',
                 d: near ? dist(near, s.ll) : null }));
  if (near) stops.sort((a, b) => a.d - b.d);

  if (field === 'from' && near && stops.length) {
    out.push(stops[0]);
    seen.add(posKey(stops[0].ll));
  }
  for (const r of recents) {
    const k = posKey(r.ll);
    if (seen.has(k)) continue;
    seen.add(k);
    // 정류장이면 지금 언어의 이름으로 보여 준다 (적어 둘 때의 이름이 아니라)
    const at = stopAt.get(k);
    out.push({ name: r.name, label: at ? stopLabel(at) : r.name, ll: r.ll, kind: 'recent',
               d: near ? dist(near, r.ll) : null });
  }
  /* 자르지 않는다. 아무것도 치지 않고 목록만 훑어 고르는 사람에게는
     여기 없는 곳은 없는 곳이다. 목록은 어차피 세로로 스크롤한다. */
  for (const s of stops) if (!seen.has(posKey(s.ll))) { seen.add(posKey(s.ll)); out.push(s); }
  const rest = places()
    .filter(p => p.kind !== 'stop' && !seen.has(posKey(p.ll)))
    .map(p => ({ ...p, label: p.label || p.name, d: near ? dist(near, p.ll) : null }));
  if (near) rest.sort((a, b) => a.d - b.d);
  return out.concat(rest);
}

function drawSuggest(list) {
  $('suggest').innerHTML = list.map((p, i) => `
    <div class="sug ${p.kind === 'here' || p.kind === 'pick' ? 'sug-act' : ''}"
         data-i="${i}" role="option" tabindex="0" aria-selected="false">
      ${p.kind === 'here' ? '<svg class="sug-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2"/></svg>' : ''}
      ${p.kind === 'pick' ? '<svg class="sug-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.2s7-5.9 7-11.2a7 7 0 1 0-14 0c0 5.3 7 11.2 7 11.2Z"/><circle cx="12" cy="12" r="2.6"/></svg>' : ''}
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
    if (p.kind === 'pick') { $('suggest').innerHTML = ''; pickOnMap(activeField); return; }
    if (p.kind === 'here' && !p.ll) { $('suggest').innerHTML = ''; requestLocation(); return; }
    const picked = { ll: p.ll, label: p.label };
    held = null;
    if (activeField === 'from') { tripFrom = picked; $('inFrom').value = p.label; }
    else                        { tripTo   = picked; $('inTo').value   = p.label; remember(picked); }
    $('suggest').innerHTML = '';
    if (!tripFrom || !tripTo) { focusEmptyField(); return; }
    runTrip();
    };
  });
}

/* 칸을 고치는 동안 잠시 물러나 있는 자리 */
let held = null;
for (const [id, field] of [['inFrom', 'from'], ['inTo', 'to']]) {
  $(id).addEventListener('input', e => { activeField = field; drawSuggest(search(e.target.value, myLL)); });
  $(id).addEventListener('focus', e => {
    activeField = field;
    if (pickingFor) endPick();         // 칸으로 돌아왔으면 지도에서 고르기는 그만이다
    /* 이 칸을 고치는 중이라는 뜻이다. 그 자리와 지난 경로는 지도에서 치운다 —
       바꾸는 중인 것이 남아 있으면 무엇이 지금 정해진 것인지 헷갈린다.
       반대쪽은 그대로 둔다. 고르지 않고 나가면 blur 에서 되돌린다. */
    held = { field, place: field === 'from' ? tripFrom : tripTo };
    if (field === 'from') tripFrom = null; else tripTo = null;
    tripPlans = [];
    layerTrip.clearLayers();
    tripXings = []; drawCrossings(tripXings);
    drawEnds();
    /* "내 위치" 는 우리가 채워 넣은 것이지 사용자가 친 것이 아니다. 다른 데를
       고르려고 누른 것이니 비켜 준다 — 안 그러면 지우고 시작해야 한다. */
    if (e.target.value === T.here) e.target.value = '';
    drawSuggest(search(e.target.value, myLL));
    render();
  });
  $(id).addEventListener('blur', () => setTimeout(() => {
    if ($('trip').contains(document.activeElement)) return;
    $('suggest').innerHTML = '';
    /* 고르지 않고 나갔으면 원래대로 돌려놓는다 — 잠깐 눌렀다고 지워질 일은
       아니다. 새로 골랐으면 held 는 이미 비워져 있다. */
    if (held && held.field === field) {
      const cur = field === 'from' ? tripFrom : tripTo;
      if (!cur && held.place) {
        if (field === 'from') tripFrom = held.place; else tripTo = held.place;
        $(id).value = held.place.label;
        held = null;
        runTrip();
        return;
      }
      held = null;
    }
    // 출발지를 빈 채로 두고 나갔으면 원래대로 (지도에서 고르는 중이면 아니다)
    if (field === 'from' && !pickingFor && !tripFrom && !$('inFrom').value && myLL) {
      tripFrom = { ll: myLL, label: T.here };
      $('inFrom').value = T.here;
      runTrip();
    }
  }, 150));
}
/* 출발 시각 — 기본은 지금. 눌러야 시각 입력이 나온다.
   도착 기준으로 바꾸면 "그 시각 전에 도착"하는 경로를 찾는다. */
function whenLabel() {
  /* 시계는 아이콘 하나뿐이라, 시각을 바꿔 두면 그 사실이 보이지 않는다.
     설정한 시각을 배지로 붙이고 버튼을 채운다. */
  /* 배지를 늘 띄운다. 시계만 있으면 무엇을 하는 버튼인지 알기 어렵고,
     "지금" 이라고 적혀 있으면 시각을 다루는 자리라는 것과 지금은 현재
     시각 기준이라는 것을 한 번에 말한다. 정해 두면 그 시각으로 바뀐다. */
  const set = simMinutes !== null;
  const tag = $('clockTag');
  tag.hidden = false;
  tag.textContent = set ? fmt(simMinutes) : T.now;
  tag.classList.toggle('set', set);
  $('btnClock').classList.toggle('on', set);
  $('btnNow').hidden = !set;
  // 아이콘만으로는 출발 기준인지 도착 기준인지 알 수 없다
  $('btnClock').setAttribute('aria-label',
    set ? T.departAt(fmt(simMinutes)) : T.whenTitle);
}
/* 시각 조정은 길찾기 중에만 뜻이 있다 */
function showWhen(on) { $('whenBtns').hidden = !on; }
/* 시계를 누르면 시각 고르는 창이 바로 열린다. 예전에는 팝오버를 한 번
   거쳐야 해서 두 번 눌러야 했다 — 그 사이에 있던 것은 "지금 출발" 이라는
   현재 상태뿐이었고, 그건 시계 배지가 이미 말하고 있다. */
$('btnClock').onclick = () => {
  const el = $('whenTime');
  el.value = fmt(Math.round(simMinutes ?? nowMin()));
  el.focus();
  el.showPicker?.();
};

$('whenTime').onchange = e => {
  simMinutes = e.target.value ? toMin(e.target.value) : null;
  whenLabel(); runTrip(); render();
};
$('btnNow').onclick = () => {
  simMinutes = null;
  whenLabel(); runTrip(); render();
};

$('btnSwap').onclick = () => {
  if (pickingFor) endPick();
  [tripFrom, tripTo] = [tripTo, tripFrom];
  $('inFrom').value = tripFrom?.label || '';
  $('inTo').value = tripTo?.label || '';
  if (tripFrom && tripTo) runTrip(); else { collapseForm(false); render(); }
};

function collapseForm(on) {
  $('trip').classList.toggle('done', on);
  $('tripSummary').hidden = !on;
  if (!on) return;
  const end = (which, label) =>
    `<button type="button" class="ts-end" data-end="${which}"
             aria-label="${which === 'from' ? T.editFrom : T.editTo}">
       <span class="pin ${which}" aria-hidden="true"></span><span>${label}</span>
     </button>`;
  $('tripSummary').innerHTML =
    end('from', tripFrom.label)
    + `<span class="arrow" aria-hidden="true">→</span>`
    + end('to', tripTo.label)
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
  /* 지도에서 자리를 고르는 중에 정류장을 누르거나 목록에서 골랐다는 것은
     고르기를 그만두겠다는 뜻이다. 커서와 안내 띠를 남겨 두면 무엇을 하는
     중인지 알 수 없다. ('여기로' 는 이미 스스로 끝내고 들어온다) */
  if (pickingFor) endPick();
  // openTrip 이 먼저 포커스를 잡아 버리므로 제안 목록은 여기서 직접 그린다
  if (!$('trip').classList.contains('show')) openTrip(true, false);
  if (which === 'from') { tripFrom = place; $('inFrom').value = place.label; }
  else                  { tripTo = place;   $('inTo').value = place.label; remember(place); }
  map.closePopup();
  held = null;                         // 새로 골랐으니 되돌릴 것이 없다
  drawEnds();                          // 한쪽만 찍혀도 그 자리는 바로 세운다
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

/* autoPan: 정류장을 눌러서 뜨는 경우는 selectStop 이 이미 보이는 가운데로
   옮기므로 끈다 — 켜 두면 둘이 서로 지도를 끌어당긴다. 지도를 길게 눌러
   띄우는 경우에는 옮겨 주는 것이 없으니 켠다. */
function pointActions(ll, label, autoPan = true) {
  const id = 'pa' + Math.random().toString(36).slice(2, 8);
  L.popup({
    /* 늘 마커 위에 세운다. 정류장 점은 고르면 21px 로 커지므로 그만큼 띄운다. */
    closeButton: false, className: 'pa-popup', anchor: 'bottom', offset: [0, -14],
    autoPan, maxWidth: 240,
    // 표지가 시트·탭 뒤로 들어가지 않도록 가려지는 만큼 비워 둔다
    autoPanPaddingTopLeft: L.point(14, topInset() + 14),
    autoPanPaddingBottomRight: L.point(14, sheetHeight() + 14),
  })
    .setLatLng(ll)
    /* 이름은 넣지 않는다. 표지가 그 정류장을 가리키고 있고 지도에도
       이름이 붙어 있어서, 여기 또 적으면 같은 말이 두 번이다. 게다가
       길면 잘렸다 — 잘린 이름은 없느니만 못하다. 이름이 빠지니 표지가
       좁아져서 지도 끝 정류장(효자시장·유강사거리)에서도 잘리지 않는다. */
    .setContent(
      `<div class="pa" role="group" aria-label="${label}">
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
  drawEnds();                          // 한쪽만 찍혀 있어도 그 자리는 보여 준다
  if (!tripFrom || !tripTo) { tripPlans = []; collapseForm(false); layerTrip.clearLayers(); render(); return; }
  const t = nowMin();
  /* 지도에서 한 노선만 보고 있다고 해서 그 노선으로만 길을 찾으면 안 된다.
     isOn 은 화면에 무엇을 그릴지 고르는 것이지 어느 차를 탈 수 있는지가
     아니다 — 유강을 켜 둔 채 길찾기를 하면 순환이 통째로 사라졌다. */
  const ctx = { ROUTES, STOP_LIST, isOn: () => true, walk: walkNet };
  // 기한이 이미 지났으면 다음 운행일로 본다 (시간표가 하루치뿐이다)
  planIdx = 0;                         // 새 결과는 첫 안을 펼친다
  tripPlans = planTripSeries(tripFrom, tripTo, t, ctx);
  /* 플래너는 요일을 보지 않는다 — 시간표만 본다. 그래서 주말·공휴일에도
     오늘 버스가 있는 것처럼 내놓는다. 시간표는 어느 운행일이든 같으므로
     답 자체는 맞지만, 그것이 '오늘' 이 아니라는 말은 해야 한다. */
  if (!today().runs) for (const p of tripPlans) {
    if (p.legs.some(l => l.kind === 'ride')) p.nextDay = true;
  }
  drawEnds();
  // 시트를 먼저 낮춰야 지도에 맞출 때 가려지는 높이를 제대로 계산한다
  collapseForm(tripPlans.length > 0);
  if (tripPlans.length) sheet.goto(1);   // 목록을 세로로 쌓아 보여 준다
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
  drawCrossings(tripXings);
  if (pts.length) fitWithSheet(L.latLngBounds(pts), 50);
}

/* 출근·퇴근 전환. 그 시간대에 실제로 언제 출발하는지 함께 보여 준다. */
function periodSwitch(group = focusGroup) {
  const runs = p => ROUTES
    .filter(r => r.group === group && r.period === p)
    .map(r => fmt(r.tripsMin[0][0]))
    .sort();
  const btn = (p, label) =>
    `<button type="button" class="${focusPeriod === p ? 'on' : ''}"
             data-p="${p}" aria-pressed="${focusPeriod === p}">${label}</button>`;
  return `<div class="period">
    ${btn('오전', T.commuteAm)}${btn('오후', T.commutePm)}
    <span class="period-time">${T.departsAt(runs(focusPeriod || '오전').join(' · '))}</span>
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

/* 지금 펼쳐 놓은 항목 */
let planIdx = 0;

/* 한 줄짜리 목록 항목. 세로로 쌓아 놓고 견주는 것이 목적이므로, 걸리는
   시간·구성·언제 출발하는지가 한눈에 들어와야 한다. 자세한 구간 설명은
   지도가 대신 한다 — 누르면 그 경로가 그려진다. */
function planCard(plan, i) {
  /* 정류장에서 기다리는 시간은 소요 시간이 아니다. 실제로 나가야 하는
     시각을 기준으로 잡는다. */
  const leave = plan.leave ?? plan.depart;
  const dur = Math.round(plan.arrive - leave);
  const rides = plan.legs.filter(l => l.kind === 'ride');
  // 구성: 걷기 분 · 노선 배지 를 순서대로
  const chips = plan.legs.map(l => l.kind === 'walk'
    ? `<span class="lc walk"><svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/></svg>${T.min(Math.round(l.min))}</span>`
    : `<span class="lc" style="background:${l.route.color}">${badge(l.route)}</span>`).join('');
  // 언제 타나 — 첫 승차의 정류장과 시각. 걷기만이면 그럴 것이 없다.
  const first = rides[0];
  const sub = first
    ? `${fmt(leave)} → ${fmt(plan.arrive)} · ${T.boardAt(shortLabel(stopLabel(first.from)), fmt(first.depart))}`
    : `${fmt(leave)} → ${fmt(plan.arrive)} · ${T.walkOnly}`;
  // 다음 운행일 것은 지금 탈 수 있는 것과 섞이지 않게 따로 표시한다
  const day = plan.nextDay ? dayLabel(nextServiceDay()?.days || 1) : '';
  /* 고른 것만 구간을 펼친다. 칩은 견주기에는 좋지만 어디서 내리는지를
     말해 주지 않는다 — 그렇다고 모두 펼치면 다시 긴 목록이 된다. */
  const open = i === planIdx;
  const legs = !open ? '' : `<div class="itin-legs-detail">` + plan.legs.map(l => l.kind === 'walk'
    ? `<div class="leg"><span class="lc walk"><svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/></svg>${T.min(Math.round(l.min))}</span>
         <span class="txt">${T.walkTo(stopLabel(l.to), l.min)}</span></div>`
    : `<div class="leg"><span class="lc" style="background:${l.route.color}">${badge(l.route)}</span>
         <span class="txt"><b>${stopLabel(l.from)}</b> ${fmt(l.depart)}
           → <b>${stopLabel(l.to)}</b> ${fmt(l.arrive)}</span></div>`).join('') + `</div>`;
  /* 점선 카드도 고르면 골랐다고 보여야 한다. 다만 '추천' 테두리(best)를
     그대로 쓰면 다음날·이따 것이 지금 탈 것처럼 읽히므로 따로 둔다. */
  const later = !!day || !!plan.later;
  return `
    <button type="button" class="itin ${open ? (later ? 'on' : 'best') : ''} ${later ? 'later' : ''}"
            data-plan="${i}" aria-pressed="${open}">
      <div class="itin-main">
        <span class="itin-dur">${T.min(dur)}</span>
        <span class="itin-legs">${chips}</span>
        ${day ? `<span class="itin-day">${day}</span>` : ''}
      </div>
      <div class="itin-sub">${sub}</div>
      ${legs}
    </button>`;
}


/* ================================================================== *
 * 바텀시트 (모바일)
 * ================================================================== */
const sheet = (() => {
  const el = $('panel'), grab = $('grab');
  const isMobile = () => window.matchMedia('(max-width:820px)').matches;
  /* 키보드가 올라오면 쓸 수 있는 높이가 줄어든다. innerHeight 로 재면 iOS 는
     그대로라서, 88% 로 잡은 시트가 화면 아래로 넘쳐 버린다. 실제로 보이는
     영역(visualViewport)을 기준으로 잰다. */
  const vv = window.visualViewport;
  const vh = () => Math.round(vv ? vv.height : window.innerHeight);
  const kb = () => vv
    ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    : 0;
  /* 세 높이는 이제 탭이 정한다 — 끌어서 맞추는 것이 아니다.
     맨 아래는 hero 한 줄만큼. 그게 이 앱의 기본 답이다. */
  /* 접힌 높이는 "가장 가까운 정류장 한 줄이 보이는" 만큼이다. 손잡이와
     시트 위 여백까지 세야 그 줄이 실제로 드러난다 — 예전에는 hero 높이만
     보고 76px 을 잡아, 손잡이에 밀려 줄이 통째로 잠겼다. */
  /* 접힌 높이는 "가장 가까운 정류장 한 줄이 다 보이는" 만큼이다. 손잡이
     높이와 시트 여백을 더해 짐작하지 말고, hero 가 실제로 앉은 자리를
     레이아웃에서 잰다 — offsetTop 이 여백과 손잡이를 이미 셈하고 있다. */
  const peek = () => {
    const h = $('hero');
    // hero 가 없거나 숨었으면 보여 줄 것이 없다 — 손잡이만 남긴다
    if (!h || h.hidden || !h.offsetHeight) return (grab.offsetHeight || 22) + 12;
    return Math.round(h.offsetTop + h.offsetHeight + 10);
  };
  const snaps = () => [peek(), Math.round(vh() * 0.46), Math.round(vh() * 0.88)];
  let cur = 0;

  function apply(px, animate = true) {
    el.classList.toggle('dragging', !animate);
    // dvh 와 innerHeight 가 어긋나는 브라우저가 있어 높이를 전부 px 로 통일한다
    sheetHCache.at = -1e9;               // 높이가 달라졌다
    const root = document.documentElement.style;
    root.setProperty('--kb', kb() + 'px');
    /* 탭바 높이는 안전영역만큼 기기마다 다르다 — 재서 쓴다.
       숨겨져 있으면 offsetHeight 가 0 이므로 `|| 58` 같은 대비책을 두면
       안 된다. 길찾기 중에는 실제로 0 이 맞다. */
    /* offsetParent 로 "보이나" 를 물으면 안 된다 — position:fixed 요소는
       규격상 offsetParent 가 늘 null 이라 언제나 "안 보임" 으로 읽힌다.
       그래서 --tabs-h 가 0 이 되고 시트가 탭바 뒤에 깔려, 접었을 때 손잡이만
       삐져나왔다. 실제로 자리를 차지하는지는 높이로 묻는다. */
    const tb = $('tabs');
    const th = tb ? tb.getBoundingClientRect().height : 0;
    root.setProperty('--tabs-h', (isMobile() ? th : 0) + 'px');
    root.setProperty('--sheet-max', Math.round(vh() * 0.88) + 'px');
    root.setProperty('--sheet', Math.round(px) + 'px');
    // 스크롤 영역을 보이는 만큼으로 자르려면 손잡이가 얼마나 먹는지 알아야 한다
    root.setProperty('--grab-h', Math.round(grab.getBoundingClientRect().height) + 'px');
  }
  function goto(i, animate = true) {
    cur = Math.max(0, Math.min(2, i));
    apply(snaps()[cur], animate);
    // 시트를 끝까지 올리면 지도가 거의 가려진다. 버튼 열이 겹치므로 감춘다.
    document.body.classList.toggle('sheet-full', isMobile() && cur === 2);
    grab.setAttribute('aria-expanded', String(cur > 0));
    grab.setAttribute('aria-label', cur === 0 ? T.sheetOpen : T.sheetClose);
    return cur;
  }
  function height() { return isMobile() ? snaps()[cur] : 0; }

  /* --- 손잡이 --- *
   * 높이는 탭이 정하지만, 접고 펴는 것은 손으로 해야 한다. 탭만 두었더니
   * 정류장을 고른 뒤 시트를 내릴 방법이 없었다. */
  let startY = 0, startPx = 0, dragging = false, fromList = false;
  const onDown = (e, list) => {
    if (!isMobile()) return;
    dragging = true; fromList = !!list;
    startY = (e.touches ? e.touches[0] : e).clientY;
    startPx = snaps()[cur];
    el.classList.add('dragging');
  };
  const onMove = e => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0] : e).clientY;
    /* 목록 위에서 시작해 손가락을 올리는 것은 "목록을 넘기겠다" 는 뜻이다.
       그것까지 시트 끌기로 삼으면 목록이 아예 안 넘어간다. */
    if (fromList && y < startY) { dragging = false; el.classList.remove('dragging'); return; }
    e.preventDefault();
    apply(Math.max(60, Math.min(vh() * 0.88, startPx + (startY - y))), false);
  };
  const onUp = e => {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    const y = (e.changedTouches ? e.changedTouches[0] : e).clientY;
    const px = startPx + (startY - y);
    const s = snaps();
    let bi = 0;                                  // 가장 가까운 자리로
    s.forEach((v, i) => { if (Math.abs(v - px) < Math.abs(s[bi] - px)) bi = i; });
    goto(bi);
  };
  grab.addEventListener('touchstart', onDown, { passive: true });
  grab.addEventListener('mousedown', onDown);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchend', onUp);
  window.addEventListener('mouseup', onUp);
  grab.addEventListener('click', () => { if (isMobile()) goto(cur === 2 ? 0 : cur + 1); });
  grab.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); goto(cur + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); goto(cur - 1); }
  });
  /* 목록을 맨 위까지 올렸을 때만 시트를 끌어내린다 */
  $('panelScroll').addEventListener('touchstart', e => {
    if (!isMobile() || $('panelScroll').scrollTop > 0) return;
    onDown(e, true);
  }, { passive: true });

  const reflow = () => { if (isMobile()) apply(snaps()[cur], false); };
  window.addEventListener('resize', reflow);
  // 키보드가 뜨고 지는 것은 resize 로 오지 않는 브라우저가 있다
  vv?.addEventListener('resize', reflow);
  vv?.addEventListener('scroll', reflow);
  if (isMobile()) goto(0, false);
  const raise = i => { if (isMobile() && cur < i) goto(i); };
  /* hero 는 render 뒤에야 제 높이를 갖는다. 접혀 있을 때만 다시 맞춘다 —
     올라가 있을 때 건드리면 스크롤 중에 시트가 흔들린다. */
  const refit = () => { if (isMobile() && cur === 0) apply(peek(), false); };
  return { goto, raise, height, isMobile, refit, relabel: () => goto(cur, false) };
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
placeTrip();
addEventListener('resize', placeTrip);
// 데스크톱은 폼만 펴 두고 제안 목록은 입력칸을 누를 때 띄운다
if (wideScreen()) openTrip(true, false);
drawFilters();
drawRoutes();
drawStops();
render();
// 처음에는 캠퍼스(순환노선)에 맞춘다 — 지곡·유강까지 넣으면 캠퍼스가 너무 작아진다
fitWithSheet(L.latLngBounds(
  ROUTES.filter(r => r.kind === 'circulation').flatMap(r => r.path.coords)), 24);
/* 옛 시간표 주소에서 넘어오면 바로 그 화면을 연다.
   sheet 가 만들어진 뒤여야 하므로 시작 블록에서 부른다. */
if (new URLSearchParams(location.search).get('view') === 'timetable') showTimetable();

/* 시각 표시와 남은 시간은 1초면 충분하다 */
setInterval(() => { if (simMinutes === null) render(); }, 1000);
/* 버스 자리는 매 프레임 다시 잰다. 자리는 시각의 함수라 그때그때 구하면
   되고(훑는 데 4µs, 60fps 로도 초당 0.25ms), 그래야 스르륵 움직인다.
   CSS 전환으로 흉내내면 지도를 끌 때 마커가 따라오지 못해 밀린다. */
(function moveBuses() {
  requestAnimationFrame(moveBuses);
  if (simMinutes === null) drawBuses(realNow());
})();

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
  // 아이콘 버튼이므로 글자를 넣지 않는다 (넣으면 아이콘이 사라진다)
  $('btnRoute').title = $('btnRoute').ariaLabel = T.route;
  set('lnkTimetable', T.timetable);
  // 출발·도착 딱지는 모양이다 — 글자를 넣으면 모양이 사라진다
  $('pinFrom').ariaLabel = T.from;
  $('pinTo').ariaLabel = T.to;
  set('editHint', T.editHint);
  set('btnCopy', T.copyJson);
  set('btnResetCoords', T.resetCoords);
  set('askNo', T.askNo);
  set('skipLink', T.skip);
  $('btnClock').title = T.whenTitle;
  $('btnNow').title = $('btnNow').ariaLabel = T.resetTime;   // 라벨은 whenLabel 이 시각까지 넣어 다시 쓴다
  $('tripClose').title = $('tripClose').ariaLabel = T.close;
  $('btnNow').title = $('btnNow').ariaLabel = T.resetTime;
  set('pickOk', T.pickHere);
  set('pickCancel', T.askNo);
  sheet.relabel();
  set('tabNear', T.tabNear); set('tabRoutes', T.tabRoutes);
  set('tabTimetable', T.tabTimetable); set('tabTrip', T.tabTrip);
  set('pickHintText', T.pickHint);
  set('installText', T.installNudge);
  set('installYes', T.installNow);
  paintInstallBar();
  set('updateText', T.updateReady);
  set('updateNow', T.reload);
  set('pickCancel', T.cancel);
  if (has('clock')) $('clock').setAttribute('aria-label', T.clockLabel('--', '--'));
  $('inFrom').placeholder = $('inFrom').ariaLabel = T.fromPh;
  $('inTo').placeholder = $('inTo').ariaLabel = T.toPh;
  $('btnSwap').title = $('btnSwap').ariaLabel = T.swap;
  $('btnLoc').title = T.myLocation;
  $('btnNorth').title = $('btnNorth').ariaLabel = T.northUp;
  applyHeading();
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

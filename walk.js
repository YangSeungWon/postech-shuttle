'use strict';

/* ------------------------------------------------------------------ *
 * OSM 보행 그래프 위의 경로탐색
 *
 * 캠퍼스 일대의 보도·이면도로·계단을 빌드 때 그래프로 구워 두고,
 * 브라우저에서 Dijkstra를 돌린다. 외부 경로탐색 API가 필요 없고
 * 직선거리 추정보다 훨씬 정확하다. (노드 5.5천 개 규모라 즉시 끝난다)
 * ------------------------------------------------------------------ */

/* 평지 기준 속도(km/h). Tobler 식을 이 값에 맞춰 정규화한다. */
const FLAT_KMH = 4.0;
/* Tobler 도보 함수 — 경사 S(=높이차/거리)에서의 속도(km/h).
   내리막이라고 무한정 빨라지지 않고, -5% 부근이 가장 빠르다. */
const toblerKmh = S => 6 * Math.exp(-3.5 * Math.abs(S + 0.05));
const TOBLER_NORM = FLAT_KMH / toblerKmh(0);
/* 신호 있는 건널목에서 기다리는 시간(분). 실시간 신호 주기는 받을 수 없으니
   평균값으로 잡는다 — 주기의 절반쯤이다. 0으로 두면 도보가 실제보다 짧게 나온다. */
const SIGNAL_WAIT = 0.5;

const WalkGraph = (() => {
  const W = DATA.walk;
  const N = W.nodes.length / 2;
  const lat = new Float64Array(N), lng = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lat[i] = W.lat0 + W.nodes[i * 2] / W.scale;
    lng[i] = W.lng0 + W.nodes[i * 2 + 1] / W.scale;
  }
  const ele = Float64Array.from(W.ele || new Array(N).fill(0));

  /* --- 인접 리스트를 CSR로 --- */
  const E = W.edges.length / 4;
  const deg = new Int32Array(N);
  for (let e = 0; e < E; e++) { deg[W.edges[e * 4]]++; deg[W.edges[e * 4 + 1]]++; }
  const head = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) head[i + 1] = head[i] + deg[i];
  // cost 는 '분'. 오르막·내리막이 다르므로 두 방향을 따로 담는다.
  const to = new Int32Array(E * 2), cost = new Float64Array(E * 2),
        meters = new Float64Array(E * 2), climb = new Float64Array(E * 2),
        xing = new Uint8Array(E * 2);            // 횡단보도 구간인가
  const fill = head.slice(0, N);
  const R = 6371000, D = Math.PI / 180;
  const metersBetween = (a, b) => {
    const dLat = (lat[b] - lat[a]) * D;
    const dLng = (lng[b] - lng[a]) * D * Math.cos((lat[a] + lat[b]) / 2 * D);
    return R * Math.hypot(dLat, dLng);
  };
  /* 구간마다 그 방향의 경사로 속도를 따로 구한다. 출발·도착 고도차만 보면
     "올라갔다 내려오는" 구간이 통째로 사라진다. */
  const MAX_SLOPE = 0.35;                      // DEM 잡음으로 튀는 값을 자른다
  const minutesFor = (m, dh, surface) => {
    if (m < 1) return 0;
    const S = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, dh / m));
    const kmh = toblerKmh(S) * TOBLER_NORM;
    return (m / 1000) / kmh * 60 * surface;
  };
  const isXing = new Map();                    // "a,b" → 횡단보도 여부
  for (let e = 0; e < E; e++) {
    const a = W.edges[e * 4], b = W.edges[e * 4 + 1],
          w = W.edges[e * 4 + 2] / 10, x = W.edges[e * 4 + 3];
    const m = metersBetween(a, b);
    const dh = ele[b] - ele[a];
    if (x) { isXing.set(a + ',' + b, x); isXing.set(b + ',' + a, x); }
    const wait = x === 2 ? SIGNAL_WAIT : 0;
    to[fill[a]] = b; meters[fill[a]] = m; xing[fill[a]] = x;
    cost[fill[a]] = minutesFor(m, dh, w) + wait; climb[fill[a]] = Math.max(0, dh); fill[a]++;
    to[fill[b]] = a; meters[fill[b]] = m; xing[fill[b]] = x;
    cost[fill[b]] = minutesFor(m, -dh, w) + wait; climb[fill[b]] = Math.max(0, -dh); fill[b]++;
  }

  /* --- 좌표 → 가장 가까운 그래프 노드 (격자 색인) --- */
  const CELL = 0.002;                                   // 약 200m
  const grid = new Map();
  const cellKey = (la, ln) => `${Math.floor(la / CELL)},${Math.floor(ln / CELL)}`;
  for (let i = 0; i < N; i++) {
    const k = cellKey(lat[i], lng[i]);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  function snap(ll) {
    const ci = Math.floor(ll[0] / CELL), cj = Math.floor(ll[1] / CELL);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {          // 없으면 범위를 넓혀 간다
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        for (const n of grid.get(`${i},${j}`) || []) {
          const dLat = (lat[n] - ll[0]) * D;
          const dLng = (lng[n] - ll[1]) * D * Math.cos(ll[0] * D);
          const d = R * Math.hypot(dLat, dLng);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return { node: best, offset: bestD };               // offset: 그래프까지 직선 접근거리
  }

  /* --- 이진 힙 Dijkstra --- */
  function dijkstra(src) {
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    dist[src] = 0;
    const hn = [src], hd = [0];                          // 간단한 이진 힙
    const push = (n, d) => {
      hn.push(n); hd.push(d);
      let i = hn.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p] <= hd[i]) break;
        [hn[p], hn[i]] = [hn[i], hn[p]]; [hd[p], hd[i]] = [hd[i], hd[p]]; i = p;
      }
    };
    const pop = () => {
      const n = hn[0], d = hd[0], last = hn.length - 1;
      hn[0] = hn[last]; hd[0] = hd[last]; hn.pop(); hd.pop();
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < hn.length && hd[l] < hd[s]) s = l;
        if (r < hn.length && hd[r] < hd[s]) s = r;
        if (s === i) break;
        [hn[s], hn[i]] = [hn[i], hn[s]]; [hd[s], hd[i]] = [hd[i], hd[s]]; i = s;
      }
      return [n, d];
    };
    while (hn.length) {
      const [n, d] = pop();
      if (d > dist[n]) continue;
      for (let k = head[n]; k < head[n + 1]; k++) {
        const m = to[k], nd = d + cost[k];
        if (nd < dist[m]) { dist[m] = nd; prev[m] = n; push(m, nd); }
      }
    }
    return { dist, prev };
  }

  /* --- prev 체인을 좌표열·거리·누적 오르막으로 --- */
  function trace(prev, dst) {
    const nodes = [];
    for (let n = dst; n >= 0; n = prev[n]) nodes.push(n);
    nodes.reverse();
    let m = 0, up = 0, signals = 0;
    const crossings = [];
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      m += metersBetween(a, b);
      up += Math.max(0, ele[b] - ele[a]);                     // 오른 만큼만 더한다
      const kind = isXing.get(a + ',' + b);
      if (kind) {
        crossings.push([[lat[a], lng[a]], [lat[b], lng[b]]]);
        if (kind === 2) signals++;
      }
    }
    return { coords: nodes.map(n => [lat[n], lng[n]]), meters: m, ascent: up, crossings, signals };
  }

  const cache = new Map();
  function from(ll) {                                    // 한 지점에서의 결과는 재사용
    const s = snap(ll);
    if (s.node < 0) return null;
    if (!cache.has(s.node)) {
      if (cache.size > 12) cache.clear();
      cache.set(s.node, dijkstra(s.node));
    }
    return { ...cache.get(s.node), src: s.node, offset: s.offset };
  }

  return { N, snap, from, trace, lat, lng, ele };
})();

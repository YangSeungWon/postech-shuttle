'use strict';

/* ------------------------------------------------------------------ *
 * 셔틀 길찾기 — 시간표 기반 최단 도착 시각 탐색
 *
 * 상용 대중교통 앱과 같은 방식입니다. 출발지에서 걸어갈 수 있는 모든
 * 정류장을 출발점으로 두고, "환승 n회 이하로 갈 수 있는 각 정류장의
 * 가장 이른 도착 시각"을 라운드마다 갱신합니다(RAPTOR 계열).
 * 도보 구간은 OSM 보행 그래프(walk.js)로 실제 경로를 계산합니다.
 * ------------------------------------------------------------------ */

const MAX_WALK_MIN = 20;      // 출발·도착 도보 허용 시간(분)
const XFER_WALK_MIN = 7;      // 정류장 간 도보 환승 허용 시간(분)
const MAX_ROUNDS = 3;         // 최대 환승 2회

/**
 * @param {{ll:number[], label:string}} from 출발지
 * @param {{ll:number[], label:string}} to   도착지
 * @param {number} depart 출발 가능 시각(분)
 * @param {object} ctx  { ROUTES, STOP_LIST, isOn, walk }
 *   walk.fromPoint(ll)  → [{min, m, coords}|null] 정류장별 도보
 *   walk.between(i, j)  → {min, m, coords}|null   정류장 간 도보
 *   walk.direct(a, b)   → {min, m, coords}|null   두 지점 직접 도보
 * @returns {object[]} 도착이 이른 순으로 정렬된 경로 후보
 */
function planTrip(from, to, depart, ctx) {
  const { ROUTES, STOP_LIST, isOn, walk } = ctx;
  const names = STOP_LIST.map(s => s.name);
  const ix = new Map(names.map((n, i) => [n, i]));

  const fromWalks = walk.fromPoint(from.ll);   // 출발지 → 각 정류장
  const toWalks   = walk.fromPoint(to.ll);     // 각 정류장 → 도착지 (도보는 대칭)

  /* 각 정류장의 (가장 이른 도착 시각, 오게 된 경위) */
  const best = names.map(() => ({ t: Infinity, via: null }));
  let reachable = 0;
  names.forEach((n, i) => {
    const w = fromWalks[i];
    if (!w || w.min > MAX_WALK_MIN) return;
    reachable++;
    best[i] = {
      t: depart + w.min,
      // 도보 결과(오르막·횡단보도 등)를 그대로 실어 보낸다
      via: { ...w, kind: 'walk', from: from.label, to: n,
             depart, arrive: depart + w.min },
    };
  });

  const results = [];
  const directWalk = walk.direct(from.ll, to.ll);
  if (directWalk && directWalk.min <= MAX_WALK_MIN * 2) {
    results.push({
      depart, arrive: depart + directWalk.min, transfers: 0, walkOnly: true,
      legs: [{ ...directWalk, kind: 'walk', from: from.label, to: to.label,
               depart, arrive: depart + directWalk.min }],
    });
  }
  if (!reachable) return finish(results);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const snapshot = best.map(b => ({ ...b }));
    let improved = false;

    /* --- 승차 --- */
    // 도착 시각은 시간표로 고정이므로, 탈 수 있는 첫 정류장에서 타는 것이
    // 그 이후 모든 정류장에 대해 항상 최선이다.
    for (const r of ROUTES) {
      if (!isOn(r)) continue;
      for (const trip of r.tripsMin) {
        let boardAt = -1;
        for (let k = 0; k < trip.length; k++) {
          const si = ix.get(r.canonStops[k]);
          if (si === undefined) continue;
          if (boardAt < 0) {
            if (snapshot[si].via && snapshot[si].t <= trip[k]) boardAt = k;
            continue;
          }
          if (trip[k] < best[si].t) {
            best[si] = {
              t: trip[k],
              via: {
                kind: 'ride', route: r,
                from: r.stops[boardAt], to: r.stops[k],
                fromIdx: boardAt, toIdx: k, stops: k - boardAt,
                depart: trip[boardAt], arrive: trip[k],
                wait: trip[boardAt] - snapshot[ix.get(r.canonStops[boardAt])].t,
                prev: snapshot[ix.get(r.canonStops[boardAt])].via,
              },
            };
            improved = true;
          }
        }
      }
    }

    /* --- 정류장 간 도보 환승 --- */
    for (let a = 0; a < names.length; a++) {
      // 하차 직후의 환승만 허용한다 — 도보만 계속 이어지는 경로는 의미가 없다
      if (snapshot[a].via?.kind !== 'ride') continue;
      for (let b = 0; b < names.length; b++) {
        if (a === b) continue;
        const w = walk.between(a, b);
        if (!w || w.min > XFER_WALK_MIN) continue;
        const t = snapshot[a].t + w.min;
        if (t < best[b].t) {
          best[b] = {
            t,
            via: { ...w, kind: 'walk', from: names[a], to: names[b],
                   depart: snapshot[a].t, arrive: t, prev: snapshot[a].via },
          };
          improved = true;
        }
      }
    }

    /* --- 하차 후 목적지까지 도보 --- */
    names.forEach((n, i) => {
      if (best[i].via?.kind !== 'ride') return;
      const w = toWalks[i];
      if (!w || w.min > MAX_WALK_MIN) return;
      const arrive = best[i].t + w.min;
      const tail = w.min > 0
        ? [{ ...w, kind: 'walk', from: n, to: to.label,
             coords: w.coords ? [...w.coords].reverse() : null,
             depart: best[i].t, arrive }]
        : [];
      results.push({
        depart, arrive, transfers: round,
        legs: unwind(best[i].via).concat(tail),
      });
    });

    if (!improved) break;
  }
  return finish(results);
}

function finish(results) {
  /* 같은 승차 조합은 가장 이른 것 하나만 남긴다 */
  const uniq = new Map();
  for (const r of results.sort((a, b) => a.arrive - b.arrive || a.legs.length - b.legs.length)) {
    const sig = r.legs.filter(l => l.kind === 'ride')
                      .map(l => l.route.id + l.from + l.to).join('>') || 'walk';
    if (!uniq.has(sig)) uniq.set(sig, r);
  }
  for (const r of uniq.values()) r.legs = r.legs.filter(l => l.kind !== 'walk' || l.min > 0);
  const sorted = [...uniq.values()].filter(r => r.legs.length)
                                   .sort((a, b) => a.arrive - b.arrive);
  if (!sorted.length) return [];
  // 최선보다 45분 넘게 늦는 후보는 사실상 쓸모가 없다
  const cut = sorted[0].arrive + 45;
  return sorted.filter((r, i) => i === 0 || r.arrive <= cut).slice(0, 4);
}

/** via 체인을 출발→도착 순 배열로 편다 */
function unwind(via) {
  const out = [];
  while (via) { out.unshift(via); via = via.prev; }
  return out;
}

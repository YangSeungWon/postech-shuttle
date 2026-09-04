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
    // 도착 시각은 시간표로 고정이다. 그러니 탈 수 있는 정류장 중 가장
    // '나중' 것에서 타는 게 항상 낫다 — 도착은 같은데 그만큼 늦게 나가면
    // 된다. 첫 정류장에 붙박아 두면, 무은재삼거리에서 17:18 에 탈 수
    // 있는데도 체육관까지 12분 걸어가 17:12 에 타라고 하게 된다.
    for (const r of ROUTES) {
      if (!isOn(r)) continue;
      for (const trip of r.tripsMin) {
        let boardAt = -1, boardSlack = -Infinity, boardCost = Infinity;
        for (let k = 0; k < trip.length; k++) {
          const si = ix.get(r.canonStops[k]);
          if (si === undefined) continue;
          // 버스보다 먼저 가 있을 수 있는 곳이면 탈 수 있다. (그런 곳에
          // 버스로 가 봐야 이미 걸어서 도착해 있으니 하차 후보는 아니다)
          if (snapshot[si].via && snapshot[si].t <= trip[k]) {
            // 여유가 가장 큰 곳에서 탄다 = 가장 늦게 나가도 되는 곳.
            // 뒤쪽 정류장이라고 늘 나은 게 아니다 — 효자시장까지 14분
            // 걸어가 17:25 에 타는 것보다, 무은재삼거리에서 17:18 에
            // 타는 쪽이 7분 더 늦게 나가도 된다.
            const slack = trip[k] - snapshot[si].t;
            if (slack > boardSlack ||
                (slack === boardSlack && snapshot[si].t < boardCost)) {
              boardAt = k; boardSlack = slack; boardCost = snapshot[si].t;
            }
            continue;
          }
          if (boardAt < 0) continue;
          /* 도착이 같으면 늦게 타는 쪽을 남긴다. 더 이르게만 갱신하면
             먼저 찾은 승차 지점이 눌러앉아, 무은재삼거리에서 17:18 에
             탈 수 있는데도 체육관까지 12분 걸어가 17:12 에 타라고 한다. */
          const tie = trip[k] === best[si].t &&
                      trip[boardAt] > (best[si].via?.kind === 'ride'
                                        ? best[si].via.depart : -Infinity);
          if (trip[k] < best[si].t || tie) {
            if (trip[k] < best[si].t) improved = true;
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

/* 셔틀에서 실제 질문은 "이거 놓치면 다음은 언제"다. 위의 걸러내기로 비슷비슷한
   안이 빠지고 나면 한 줄만 남는 일이 많아, 그 뒤차를 이어 붙여 목록을 채운다. */
function planTripSeries(from, to, depart, ctx, want = 3) {
  const first = planTrip(from, to, depart, ctx);
  if (!first.length) return first;
  /* 뒤차를 붙일 때 아무거나 붙이면 안 된다. 3분이면 가는 길에 "나중에 떠나는"
     24분짜리를 끼워 넣는 일이 있었다 — 늦게 나간다는 것 하나로 살아남는다.
     걸리는 시간이 최선과 크게 다르면 그건 다음 차가 아니라 다른 여정이다. */
  const bestDur = first[0].arrive - first[0].leave;
  const sane = r => (r.arrive - r.leave) <= bestDur * 1.6 + 6;
  const pool = [...first];
  const seen = new Set(pool.map(r => r.leave + '>' + r.arrive));
  let cursor = first[0].leave;
  for (let guard = 0; guard < 8 && rank(pool, want).length < want; guard++) {
    const more = planTrip(from, to, cursor + 1, ctx);
    if (!more.length) break;
    if (!(more[0].leave > cursor)) break;      // 걸어가는 안은 늘 지금 출발이다
    cursor = more[0].leave;
    for (const r of more) {
      const sig = r.leave + '>' + r.arrive;
      if (!seen.has(sig) && sane(r)) { seen.add(sig); pool.push(r); }
    }
  }
  return rank(pool, want);
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
  const all = [...uniq.values()].filter(r => r.legs.length);
  for (const r of all) {
    const rides = r.legs.filter(l => l.kind === 'ride').length;
    r.transfers = Math.max(0, rides - 1);
    r.walkMin = r.legs.reduce((s, l) => s + (l.kind === 'walk' ? l.min : 0), 0);
    /* 실제로 집을 나서야 하는 시각. 모든 안의 depart 는 질의 시각으로 같아서
       그것만 보면 "다음 버스"들이 서로를 눌러 버린다. 버스를 놓치지 않는
       마지막 출발 시각이라야 안끼리 비교가 된다. */
    const ride = r.legs.find(l => l.kind === 'ride');
    const head = r.legs[0];
    r.leave = ride ? ride.depart - (head.kind === 'walk' ? head.min : 0) : r.depart;
  }

  return rank(all, 4);
}

/* 어느 면에서도 나은 구석이 없는 후보는 빼고, 남은 것을 줄 세운다. */
const SHORT_WALK = 15;   // 이만큼이면 그냥 걸어간다
const LEAVE_EPS = 3;   // 1분 늦게 나가려고 12분 늦게 닿는 안은 고를 이유가 없다

function rank(all, limit) {
  const worse = (a, b) =>                      // b 가 a 를 모든 면에서 누르는가
    b.arrive <= a.arrive && b.leave >= a.leave - LEAVE_EPS &&
    b.transfers <= a.transfers && b.walkMin <= a.walkMin &&
    (b.arrive < a.arrive || b.leave > a.leave + LEAVE_EPS ||
     b.transfers < a.transfers || b.walkMin < a.walkMin);
  let kept = all.filter(a => !all.some(b => b !== a && worse(a, b)));
  if (!kept.length) kept = all;                // 서로 물고 도는 일은 없어야 하지만

  const sorted = kept.sort((a, b) =>
    a.arrive - b.arrive ||                     // 언제 닿는지가 먼저다
    b.leave - a.leave ||                       // 같이 닿으면 늦게 나가도 되는 쪽
    a.transfers - b.transfers ||               // 환승은 놓칠 수 있다
    a.walkMin - b.walkMin);
  if (!sorted.length) return [];
  // 최선보다 45분 넘게 늦는 후보는 사실상 쓸모가 없다
  const cut = sorted[0].arrive + 45;
  const out = sorted.filter((r, i) => i === 0 || r.arrive <= cut).slice(0, limit);
  /* 다만 버스가 하나도 안 남으면 안 된다. 유강·지곡은 출퇴근에만 다녀서
     낮에는 다음 차가 몇 시간 뒤인데, 그걸 잘라 버리면 "걸어가세요" 만
     남는다. 걸을지 기다릴지는 타는 사람이 정할 일이다. */
  const hasRide = r => r.legs.some(l => l.kind === 'ride');
  if (!out.some(hasRide)) {
    const bus = sorted.find(hasRide);
    /* 걸어서 금방 닿는 길이면 버스를 되살리지 않는다. 4분이면 걸어갈 데를
       두고 42분 걸리는 차를 기다리라고 하는 셈이다. 낮에 유강·지곡을
       기다릴 만한 것은 걸어서 한참인 경우뿐이다. */
    const walk = sorted.find(r => !hasRide(r));
    const pointless = walk && walk.walkMin <= SHORT_WALK
                   && (!bus || bus.arrive >= walk.arrive);
    if (bus && !pointless) out.push(bus);
  }
  return out;
}

/** via 체인을 출발→도착 순 배열로 편다 */
function unwind(via) {
  const out = [];
  while (via) { out.unshift(via); via = via.prev; }
  return out;
}


/**
 * 도착 시각을 맞추는 탐색. "9시 수업 전에 도착" 같은 질문에 답한다.
 *
 * 시간표는 하루치뿐이니 뒤에서 앞으로 푸는 대신, 이른 시각부터 훑어
 * 기한 안에 도착하는 것 중 가장 늦게 떠나는 경로를 고른다. 기다리는 시간이
 * 가장 짧은 답이 된다.
 * @param {number} arriveBy 도착 기한(분)
 * @param {number} earliest 이 시각 이전에는 출발할 수 없다
 */
function planArriveBy(from, to, arriveBy, earliest, ctx) {
  const STEP = 5;
  // 첫차보다 이른 시각부터 훑을 이유가 없다
  const first = Math.min(...ctx.ROUTES.flatMap(r => r.tripsMin.map(t => t[0])));
  let best = null;
  for (let t = Math.max(first, Math.ceil(earliest / STEP) * STEP); t <= arriveBy; t += STEP) {
    const plans = planTrip(from, to, t, ctx).filter(p => p.arrive <= arriveBy);
    if (!plans.length) continue;
    // 같은 도착이라면 늦게 떠나는 쪽이 낫다
    best = { t, plans };
  }
  if (!best) {
    // 기한 안에 못 가면 가장 이른 도착이라도 보여 준다
    return planTrip(from, to, earliest, ctx).map(p => ({ ...p, late: true }));
  }
  return best.plans;
}

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
/* 걸어서 붙는 정류장에서는 이만큼 여유를 두고 탄다(분). 도착 시각에 딱 맞춰
   닿는 안은 실제로는 놓치는 안이다 — 지곡회관에 서서 13:00 에 길을 건너
   13:01 차를 타라는 말이 그렇다. 서 있던 정류장이면 여유가 필요 없다. */
const BOARD_SLACK = 1;

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
function planTrip(from, to, depart, ctx, keepRide = false) {
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
  if (!reachable) return finish(results, keepRide, directWalk?.min);

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
          // 버스보다 (여유를 두고) 먼저 가 있을 수 있는 곳이면 탈 수 있다
          const via = snapshot[si].via;
          const onFoot = via && via.kind === 'walk' && via.min > 0;
          const boardable = via && snapshot[si].t + (onFoot ? BOARD_SLACK : 0) <= trip[k];

          if (boardAt >= 0) {
            const bi = ix.get(r.canonStops[boardAt]);
            const leg = {
              kind: 'ride', route: r,
              from: r.stops[boardAt], to: r.stops[k],
              fromIdx: boardAt, toIdx: k, stops: k - boardAt,
              depart: trip[boardAt], arrive: trip[k],
              wait: trip[boardAt] - snapshot[bi].t,
              prev: snapshot[bi].via,
            };
            /* 여기서 내리는 안을 바로 만들어 둔다. best 는 '그 정류장에
               가장 일찍 닿는 법' 하나만 들고 있어서, 걸어서 더 빨리 닿는
               정류장은 하차 후보에서 통째로 빠졌다. 그래서 효자시장을
               지나쳐 유강사거리까지 갔다가 18분 되걸어오는 안이 남았다. */
            const tw = toWalks[si];
            if (tw && tw.min <= MAX_WALK_MIN) {
              const arrive = trip[k] + tw.min;
              results.push({
                depart, arrive, transfers: round,
                legs: unwind(leg).concat(tw.min > 0
                  ? [{ ...tw, kind: 'walk', from: r.stops[k], to: to.label,
                       coords: tw.coords ? [...tw.coords].reverse() : null,
                       depart: trip[k], arrive }]
                  : []),
              });
            }
            /* 도착이 같으면 늦게 타는 쪽을 남긴다. 더 이르게만 갱신하면
               먼저 찾은 승차 지점이 눌러앉아, 무은재삼거리에서 17:18 에
               탈 수 있는데도 체육관까지 12분 걸어가 17:12 에 타라고 한다. */
            const tie = trip[k] === best[si].t &&
                        trip[boardAt] > (best[si].via?.kind === 'ride'
                                          ? best[si].via.depart : -Infinity);
            if (trip[k] < best[si].t || tie) {
              if (trip[k] < best[si].t) improved = true;
              best[si] = { t: trip[k], via: leg };
            }
          }

          if (boardable) {
            // 여유가 가장 큰 곳에서 탄다 = 가장 늦게 나가도 되는 곳.
            // 뒤쪽 정류장이라고 늘 나은 게 아니다 — 효자시장까지 14분
            // 걸어가 17:25 에 타는 것보다, 무은재삼거리에서 17:18 에
            // 타는 쪽이 7분 더 늦게 나가도 된다.
            const slack = trip[k] - snapshot[si].t;
            if (slack > boardSlack ||
                (slack === boardSlack && snapshot[si].t < boardCost)) {
              boardAt = k; boardSlack = slack; boardCost = snapshot[si].t;
            }
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
  return finish(results, keepRide, directWalk?.min);
}

/* 셔틀에서 실제 질문은 "이거 놓치면 다음은 언제"다. 위의 걸러내기로 비슷비슷한
   안이 빠지고 나면 한 줄만 남는 일이 많아, 그 뒤차를 이어 붙여 목록을 채운다. */
/* 오늘 차가 끝났을 때 내미는 '다음 운행일' 안. 하나만 뽑으면 그날 가장 이른
   차 하나 — 지곡·유강 첫차 — 만 남아, 어느 목적지를 찍어도 같은 차만 뜬다.
   타는 노선 조합이 다른 것을 모아 여러 줄로 준다. */
function firstOfDay(from, to, ctx, want, since = 0) {
  const rides = r => r.legs.filter(l => l.kind === 'ride');
  const cands = [];
  /* 첫차만 보면 순환은 09:00 하나뿐이다. 하루를 훑어 노선 조합마다
     가장 이른 것을 모은다. */
  for (let t = since; t < 24 * 60; t += 30) {
    for (const r of planTrip(from, to, t, ctx, true)) {
      if (rides(r).length) cands.push(r);
    }
  }
  const byRoute = new Map();
  for (const r of cands.sort((a, b) => a.leave - b.leave || a.walkMin - b.walkMin)) {
    /* 지곡·유강은 출발 시각마다 노선 id 가 다르다. id 로 묶으면 같은 노선의
       첫차·둘째차·셋째차가 서로 다른 것인 양 목록을 다 차지한다. */
    const sig = rides(r).map(l => l.route.group || l.route.name).join('>');
    if (!byRoute.has(sig)) byRoute.set(sig, r);
  }
  return [...byRoute.values()]
    .sort((a, b) => a.walkMin - b.walkMin || a.leave - b.leave)
    .slice(0, want)
    .sort((a, b) => a.leave - b.leave);
}

/* 어느 노선을 탄 안인가 — 지곡·유강은 출발 시각마다 id 가 다르므로 무리로 본다 */
const family = r => r.legs.filter(l => l.kind === 'ride')
                          .map(l => l.route.group || l.route.name).join('>');

function planTripSeries(from, to, depart, ctx, want = 3) {
  const hasRide = r => r.legs.some(l => l.kind === 'ride');
  const first = planTrip(from, to, depart, ctx);
  if (!first.length) {
    /* 걸어가기엔 멀고(MAX_WALK_MIN 초과) 버스는 끝난 밤이면 여기가 빈다.
       "갈 방법이 없다" 와 "오늘은 끝났다" 는 다른 말이므로 첫차를 찾아 준다. */
    const next = firstOfDay(from, to, ctx, want, depart);
    if (next.length) { for (const r of next) r.later = true; return next; }
    const tomorrow = firstOfDay(from, to, ctx, want, 0);
    for (const r of tomorrow) r.nextDay = true;
    return tomorrow.length ? tomorrow : first;
  }
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
  const out = rank(pool, want);
  /* 오늘은 그 방향 버스가 더 없을 수 있다 — 유강·지곡은 출퇴근 한 방향씩만
     다니므로, 유강사거리에서 북쪽으로 가는 차는 아침 세 대가 전부다. 그때
     "걸어가세요" 만 내놓으면 버스가 아예 없는 노선처럼 읽힌다. 그날 첫차를
     찾아 다음 운행일 것으로 붙여 준다. */
  /* 결과가 아예 없을 때도 붙여야 한다 — 걸어가기엔 멀고(20분 초과) 버스는
     끝난 밤이면 "이 시각에 갈 수 있는 경로가 없습니다" 만 남았다. 갈 방법이
     없다는 말과 오늘은 끝났다는 말은 다르다. */
  /* 지금 목록에 없는 노선이 오늘 이따 다닐 수 있다. 순환은 09시에 시작하니
     08시에 찍으면 통째로 빠지고, 걸어가라는 말만 남는다. 걸을지 기다릴지는
     타는 사람이 정할 일이므로 점선으로 떼어 붙인다. */
  const have = new Set(out.map(family));
  for (const r of firstOfDay(from, to, ctx, want, depart)) {
    if (have.has(family(r))) continue;
    have.add(family(r));
    r.later = true;
    out.push(r);
  }
  // 세로 목록이라 따로 두어도 눈에 들어온다 — 지금 탈 수 있는 것과 섞지 않는다
  if (!out.some(hasRide)) {
    for (const r of firstOfDay(from, to, ctx, want, 0)) { r.nextDay = true; out.push(r); }
  }
  return out;
}

function finish(results, keepRide, directMin) {
  /* 같은 승차 조합은 가장 이른 것 하나만 남긴다 */
  const uniq = new Map();
  for (const r of results.sort((a, b) => a.arrive - b.arrive || a.legs.length - b.legs.length)) {
    const sig = r.legs.filter(l => l.kind === 'ride')
                      .map(l => l.route.id + l.from + l.to).join('>') || 'walk';
    if (!uniq.has(sig)) uniq.set(sig, r);
  }
  for (const r of uniq.values()) r.legs = r.legs.filter(l => l.kind !== 'walk' || l.min > 0);
  let all = [...uniq.values()].filter(r => r.legs.length);
  for (const r of all) {
    const rides = r.legs.filter(l => l.kind === 'ride').length;
    r.transfers = Math.max(0, rides - 1);
    r.walkMin = r.legs.reduce((s, l) => s + (l.kind === 'walk' ? l.min : 0), 0);
    /* 실제로 집을 나서야 하는 시각. 모든 안의 depart 는 질의 시각으로 같아서
       그것만 보면 "다음 버스"들이 서로를 눌러 버린다. 버스를 놓치지 않는
       마지막 출발 시각이라야 안끼리 비교가 된다. */
    const ride = r.legs.find(l => l.kind === 'ride');
    const head = r.legs[0];
    /* 걸어서 붙는 차는 여유까지 빼야 실제로 나서야 하는 시각이다. 안 그러면
       "13:05 에 나가 13:06 차" 처럼 딱 맞춰 뛰라는 말이 된다. */
    r.leave = ride
      ? ride.depart - (head.kind === 'walk' && head.min > 0 ? head.min + BOARD_SLACK : 0)
      : r.depart;
  }

  /* 같은 시각에 집을 나서 그냥 걸었을 때보다 늦게 닿는 버스 안은 버린다.
     이것이 없으면 목적지를 지나쳐 정류장까지 걸어간 뒤 버스로 더 멀리
     갔다가 되걸어오는 안이 "늦게 나가도 된다" 는 이유로 살아남는다. */
  if (directMin != null) {
    all = all.filter(r => !r.legs.some(l => l.kind === 'ride')
                       || r.arrive < r.leave + directMin);
  }

  return rank(all, 4, keepRide);
}

/* 어느 면에서도 나은 구석이 없는 후보는 빼고, 남은 것을 줄 세운다. */
const SHORT_WALK = 6;    // 이만큼이면 버스를 기다릴 것도 없이 걸어간다
const LEAVE_EPS = 3;   // 1분 늦게 나가려고 12분 늦게 닿는 안은 고를 이유가 없다

function rank(all, limit, keepRide) {
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
    const pointless = !keepRide && walk && walk.walkMin <= SHORT_WALK
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



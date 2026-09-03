'use strict';

/* ------------------------------------------------------------------ *
 * 화면 문구. 정류장·노선 영문 표기는 기존 안내 페이지의 것을 그대로 쓴다
 * (build.py 가 timetable.html 에서 가져와 DATA.en 에 담는다).
 * ------------------------------------------------------------------ */

const STRINGS = {
  ko: {
    lang: 'ko', htmlLang: 'ko',
    title: 'POSTECH 셔틀버스 지도',
    brandShort: 'POSTECH 셔틀', brandLong: ' 버스 지도',
    tagline: '시간표 기반 운행 위치 · 실시간 GPS 아님',
    route: '길찾기', timetable: '시간표', allTimetable: '전체 시간표',
    from: '출발', to: '도착', fromPh: '출발지', toPh: '도착지',
    here: '내 위치', swap: '출발·도착 바꾸기', edit: '고치기',
    now: '지금 출발', departAt: t => `${t} 출발`,
    all: '전체',
    routeOrder: label => `${label} 정류장 순서`,
    nearby: '내 주변 정류장', comingSoon: '곧 버스가 오는 정류장',
    selected: '선택한 정류장', suggested: '추천 경로',
    noService: '오늘 남은 운행이 없습니다.',
    notRunning: '운행 시간이 아닙니다 · 07:40–18:30',
    noRoute: '이 시각에 갈 수 있는 경로가 없습니다',
    due: '곧 도착', min: n => `${n}분`, next: t => `다음 ${t}`,
    across: '건너',
    walkTo: (name, m) => `<b>${name}</b>까지 도보 ${m}분`,
    walkSub: (m, up) => `${m}m${up ? ` · 오르막 ${up}m` : ''}`,
    rideSub: (route, stops, wait) =>
      `${route} · ${stops}정거장${wait ? ` · ${wait}분 대기` : ''}`,
    walkBadge: '보행',
    transfers: n => `환승 ${n}회`, walkOnly: '도보',
    dist: (d, m) => `${d} · 도보 ${m}분`,
    askTitle: '가까운 정류장부터 보기',
    askBody: '위치는 이 브라우저 안에서만 쓰입니다.',
    askYes: '위치 허용', askNo: '나중에', askRetry: '다시 시도',
    denyTitle: '위치 권한이 꺼져 있습니다',
    editHint: '좌표 보정 모드 — 정류장 마커를 끌어 실제 위치로 옮기세요.',
    copyJson: 'JSON 복사', resetCoords: '되돌리기',
    mapPoint: '지도에서 선택한 지점',
    startHere: '출발', endHere: '도착',
    kinds: { recent: '최근', stop: '정류장', place: '장소', university: '건물',
             dormitory: '기숙사', library: '도서관', cafe: '카페', restaurant: '식당',
             fast_food: '식당', convenience: '편의점', supermarket: '마트',
             fitness_centre: '체육', sports_centre: '체육', school: '건물',
             commercial: '건물', bank: '은행', public: '건물', clinic: '의원',
             pharmacy: '약국', books: '서점' },
    baseMuted: '연한 지도', baseDetail: '상세 지도',
    myLocation: '내 위치', fitAll: '전체 보기', mapKind: '지도 종류', fixCoords: '좌표 보정',
    copied: '보정된 좌표를 클립보드에 복사했습니다.',
    confirmReset: '보정한 좌표를 모두 버리고 기본값으로 되돌릴까요?',
  },
  en: {
    lang: 'en', htmlLang: 'en',
    title: 'POSTECH Shuttle Map',
    brandShort: 'POSTECH Shuttle', brandLong: ' Map',
    tagline: 'Positions estimated from the timetable — not live GPS',
    route: 'Directions', timetable: 'Timetable', allTimetable: 'Full timetable',
    from: 'From', to: 'To', fromPh: 'Starting point', toPh: 'Destination',
    here: 'My location', swap: 'Swap start and destination', edit: 'Edit',
    now: 'Leave now', departAt: t => `Leave at ${t}`,
    all: 'All',
    routeOrder: label => `${label} — stops in order`,
    nearby: 'Stops near you', comingSoon: 'Buses arriving soon',
    selected: 'Selected stop', suggested: 'Suggested routes',
    noService: 'No more service today.',
    notRunning: 'Outside service hours · 07:40–18:30',
    noRoute: 'No route available at this time',
    due: 'Due now', min: n => `${n} min`, next: t => `then ${t}`,
    across: 'opposite',
    walkTo: (name, m) => `${m} min to <b>${name}</b>`,
    walkSub: (m, up) => `${m} m${up ? ` · ${up} m climb` : ''}`,
    rideSub: (route, stops, wait) =>
      `${route} · ${stops} stop${stops > 1 ? 's' : ''}${wait ? ` · ${wait} min wait` : ''}`,
    walkBadge: 'Walk',
    transfers: n => `${n} transfer${n > 1 ? 's' : ''}`, walkOnly: 'Walk',
    dist: (d, m) => `${d} · ${m} min walk`,
    askTitle: 'See the nearest stops first',
    askBody: 'Your location stays in this browser.',
    askYes: 'Allow location', askNo: 'Not now', askRetry: 'Try again',
    denyTitle: 'Location access is off',
    editHint: 'Coordinate mode — drag stop markers to their real positions.',
    copyJson: 'Copy JSON', resetCoords: 'Reset',
    mapPoint: 'Point on the map',
    startHere: 'From here', endHere: 'To here',
    kinds: { recent: 'Recent', stop: 'Stop', place: 'Place', university: 'Building',
             dormitory: 'Dorm', library: 'Library', cafe: 'Cafe', restaurant: 'Food',
             fast_food: 'Food', convenience: 'Store', supermarket: 'Market',
             fitness_centre: 'Sports', sports_centre: 'Sports', school: 'Building',
             commercial: 'Building', bank: 'Bank', public: 'Building', clinic: 'Clinic',
             pharmacy: 'Pharmacy', books: 'Books' },
    baseMuted: 'Muted map', baseDetail: 'Detailed map',
    myLocation: 'My location', fitAll: 'Fit all', mapKind: 'Map style', fixCoords: 'Fix coordinates',
    copied: 'Corrected coordinates copied to the clipboard.',
    confirmReset: 'Discard all corrections and restore the defaults?',
  },
};

const LS_LANG = 'postech-shuttle-lang';
let LANG = (() => {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved && STRINGS[saved]) return saved;
  } catch (e) {}
  return navigator.language && navigator.language.startsWith('ko') ? 'ko' : 'en';
})();

let T = STRINGS[LANG];

/* 정류장·노선·장소 이름을 현재 언어로 */
const stopLabel = n => (LANG === 'en' && DATA.en?.stops?.[n]) || n;
const routeLabel = r => {
  if (LANG !== 'en') return r.name;
  const en = DATA.en?.routes?.[r.id];
  if (en?.name) return en.name;
  return r.name;
};
const placeLabel = p => (LANG === 'en' && p.en) || p.n;

function setLang(next) {
  LANG = STRINGS[next] ? next : 'ko';
  T = STRINGS[LANG];
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) {}
  document.documentElement.lang = T.htmlLang;
  document.title = T.title;
}

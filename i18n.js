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
    effectiveFrom: d => `${d} 시행 시간표`,
    effectiveUnknown: '시행일 확인 필요',
    checkedAt: d => `${d} 확인`,
    staleCheck: n => `${n}일째 확인 못 함`,
    staleWarn: d => `${d} 이후로 원본을 확인하지 못했습니다. 시간표가 바뀌었을 수 있으니 확인해 주세요.`,
    from: '출발', to: '도착', fromPh: '출발지', toPh: '도착지',
    here: '내 위치', swap: '출발·도착 바꾸기',
    editFrom: '출발지 고치기', editTo: '도착지 고치기',
    whenTitle: '출발·도착 시각', now: '지금 출발', departAt: t => `${t} 출발`,
    modeDepart: '출발', modeArrive: '도착',
    pickTime: '시각 선택', arriveBy: t => `${t}까지 도착`,
    tooLate: t => `${t}까지 도착하는 경로가 없습니다`,
    all: '전체',
    routeOrder: label => `${label} 정류장 순서`,
    routeTimetable: label => `${label} 시간표`,
    nearby: '내 주변 정류장', comingSoon: '곧 버스가 오는 정류장',
    selected: '선택한 정류장', suggested: '추천 경로',
    noService: '오늘 남은 운행이 없습니다.',
    notRunning: '운행 시간이 아닙니다 · 07:40–18:30',
    noWeekend: '주말은 운행하지 않습니다 · 평일 07:40–18:30',
    noHoliday: n => `${n || '공휴일'} · 운행하지 않습니다`,
    noRoute: '이 시각에 갈 수 있는 경로가 없습니다',
    due: '도착 또는 출발', min: n => `${n}분`, next: t => `다음 ${t}`,
    toward: s => `${s} 방면`,
    waitingAt: (stop, min, at) => `${stop} 출발 대기 · ${min}분 후 (${at})`,
    across: '건너',
    walkTo: (name, m) => `<b>${name}</b>까지 도보 ${m}분`,
    walkSub: (m, up, sig) =>
      `${m}m${up ? ` · 오르막 ${up}m` : ''}${sig ? ` · 신호 ${sig}곳` : ''}`,
    rideSub: (route, stops, wait) =>
      `${route} · ${stops}정거장${wait ? ` · ${wait}분 대기` : ''}`,
    walkBadge: '보행',
    transfers: n => `환승 ${n}회`, walkOnly: '도보',
    dist: (d, m) => `${d} · 도보 ${m}분`,
    askTitle: '가까운 정류장부터 보기',
    askBody: '위치는 이 브라우저 안에서만 쓰입니다.',
    askYes: '위치 허용', askNo: '나중에', askRetry: '다시 시도',
    commuteAm: '출근', commutePm: '퇴근',
    departsAt: t => t ? `${t} 출발` : '운행 없음',
    heroAsk: '가까운 정류장 보기', walkShort: m => `도보 ${m}분`,
    heroLabel: (stop, walk, route, eta) =>
      `가장 가까운 정류장 ${stop}, 도보 ${walk}분. ${route} ${eta}. 눌러서 자세히 보기`,
    pickOnMap: '지도에서 지정', pickHint: '지도에서 지금 계신 곳을 눌러 주세요',
    cancel: '취소', close: '닫기',
    updateReady: '새 버전이 있습니다', reload: '새로고침',
    skip: '본문으로 건너뛰기', back: '뒤로', gotIt: '알겠어요',
    installApp: '홈 화면에 추가',
    installNudge: '앱처럼 바로 열려요',
    installNow: '추가',
    installTitle: '홈 화면에 추가',
    stepsIOS: ['주소창 옆 <b>공유</b> 버튼을 누르세요',
               '목록에서 <b>홈 화면에 추가</b>를 고르세요'],
    stepsAndroid: ['오른쪽 위 <b>⋮</b> 를 누르세요',
                   '<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 고르세요'],
    stepsFirefox: ['주소창 오른쪽 <b>⋮</b> 를 누르세요',
                   '<b>홈 화면에 추가</b>를 고르세요'],
    stepsDesktop: ['주소창 오른쪽 끝의 <b>설치</b> 아이콘을 누르세요',
                   '보이지 않으면 <b>⋮ → 저장 및 공유 → 페이지를 앱으로 설치</b>',
                   '파이어폭스 데스크톱은 앱 설치를 지원하지 않습니다'],
    timetableHint: '출퇴근 시간 및 교내 교통상황에 따라 도착시간에 앞뒤 1~2분의 오차가 발생할 수 있습니다.',
    clockLabel: (h, m) => `현재 시각 ${h}시 ${m}분`,
    tabNear: '주변', tabRoutes: '노선', tabTimetable: '시간표', tabTrip: '길찾기',
    modeSwitch: '출발·도착 기준 바꾸기',
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
    effectiveFrom: d => `Timetable effective ${d}`,
    effectiveUnknown: 'Effective date unconfirmed',
    checkedAt: d => `checked ${d}`,
    staleCheck: n => `unchecked for ${n} days`,
    staleWarn: d => `The source has not been checked since ${d}. The timetable may have changed.`,
    from: 'From', to: 'To', fromPh: 'Starting point', toPh: 'Destination',
    here: 'My location', swap: 'Swap start and destination',
    editFrom: 'Change starting point', editTo: 'Change destination',
    whenTitle: 'Departure or arrival time', now: 'Leave now', departAt: t => `Leave at ${t}`,
    modeDepart: 'Depart', modeArrive: 'Arrive',
    pickTime: 'Pick a time', arriveBy: t => `Arrive by ${t}`,
    tooLate: t => `No route arrives by ${t}`,
    all: 'All',
    routeOrder: label => `${label} — stops in order`,
    routeTimetable: label => `${label} timetable`,
    nearby: 'Stops near you', comingSoon: 'Buses arriving soon',
    selected: 'Selected stop', suggested: 'Suggested routes',
    noService: 'No more service today.',
    notRunning: 'Outside service hours · 07:40–18:30',
    noWeekend: 'No weekend service · weekdays 07:40–18:30',
    noHoliday: () => 'Public holiday · no service',
    noRoute: 'No route available at this time',
    due: 'Arriving or departing', min: n => `${n} min`, next: t => `then ${t}`,
    toward: s => `to ${s}`,
    waitingAt: (stop, min, at) => `Waiting at ${stop} · departs in ${min} min (${at})`,
    across: 'opposite',
    walkTo: (name, m) => `${m} min to <b>${name}</b>`,
    walkSub: (m, up, sig) =>
      `${m} m${up ? ` · ${up} m climb` : ''}${sig ? ` · ${sig} signal${sig > 1 ? 's' : ''}` : ''}`,
    rideSub: (route, stops, wait) =>
      `${route} · ${stops} stop${stops > 1 ? 's' : ''}${wait ? ` · ${wait} min wait` : ''}`,
    walkBadge: 'Walk',
    transfers: n => `${n} transfer${n > 1 ? 's' : ''}`, walkOnly: 'Walk',
    dist: (d, m) => `${d} · ${m} min walk`,
    askTitle: 'See the nearest stops first',
    askBody: 'Your location stays in this browser.',
    askYes: 'Allow location', askNo: 'Not now', askRetry: 'Try again',
    commuteAm: 'Morning', commutePm: 'Evening',
    departsAt: t => t ? `departs ${t}` : 'no service',
    heroAsk: 'Show nearby stops', walkShort: m => `${m} min walk`,
    heroLabel: (stop, walk, route, eta) =>
      `Nearest stop ${stop}, ${walk} minute walk. ${route} in ${eta}. Tap for details`,
    pickOnMap: 'Set on map', pickHint: 'Tap where you are on the map',
    cancel: 'Cancel', close: 'Close',
    updateReady: 'A new version is available', reload: 'Reload',
    skip: 'Skip to content', back: 'Back', gotIt: 'Got it',
    installApp: 'Add to Home Screen',
    installNudge: 'Open it like an app',
    installNow: 'Add',
    installTitle: 'Add to Home Screen',
    stepsIOS: ['Tap the <b>Share</b> button next to the address bar',
               'Choose <b>Add to Home Screen</b>'],
    stepsAndroid: ['Tap <b>⋮</b> at the top right',
                   'Choose <b>Add to Home screen</b> or <b>Install app</b>'],
    stepsFirefox: ['Tap <b>⋮</b> next to the address bar',
                   'Choose <b>Add to Home screen</b>'],
    stepsDesktop: ['Click the <b>Install</b> icon at the end of the address bar',
                   'Or <b>⋮ → Save and share → Install page as app</b>',
                   'Firefox on desktop does not support installing apps'],
    timetableHint: 'Arrival times may vary by 1–2 minutes either way with commute and campus traffic.',
    clockLabel: (h, m) => `Current time ${h}:${m}`,
    tabNear: 'Nearby', tabRoutes: 'Routes', tabTimetable: 'Timetable', tabTrip: 'Directions',
    modeSwitch: 'Switch between depart and arrive',
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

/* 방면 표시처럼 좁은 자리에 쓸 짧은 이름.
   별칭 중 더 짧은 것을 쓰고(생명공학연구센터(PBC) → PBC), 괄호 설명은 뗀다. */
const SHORT = (() => {
  const m = new Map();
  for (const [alias, target] of Object.entries(DATA.canon || {})) {
    if (alias.length < target.length) m.set(target, alias);
  }
  return m;
})();
const shortLabel = n => {
  const base = SHORT.get(n) || n;
  return stopLabel(base).replace(/\s*\([^)]*\)\s*$/, '').trim() || stopLabel(base);
};

function setLang(next) {
  LANG = STRINGS[next] ? next : 'ko';
  T = STRINGS[LANG];
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) {}
  document.documentElement.lang = T.htmlLang;
  document.title = T.title;
}

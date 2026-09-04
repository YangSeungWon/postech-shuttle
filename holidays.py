"""운행하지 않는 날.

셔틀은 평일만 운행한다. 원본 시간표에 요일 정보가 없어 확인한 내용을 여기에 둔다.

공휴일은 hyunbinseo/holidays-kr (MIT) 을 쓴다. 우주항공청 월력요항을 가공한
자료라 설날·추석·부처님오신날 같은 음력 공휴일과 대체공휴일까지 들어 있다.
공공데이터포털 특일 API 와 달리 인증키가 필요 없어 빌드 때 받아 구워 넣는다.
"""
import datetime, gzip, json, os, urllib.request

BASE = 'https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/{}'
CACHE = 'holidays_kr.json.gz'
def _years():
    """올해 앞뒤로 훑는다. 다음 해 자료가 나오면 그때 자동으로 들어온다."""
    y = datetime.date.today().year
    return range(y - 1, y + 4)

# 공휴일 목록은 자료를 그대로 따른다.
#
# 처음에는 노동절·제헌절을 "관공서 공휴일이 아니다"라며 뺐는데, 제헌절은
# 공휴일로 다시 지정됐고 노동절도 쉬는 날이다. 우주항공청 월력요항을 가공한
# 자료가 제 판단보다 근거가 낫다. 예외를 두려면 근거를 확인하고 여기에 적는다.


def _get(name):
    """JSON 이 없는 해는 CSV 로 온다 — 둘 다 받아 같은 모양으로 돌려준다"""
    try:
        req = urllib.request.Request(BASE.format(name),
                                     headers={'User-Agent': 'postech-shuttle/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode('utf-8-sig')
    except Exception:
        return None
    if name.endswith('.json'):
        return json.loads(body)
    out = {}
    for line in body.splitlines()[1:]:          # 첫 줄은 머리글
        if ',' not in line:
            continue
        date, subject = line.split(',', 1)
        out.setdefault(date.strip(), []).append(subject.strip())
    return out or None


def _load_cache():
    if os.path.exists(CACHE):
        with gzip.open(CACHE, 'rt', encoding='utf-8') as f:
            return json.load(f)
    return {}


def fetch(years=None):
    """{'YYYY-MM-DD': ['이름', ...]} — 캐시에 없는 해만 받아 온다"""
    cache = _load_cache()
    for y in (years or _years()):
        if str(y) in cache:
            continue
        got = _get(f'{y}.json') or _get(f'{y}.csv')
        if got:
            cache[str(y)] = got
            print(f'  공휴일 {y} 받음 ({len(got)}일)')
        else:
            print(f'  공휴일 {y} 자료 없음 — 건너뜀')
    # mtime 을 고정해야 내용이 같을 때 파일도 같다 (헛커밋 방지)
    with open(CACHE, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        gz.write(json.dumps(cache, ensure_ascii=False).encode('utf-8'))
    return cache


def build():
    raw = fetch()
    days = {}
    for year, table in raw.items():
        for date, names in table.items():
            if names:
                days[date] = names[0]
    years = sorted(int(y) for y in raw)
    return {
        "weekdaysOnly": True,
        "holidays": days,
        # 자료가 있는 기간. 이 밖의 날짜는 공휴일 판정을 할 수 없다.
        "from": f'{min(years)}-01-01' if years else None,
        "to": f'{max(years)}-12-31' if years else None,
    }


if __name__ == '__main__':
    b = build()
    print(f"공휴일 {len(b['holidays'])}일  ({b['from']} ~ {b['to']})")
    for d, n in sorted(b['holidays'].items())[:6]:
        print(f'  {d}  {n}')

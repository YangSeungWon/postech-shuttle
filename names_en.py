"""POSTECH 공식 영문 명칭.

국문·영문 캠퍼스 안내도의 같은 data-id 를 짝지어 대조표를 만든다.
OSM 의 name:en 보다 이쪽을 우선한다.
"""
import html as H
import json, os, re, urllib.request

KO = 'https://postech.ac.kr/kor/university-introduction/campus_map.do'
EN = 'https://postech.ac.kr/eng/about/campus_map.do'
CACHE = 'campus_names.json'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}

# 안내도 표기와 OSM 표기가 다른 것들
ALIAS = {
    '대학체육관': '체육관',
    '포항가속기연구소': '가속기연구소',
    '포항4세대방사광가속기': '가속기연구소',
    '바이오오픈이노베이션센터': '바이오오픈이노베이션센터 (BOIC)',
    'e-Sports COLOSSEUM': 'e-Sports 콜로세움',
    '대학본부 (Administration Building)': '대학본부',
}


def _pairs(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        h = r.read().decode('utf-8', 'replace')
    return {m.group(1): H.unescape(m.group(2)).strip()
            for m in re.finditer(r'data-id="(\d+)"\s+title="([^"]*)"', h)}


def load(cache=CACHE, refresh=False):
    if not refresh and os.path.exists(cache):
        return json.load(open(cache))
    ko, en = _pairs(KO), _pairs(EN)
    table = {ko[k]: en[k] for k in ko
             if k in en and ko[k] and en[k] and ko[k] != en[k]}
    json.dump(table, open(cache, 'w'), ensure_ascii=False, indent=1)
    return table


_norm = lambda s: re.sub(r'[\s()（）]|\(.*?\)', '', s).lower()


def official(name, table=None):
    """국문 이름 → 공식 영문명 (없으면 None)"""
    t = table if table is not None else load()
    if name in t:
        return t[name]
    if name in ALIAS and ALIAS[name] in t:
        return t[ALIAS[name]]
    n = _norm(name)
    for k, v in t.items():
        if _norm(k) == n:
            return v
    return None


if __name__ == '__main__':
    t = load(refresh=True)
    print(f'대조표 {len(t)}건')
    for k in ['박태준학술정보관', '대학체육관', '지곡회관', '학생회관',
              '포항가속기연구소', '나노융합기술원', '바이오오픈이노베이션센터']:
        print(f'  {k:22s} → {official(k, t)}')

import json, re
import names_en

BBOX = (36.007, 36.028, 129.312, 129.332)
# 목적지로 쓸 만한 종류만
# 학교는 학교 하나로 본다. amenity=school 이 학교 자체이고 building=school 은
# 그 안의 동(棟)이다 — 둘 다 받으면 포항제철공고는 사라지고 기성관·심기관·
# 웅지료만 남는다. 셔틀 타는 사람이 찍을 곳은 학교지 그 안의 동이 아니다.
KEEP_TAGS = {
    'building': {'university', 'dormitory', 'commercial', 'public', 'retail'},
    'amenity': {'library', 'cafe', 'restaurant', 'fast_food', 'college', 'university',
                'school', 'clinic', 'pharmacy', 'bank', 'post_office', 'theatre', 'arts_centre'},
    'leisure': {'sports_centre', 'stadium', 'fitness_centre'},
    'shop': {'convenience', 'supermarket', 'books'},
    'office': {'research'},
}
# 사람이 목적지로 삼지 않는 설비 — 변전소·발전동 따위
DROP = re.compile(r'^[0-9]{1,3}$|아파트|주차|Parking|번길|^gate|^posville'
                  r'|변전|^동력동$', re.I)


def _load_json(path):
    """.json 이 없으면 같은 이름의 .gz 를 읽는다 (원본 덤프는 압축 보관)."""
    import gzip, os
    if os.path.exists(path):
        return json.load(open(path))
    with gzip.open(path + '.gz') as f:
        return json.load(f)


def load(path='osm.json'):
    els = _load_json(path)['elements']
    official = names_en.load()
    out, seen = [], set()
    for e in els:
        t = e.get('tags', {})
        # 한글 이름이 따로 적혀 있으면 그것이 이 목록의 이름이다 —
        # "Pohang Accelerator Lab" 은 포항3세대방사광가속기이고,
        # "대학본부 (Administration Building)" 은 그냥 대학본부다.
        name = (t.get('name:ko') or t.get('name', '')).strip()
        lat = e.get('lat') or e.get('center', {}).get('lat')
        lon = e.get('lon') or e.get('center', {}).get('lon')
        if not name or lat is None or DROP.search(name):
            continue
        if not (BBOX[0] < lat < BBOX[1] and BBOX[2] < lon < BBOX[3]):
            continue
        kind = next((f'{k}:{t[k]}' for k, vals in KEEP_TAGS.items()
                     if t.get(k) in vals), None)
        if not kind:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        # 공식 명칭이 있으면 OSM name:en 보다 우선한다
        en = (names_en.official(name, official) or t.get('name:en')
              or (t.get('name', '') if not re.search(r'[가-힣]', t.get('name', '')) else '')
              or '').strip()
        p = {"n": name, "ll": [round(lat, 6), round(lon, 6)], "k": kind.split(':')[1]}
        if en and en != name:
            p["en"] = en
        out.append(p)
    out.sort(key=lambda p: p['n'])
    return out

if __name__ == '__main__':
    p = load()
    print(len(p), '개')
    for x in p: print(' ', x['n'], x['k'])

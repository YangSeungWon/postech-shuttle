import json, re
import names_en

BBOX = (36.007, 36.028, 129.312, 129.332)
# 목적지로 쓸 만한 종류만
KEEP_TAGS = {
    'building': {'university', 'dormitory', 'school', 'commercial', 'public', 'retail'},
    'amenity': {'library', 'cafe', 'restaurant', 'fast_food', 'college', 'university',
                'clinic', 'pharmacy', 'bank', 'post_office', 'theatre', 'arts_centre'},
    'leisure': {'sports_centre', 'stadium', 'fitness_centre'},
    'shop': {'convenience', 'supermarket', 'books'},
    'office': {'research'},
}
DROP = re.compile(r'^[0-9]{1,3}$|아파트|주차|Parking|번길|^gate|^posville', re.I)


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
        name = t.get('name', '').strip()
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
        en = (names_en.official(name, official) or t.get('name:en') or '').strip()
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

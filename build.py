import json, os, time, urllib.request, hashlib
from stops import STOPS, CANON
import pois, walkgraph, i18n_src

DATA = json.load(open('data.json'))
CACHE = 'osrm_cache.json'
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def leg(a, b):
    """도로를 따라가는 a→b 경로 좌표열 [[lat,lng],...]"""
    key = f"{a}|{b}"
    if key in cache:
        return cache[key]
    (la, ga), (lb, gb) = STOPS[a], STOPS[b]
    url = (f"https://router.project-osrm.org/route/v1/driving/"
           f"{ga},{la};{gb},{lb}?overview=full&geometries=geojson")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                j = json.load(r)
            if j.get('code') == 'Ok':
                coords = [[round(c[1], 6), round(c[0], 6)]
                          for c in j['routes'][0]['geometry']['coordinates']]
                cache[key] = coords
                json.dump(cache, open(CACHE, 'w'))
                time.sleep(0.35)
                return coords
        except Exception as e:
            print('  retry', a, '->', b, e)
            time.sleep(2)
    print('  !! OSRM 실패, 직선 대체:', a, '->', b)
    cache[key] = [[la, ga], [lb, gb]]
    return cache[key]

def path_for(stop_names):
    """정류장 순서 → {coords, idx} (idx[i] = coords에서 i번째 정류장의 위치)"""
    coords, idx = [], [0]
    for a, b in zip(stop_names, stop_names[1:]):
        seg = leg(a, b)
        if coords and seg and coords[-1] == seg[0]:
            seg = seg[1:]
        coords += seg
        idx.append(len(coords) - 1)
    return {"coords": coords, "idx": idx}

paths, out_routes = {}, []

def register(stop_names):
    k = hashlib.md5('|'.join(stop_names).encode()).hexdigest()[:10]
    if k not in paths:
        print('  path', ' → '.join(stop_names))
        paths[k] = path_for(stop_names)
    return k

print('순환노선')
for r in DATA['routes']:
    out_routes.append({
        "id": r["id"], "kind": "circulation", "number": r["number"],
        "name": r["name"], "subtitle": r.get("subtitle", ""),
        "color": r["color"], "period": r.get("period", ""),
        "stops": r["stops"], "path": register(r["stops"]),
        "trips": r["rows"],
    })

print('확장노선')
for e in DATA['extensions']:
    for sg in e['segments']:
        out_routes.append({
            "id": f"{e['id']}:{sg['id']}", "kind": "extension",
            "number": "지" if e['id'] == 'jigok' else "유",
            "name": f"{e['name']} · {sg['name']}",
            "subtitle": sg.get("description", ""),
            "color": e["color"], "period": sg.get("period", ""),
            "stops": sg["stops"], "path": register(sg["stops"]),
            "trips": [sg["times"]],
        })

POIS = pois.load()
WALK = walkgraph.build()
EN = i18n_src.load()
json.dump({"stops": {k: list(v) for k, v in STOPS.items()},
           "canon": CANON, "paths": paths, "routes": out_routes, "pois": POIS, "walk": WALK, "en": EN},
          open('map-data.json', 'w'), ensure_ascii=False)
print(f"\n노선 {len(out_routes)}개, 경로 {len(paths)}종, 장소 {len(POIS)}곳, "
      f"보행노드 {len(WALK['nodes'])//2}개, "
      f"영문 정류장 {len(EN['stops'])}개, "
      f"{os.path.getsize('map-data.json')/1024:.0f}KB")

"""OSM 보행 가능 도로에서 보행 그래프를 만들어 정수 배열로 압축한다.

런타임에 외부 경로탐색 API를 부르지 않기 위해 그래프 자체를 페이지에 싣는다.
좌표는 bbox 좌하단 기준 1e-6도 단위 정수로 저장해 용량을 줄인다.
"""
import json, math
from collections import defaultdict, deque
import elevation

LAT0, LNG0 = 36.0030, 129.3110
SCALE = 1_000_000
# 계단·비포장은 실제로 더 오래 걸린다
COST = {'steps': 1.8, 'track': 1.2, 'path': 1.1}



def _load_json(path):
    """.json 이 없으면 같은 이름의 .gz 를 읽는다 (원본 덤프는 압축 보관)."""
    import gzip, os
    if os.path.exists(path):
        return json.load(open(path))
    with gzip.open(path + '.gz') as f:
        return json.load(f)


def haversine(a, b):
    R = 6371000
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    la = math.radians((a[0] + b[0]) / 2)
    return R * math.hypot(dlat, dlng * math.cos(la))


def build(path='walk.json'):
    ways = _load_json(path)['elements']

    pos = {}                                   # osm node id -> (lat, lng)
    adj = defaultdict(list)                    # osm id -> [(other, weight10, 횡단보도?)]
    crossings = []                             # 지도에 그릴 횡단보도 선
    for w in ways:
        t = w['tags']
        w10 = round(COST.get(t.get('highway'), 1.0) * 10)
        xing = 1 if (t.get('footway') == 'crossing' or t.get('crossing')) else 0
        ids, geo = w['nodes'], w['geometry']
        for i in range(len(ids)):
            pos[ids[i]] = (geo[i]['lat'], geo[i]['lon'])
        if xing:
            crossings.append([[round(p['lat'], 6), round(p['lon'], 6)] for p in geo])
        for a, b in zip(ids, ids[1:]):
            adj[a].append((b, w10, xing))
            adj[b].append((a, w10, xing))

    # 가장 큰 연결 요소만 남긴다 (섬처럼 떨어진 조각은 길찾기에 방해)
    seen, best = set(), []
    for start in adj:
        if start in seen:
            continue
        comp, q = [], deque([start])
        seen.add(start)
        while q:
            n = q.popleft(); comp.append(n)
            for m, _, _ in adj[n]:
                if m not in seen:
                    seen.add(m); q.append(m)
        if len(comp) > len(best):
            best = comp

    keep = set(best)
    order = sorted(keep)
    idx = {osm: i for i, osm in enumerate(order)}

    nodes = []
    for osm in order:
        lat, lng = pos[osm]
        nodes.append(round((lat - LAT0) * SCALE))
        nodes.append(round((lng - LNG0) * SCALE))

    # 엣지는 [a, b, 가중치×10, 횡단보도여부] 네 값 묶음
    edges, done = [], set()
    for a in keep:
        for b, w10, xing in adj[a]:
            if b not in keep:
                continue
            key = (min(a, b), max(a, b))
            if key in done:
                continue
            done.add(key)
            edges += [idx[a], idx[b], w10, xing]

    # 고도 — SRTM 30m 은 지점별로 몇 m 씩 튀므로 이웃 평균으로 한 번 다듬는다.
    # 다듬지 않으면 없는 오르내림이 생겨 걷는 시간이 부풀려진다.
    coords = [pos[osm] for osm in order]
    raw = elevation.fetch([(round(a, 5), round(b, 5)) for a, b in coords])
    nb = defaultdict(list)
    for i in range(0, len(edges), 4):
        a, b = edges[i], edges[i + 1]
        nb[a].append(b); nb[b].append(a)
    ele = [round(sum([raw[i]] + [raw[j] for j in nb[i]]) / (1 + len(nb[i])))
           for i in range(len(raw))]

    return {"lat0": LAT0, "lng0": LNG0, "scale": SCALE,
            "nodes": nodes, "edges": edges, "ele": ele, "crossings": crossings}


if __name__ == '__main__':
    g = build()
    n, e = len(g['nodes']) // 2, len(g['edges']) // 4
    print(f'노드 {n}, 엣지 {e}, 고도 {min(g["ele"])}~{max(g["ele"])}m, '
          f'횡단보도 {len(g["crossings"])}개')
    print(f'JSON {len(json.dumps(g)) / 1024:.0f}KB')

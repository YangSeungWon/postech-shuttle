"""정류장 사이 차량 경로를 OSM 추출본에서 직접 계산한다.

OSRM 공개 서버를 쓰면 그쪽 도로 데이터가 우리 추출본과 달라서 경유지가 엉뚱한
길에 스냅된다. 보행 그래프와 같은 원본(walk.json)으로 계산하면 경유지를 준
그대로 따라가고, 네트워크 없이도 다시 빌드할 수 있다.
"""
import heapq, json, math, os, gzip
from collections import defaultdict

# 차가 다닐 수 없는 길
NOT_DRIVABLE = {'footway', 'steps', 'path', 'cycleway', 'pedestrian', 'bridleway',
                'corridor', 'platform', 'construction', 'proposed'}
# 큰길을 선호하도록 가중치를 준다 (버스는 이면도로를 잘 쓰지 않는다)
CLASS_COST = {
    'motorway': .8, 'trunk': .8, 'primary': .85, 'secondary': .9,
    'tertiary': .95, 'unclassified': 1.0, 'residential': 1.15,
    'living_street': 1.4, 'service': 1.5, 'track': 3.0,
}


def _load(path='walk.json'):
    if os.path.exists(path):
        return json.load(open(path))['elements']
    with gzip.open(path + '.gz') as f:
        return json.load(f)['elements']


def haversine(a, b):
    R = 6371000
    return R * math.hypot(math.radians(b[0] - a[0]),
                          math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)))


class Graph:
    def __init__(self, path='walk.json'):
        self.pos = {}
        self.adj = defaultdict(list)
        for w in _load(path):
            t = w['tags']
            hw = t.get('highway')
            if not hw or hw in NOT_DRIVABLE:
                continue
            if t.get('access') in ('private', 'no') or t.get('motor_vehicle') == 'no':
                continue
            mult = CLASS_COST.get(hw, 1.2)
            ids, geo = w['nodes'], w['geometry']
            for i, nid in enumerate(ids):
                self.pos[nid] = (geo[i]['lat'], geo[i]['lon'])
            oneway = t.get('oneway') in ('yes', '1', 'true')
            rev = t.get('oneway') == '-1'
            for a, b in zip(ids, ids[1:]):
                d = haversine(self.pos[a], self.pos[b]) * mult
                if not rev:
                    self.adj[a].append((b, d))
                if not oneway:
                    self.adj[b].append((a, d))
                elif rev:
                    self.adj[b].append((a, d))
        self.ids = list(self.pos)

    def snap(self, ll):
        return min(self.ids, key=lambda n: haversine(self.pos[n], ll))

    def path(self, src, dst):
        """노드 src→dst 최단 경로의 노드 목록"""
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, n = heapq.heappop(pq)
            if n == dst:
                break
            if d > dist.get(n, math.inf):
                continue
            for m, w in self.adj[n]:
                nd = d + w
                if nd < dist.get(m, math.inf):
                    dist[m] = nd
                    prev[m] = n
                    heapq.heappush(pq, (nd, m))
        if dst not in dist:
            return None
        out, n = [], dst
        while n != src:
            out.append(n)
            n = prev[n]
        out.append(src)
        return out[::-1]

    def route(self, points):
        """[(lat,lng), ...] 을 순서대로 지나는 좌표열"""
        nodes = [self.snap(p) for p in points]
        coords = []
        for a, b in zip(nodes, nodes[1:]):
            seg = self.path(a, b)
            if seg is None:
                return None
            pts = [list(self.pos[n]) for n in seg]
            coords += pts[1:] if coords else pts
        return [[round(a, 6), round(b, 6)] for a, b in coords]


BIG = ('motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link')


def big_road_edges(path='walk.json'):
    """큰길의 연속한 두 점 묶음. 셔틀은 큰길로 나가지 않으므로 검사에 쓴다."""
    out = set()
    for w in _load(path):
        if w['tags'].get('highway') not in BIG:
            continue
        g = w['geometry']
        for a, b in zip(g, g[1:]):
            k = (round(a['lat'], 6), round(a['lon'], 6),
                 round(b['lat'], 6), round(b['lon'], 6))
            out.add(k)
            out.add(k[2:] + k[:2])
    return out


def uses_big_road(coords, edges):
    """경로가 큰길 구간을 실제로 지나는지 (근접이 아니라 통행)"""
    return [a for a, b in zip(coords, coords[1:])
            if (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6)) in edges]


if __name__ == '__main__':
    g = Graph()
    print(f'차량 노드 {len(g.pos)}개')
    r = g.route([(36.00476, 129.31862), (36.008683, 129.328533)])
    print('유강사거리 → 효자시장:', len(r), '점')

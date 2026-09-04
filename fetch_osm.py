"""OSM 원본을 다시 받는다.

캠퍼스 건물·도로는 자주 바뀌지 않으므로 기본 빌드에서는 건드리지 않고,
필요할 때만(`refresh.py --osm`) 돌린다. 결과는 압축해 저장소에 둔다.
"""
import gzip, json, time, urllib.parse, urllib.request

API = 'https://overpass-api.de/api/interpreter'
UA = {'User-Agent': 'postech-shuttle-refresh/1.0'}

# 캠퍼스 일대의 이름 있는 지점 (장소 검색용)
PLACES = '''[out:json][timeout:120];
(
  node(around:2500,36.0107,129.3222)["name"];
  way(around:2500,36.0107,129.3222)["name"];
);
out center tags;'''

# 신호등 위치 (횡단보도에 신호가 있는지 판단용)
SIGNALS = '''[out:json][timeout:120];
node(36.0030,129.3110,36.0295,129.3320)["highway"="traffic_signals"];
out center;'''

# 걸을 수 있는 길 (보행 그래프·차량 경로·횡단보도)
WAYS = '''[out:json][timeout:180];
way(36.0030,129.3110,36.0295,129.3320)
  ["highway"]
  ["highway"!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway)$"]
  ["foot"!="no"]
  ["access"!~"^(private|no)$"];
out geom;'''


def _post(query):
    data = urllib.parse.urlencode({'data': query}).encode()
    req = urllib.request.Request(API, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=200) as r:
        return json.load(r)


def _save(obj, path):
    # mtime 을 고정해야 내용이 같을 때 파일도 같다 (헛커밋 방지)
    with open(path, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        gz.write(json.dumps(obj, ensure_ascii=False).encode('utf-8'))
    return len(obj.get('elements', []))


def run():
    n1 = _save(_post(PLACES), 'osm.json.gz')
    print(f'  장소 {n1}건')
    time.sleep(3)                       # Overpass 에 연달아 던지지 않는다
    n2 = _save(_post(WAYS), 'walk.json.gz')
    print(f'  길 {n2}건')
    time.sleep(3)
    n3 = _save(_post(SIGNALS), 'signals.json.gz')
    print(f'  신호등 {n3}건')
    return n1, n2, n3


if __name__ == '__main__':
    run()

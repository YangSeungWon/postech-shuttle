"""보행 그래프 노드의 고도를 받아 온다 (SRTM 30m).

캠퍼스 고저차가 40m 넘게 나서 오르막·내리막에 따라 걷는 시간이 달라진다.
평지 가정으로는 양방향이 같은 시간으로 나와 실제와 어긋난다.
"""
import json, os, time, urllib.request, urllib.parse

CACHE = 'elev_cache.json'
BATCH = 100          # opentopodata 한 번에 100지점
PAUSE = 1.1          # 초당 1회 제한


def _key(lat, lng):
    return f'{lat:.5f},{lng:.5f}'


def _load_cache(path):
    """.json 이 없으면 압축본을 읽는다 (저장소에는 .gz 로 둔다)."""
    import gzip
    if os.path.exists(path):
        return json.load(open(path))
    if os.path.exists(path + '.gz'):
        with gzip.open(path + '.gz') as f:
            return json.load(f)
    return {}


def fetch(points, cache_path=CACHE):
    """points: [(lat, lng)] → [고도(m)]  (없으면 0)"""
    cache = _load_cache(cache_path)
    todo = [p for p in points if _key(*p) not in cache]
    todo = list(dict.fromkeys(todo))
    print(f'  고도 조회 {len(todo)}지점 (캐시 {len(cache)})')

    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        locs = '|'.join(f'{a},{b}' for a, b in chunk)
        url = ('https://api.opentopodata.org/v1/srtm30m?locations='
               + urllib.parse.quote(locs, safe='|,'))
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    res = json.load(r)['results']
                for p, e in zip(chunk, res):
                    cache[_key(*p)] = e['elevation'] if e['elevation'] is not None else 0
                break
            except Exception as ex:
                print(f'   재시도 {i}: {ex}')
                time.sleep(3 * (attempt + 1))
        else:
            for p in chunk:
                cache[_key(*p)] = 0
        json.dump(cache, open(cache_path, 'w'))
        print(f'   {min(i + BATCH, len(todo))}/{len(todo)}', end='\r')
        time.sleep(PAUSE)

    return [cache.get(_key(*p), 0) for p in points]

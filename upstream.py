"""원본 시간표를 다시 가져와 우리가 가진 것과 비교한다.

data.json 은 안내 페이지에서 긁어온 것이라, 학교가 시간표를 바꿔도 우리는
알 수 없다. 주기적으로 다시 받아 달라진 곳을 짚어 준다.
"""
import json, re, urllib.request

SRC = 'https://peppy-beijinho-78668b.netlify.app/'
UA = {'User-Agent': 'postech-shuttle-refresh/1.0'}


def fetch(url=SRC):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        html = r.read().decode('utf-8', 'replace')
    m = re.search(r'const\s+DATA\s*=\s*(\{.*?\});\s*$', html, re.M | re.S)
    if not m:
        raise ValueError('안내 페이지에서 DATA 를 찾지 못했습니다')
    return json.loads(m.group(1))


def _trips(data):
    """{노선이름: [[시각,...], ...]} — 비교하기 쉬운 모양으로"""
    out = {}
    for r in data.get('routes', []):
        out[r['id']] = {'stops': r['stops'], 'rows': r['rows']}
    for e in data.get('extensions', []):
        for s in e.get('segments', []):
            out[f"{e['id']}:{s['id']}"] = {'stops': s['stops'], 'rows': [s['times']]}
    return out


def diff(old, new):
    """사람이 읽을 수 있는 변경 목록"""
    a, b = _trips(old), _trips(new)
    lines = []
    for k in sorted(set(a) | set(b)):
        if k not in a:
            lines.append(f'+ 노선 추가: {k}')
        elif k not in b:
            lines.append(f'- 노선 삭제: {k}')
        else:
            if a[k]['stops'] != b[k]['stops']:
                lines.append(f'~ {k} 정류장 변경')
                lines.append(f'    이전: {" → ".join(a[k]["stops"])}')
                lines.append(f'    이후: {" → ".join(b[k]["stops"])}')
            if a[k]['rows'] != b[k]['rows']:
                n0, n1 = len(a[k]['rows']), len(b[k]['rows'])
                lines.append(f'~ {k} 시간표 변경 (운행 {n0}회 → {n1}회)')
    return lines


if __name__ == '__main__':
    new = fetch()
    old = json.load(open('data.json'))
    d = diff(old, new)
    print('\n'.join(d) if d else '시간표에 변경 없음')

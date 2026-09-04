"""영문 표기.

원래는 기존 안내 페이지(timetable.html)에서 뽑아 썼다. 그 페이지를 지도 안으로
흡수하면서, 뽑아낸 결과를 en_names.json 에 떼어 두고 그것을 읽는다.
원본에서 다시 뽑아야 하면 extract() 를 쓴다.
"""
import json, re, subprocess, tempfile, os


def _obj_after(html, marker):
    i = html.index(marker)
    k = html.index('{', i)
    depth = 0
    for p in range(k, len(html)):
        if html[p] == '{':
            depth += 1
        elif html[p] == '}':
            depth -= 1
            if depth == 0:
                return html[k:p + 1]
    raise ValueError(marker)


def _eval_js(literal):
    """JS 객체 리터럴을 node 로 JSON 화한다 (따옴표 없는 키가 섞여 있다)."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write('console.log(JSON.stringify(' + literal + '))')
        path = f.name
    try:
        out = subprocess.run(['node', path], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)
    finally:
        os.unlink(path)


def load(path='en_names.json'):
    return json.load(open(path))


def extract():
    """원본 안내 페이지에서 다시 뽑는다 (평소에는 en_names.json 을 쓴다)"""
    import urllib.request
    req = urllib.request.Request(
        'https://peppy-beijinho-78668b.netlify.app/',
        headers={'User-Agent': 'postech-shuttle/1.0'})
    with urllib.request.urlopen(req, timeout=40) as r:
        h = r.read().decode('utf-8', 'replace')
    return {
        'stops': _eval_js(_obj_after(h, 'const STOP_EN')),
        'routes': _eval_js(_obj_after(h, 'const ROUTE_EN')),
    }


if __name__ == '__main__':
    d = load()
    print(f"정류장 {len(d['stops'])}개, 노선 {len(d['routes'])}개")
    for k, v in list(d['stops'].items())[:3]:
        print(' ', k, '→', v)
    for k, v in list(d['routes'].items())[:2]:
        print(' ', k, '→', v.get('name'))

"""기존 안내 페이지(timetable.html)에 이미 있는 영문 표기를 그대로 가져온다."""
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


def load(path='timetable.html'):
    h = open(path).read()
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

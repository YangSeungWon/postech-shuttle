"""바탕 지도 스타일을 만든다.

래스터 타일에 흑백 필터를 씌우면 도로 위계와 라벨까지 같이 뭉개진다.
벡터 스타일을 직접 손봐서, 바탕은 물러나되 길의 구조와 이름은 살아 있게 한다.
"""
import json, urllib.request

SRC = 'https://tiles.openfreemap.org/styles/positron'

GROUND = '#E9EBEF'      # 땅 — 흰 도로가 드러나도록 살짝 어둡게
ROAD = '#FFFFFF'        # 도로는 흰색으로 비워 구조만 남긴다
CASING = '#D3D8DF'      # 도로 테두리로 위계를 만든다
BUILDING = '#DFE3E9'
GREEN = '#E3E9E2'
WATER = '#D5E1EA'
INK = '#5A606B'         # 라벨
HALO = '#FFFFFF'

# 레이어별로 무엇을 덮어쓸지
PAINT = {
    'background':            {'background-color': GROUND},
    'park':                  {'fill-color': GREEN},
    'landcover_wood':        {'fill-color': GREEN},
    'landuse_residential':   {'fill-color': GROUND},
    'water':                 {'fill-color': WATER},
    'waterway':              {'line-color': WATER},
    'building':              {'fill-color': BUILDING, 'fill-outline-color': '#D2D7DE'},
    'highway_path':          {'line-color': '#DCE1E7'},
    'highway_minor':         {'line-color': ROAD},
    'highway_major_casing':  {'line-color': CASING},
    'highway_major_inner':   {'line-color': ROAD},
    'highway_major_subtle':  {'line-color': CASING},
    'highway_motorway_casing': {'line-color': '#C9CFD8'},
    'highway_motorway_inner':  {'line-color': '#FDFDFE'},
    'highway_motorway_subtle': {'line-color': '#CDD3DB'},
    'highway_motorway_bridge_casing': {'line-color': '#C9CFD8'},
    'highway_motorway_bridge_inner':  {'line-color': '#FDFDFE'},
    'railway':               {'line-color': '#CFD4DB'},
    'railway_transit':       {'line-color': '#CFD4DB'},
    'railway_service':       {'line-color': '#D8DCE2'},
    'boundary_2':            {'line-color': '#C2C8D0'},
    'boundary_3':            {'line-color': '#CDD2DA'},
}
# 글자는 또렷하게 — 바탕이 물러난 만큼 이름은 읽혀야 한다
LABELS = ('highway-name-path', 'highway-name-minor', 'highway-name-major',
          'label_other', 'label_village', 'label_town', 'label_city',
          'water_name_point_label', 'water_name_line_label', 'waterway_line_label')


def build(out='style-muted.json', lang='ko'):
    # 기본 User-Agent 는 거부당한다
    req = urllib.request.Request(SRC, headers={'User-Agent': 'postech-shuttle/1.0'})
    with urllib.request.urlopen(req, timeout=40) as r:
        style = json.load(r)

    style['name'] = 'POSTECH shuttle base'
    # 음영 기복 래스터는 캠퍼스 축척에서 얼룩으로만 보인다
    style['layers'] = [l for l in style['layers'] if l.get('source') != 'ne2_shaded']
    style['sources'].pop('ne2_shaded', None)

    # 라벨 표기 언어. 원래 스타일은 로마자와 현지명을 두 줄로 함께 붙인다.
    order = ({'ko': ['name:ko', 'name:nonlatin', 'name', 'name:latin'],
              'en': ['name:en', 'name:latin', 'name']}[lang])
    ko_first = ['coalesce'] + [['get', k] for k in order]
    for l in style['layers']:
        if l['type'] == 'symbol' and 'text-field' in l.get('layout', {}):
            if 'ref' not in json.dumps(l['layout']['text-field']):   # 도로번호 방패는 그대로
                l['layout']['text-field'] = ko_first

    for l in style['layers']:
        if l['id'] in PAINT:
            l.setdefault('paint', {}).update(PAINT[l['id']])
        if l['id'] in LABELS:
            l.setdefault('paint', {}).update({
                'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.4,
            })

    json.dump(style, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
    return style


if __name__ == '__main__':
    import os
    for lang, out in (('ko', 'style-muted.json'), ('en', 'style-muted-en.json')):
        s = build(out, lang)
        print(f"{lang}: 레이어 {len(s['layers'])}개, {os.path.getsize(out)/1024:.0f}KB")

"""원본을 다시 받아 산출물을 갱신한다.

정적 파일에 다 구워 넣는 구조라 빠르고 오프라인도 되지만, 원본이 바뀌어도
모른다는 대가가 있다. 주기적으로 이걸 돌려 메운다.

  python3 refresh.py            시간표·공휴일만 (가볍다)
  python3 refresh.py --osm      OSM 도로·건물까지 다시 받는다 (느리다)
"""
import json, os, subprocess, sys

CHANGED = []


def sh(*cmd):
    subprocess.run(cmd, check=True)


def _stamp_checked(changed):
    """원본을 확인한 날짜를 남긴다. 시간표가 바뀌었다면 시행일은 사람이 넣어야 한다."""
    import datetime
    meta = json.load(open('source.json'))
    meta['checkedAt'] = datetime.date.today().isoformat()
    if changed:
        meta['effectiveFrom'] = None      # 새 시행일을 확인해 넣어야 한다
    json.dump(meta, open('source.json', 'w'), ensure_ascii=False, indent=2)


def refresh_timetable():
    import upstream
    try:
        new = upstream.fetch()
    except Exception as e:
        print(f'  시간표 원본을 받지 못했습니다: {e}')
        return
    old = json.load(open('data.json'))
    if new == old:
        print('  시간표 변경 없음')
        _stamp_checked(False)
        return
    lines = upstream.diff(old, new)
    json.dump(new, open('data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    _stamp_checked(True)
    CHANGED.append(('시간표', (lines or ['(형식만 달라졌습니다)'])
                    + ['**시행일을 확인해 `source.json` 의 `effectiveFrom` 에 넣어 주세요.**']))
    print('  시간표 갱신:\n    ' + '\n    '.join(lines))


def refresh_holidays():
    import holidays
    before = set(holidays._load_cache())
    holidays.fetch()
    after = set(holidays._load_cache())
    new = sorted(after - before)
    if new:
        CHANGED.append(('공휴일', [f'{y}년 자료 추가' for y in new]))
    print(f'  공휴일 자료: {sorted(after)}')


def refresh_osm():
    """도로·건물은 자주 바뀌지 않아 기본으로는 건너뛴다"""
    import fetch_osm
    fetch_osm.run()
    CHANGED.append(('OSM', ['도로·건물 자료를 다시 받았습니다']))


def main():
    print('원본 갱신')
    refresh_timetable()
    refresh_holidays()
    if '--osm' in sys.argv:
        refresh_osm()

    print('다시 빌드')
    sh('python3', 'basemap.py')
    sh('python3', 'build.py')
    data = open('map-data.json').read()
    open('map-data.js', 'w').write('const DATA = ' + data + ';\n')

    if CHANGED:
        summary = '\n'.join(f'### {k}\n' + '\n'.join(f'- {x}' for x in v) for k, v in CHANGED)
    else:
        summary = ''
    # 요약은 파일로 넘긴다 — 셸에 그대로 끼워 넣으면 따옴표에 깨진다
    open('refresh-summary.md', 'w').write(summary)
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f:
            f.write(f'changed={"yes" if CHANGED else "no"}\n')
            f.write(f'kinds={",".join(k for k, _ in CHANGED)}\n')
    print('\n' + (summary or '원본에 변경 없음'))


if __name__ == '__main__':
    main()

# POSTECH 셔틀버스 지도

공개 셔틀버스 시간표를 지도 위에서 보여 주는 정적 웹페이지입니다.
`bus.ysw.kr` 에 GitHub Pages로 배포합니다.

* **지도** `map.html` — 노선·정류장, 시간표로 계산한 버스 위치, 내 위치 기준 도착 예정, 길찾기
* **시간표** `index.html` — 기존 안내 페이지

> 버스 위치와 도착 시각은 **공개 시간표를 보간한 예상값**이며 차량 GPS가 아닙니다.
> 교통 상황에 따라 1~2분 차이가 날 수 있습니다.

## 구조

런타임에는 지도 타일 말고 외부 호출이 없습니다. 시간표, 도로를 따라가는
노선 도형, 캠퍼스 건물 좌표, 보행 그래프를 전부 빌드 때 파일로 구워 넣습니다.

| 파일 | 역할 |
|---|---|
| `map.html` | 화면과 스타일 |
| `map.js` | 지도·패널·길찾기 UI |
| `planner.js` | 시간표 기반 경로탐색 (RAPTOR 계열) |
| `walk.js` | OSM 보행 그래프 위의 Dijkstra |
| `map-data.js` | 빌드 산출물 (노선·정류장·건물·보행 그래프) |

## 다시 빌드하기

```sh
python3 build.py                                    # map-data.json 생성
python3 -c "print('const DATA = '+open('map-data.json').read()+';')" > map-data.js
```

`build.py` 는 다음을 조합합니다.

* `data.json` — 기존 안내 페이지에서 추출한 노선·시간표
* `stops.py` — 정류장 좌표 **(근사값)**
* `pois.py` — OSM에서 뽑은 캠퍼스 건물 (목적지 후보)
* `walkgraph.py` — OSM 보행 그래프
* OSRM 공개 서버 — 정류장 사이 도로 경로 (`osrm_cache.json` 에 캐시)

원본 OSM 덤프는 `osm.json.gz`, `walk.json.gz` 로 보관되어 있어 네트워크
없이도 다시 빌드할 수 있습니다 (`gunzip -k` 후 실행).

## 정류장 좌표 보정

정류장 표지판의 정확한 좌표는 공개 데이터에 없어 건물·도로 기준 **근사값**을
넣어 두었습니다. 지도 우하단 ✎ 버튼으로 보정 모드를 켜고 마커를 실제 위치로
끈 다음 **JSON 복사**를 눌러 `stops.py` 의 `STOPS` 에 반영하세요.

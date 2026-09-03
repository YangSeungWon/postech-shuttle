"""운행하지 않는 날.

셔틀은 평일만 운행한다. 원본 시간표에 요일 정보가 없어 확인한 내용을 여기에 둔다.

날짜가 고정된 공휴일은 계산할 수 있지만, 설날·추석·부처님오신날은 음력이라
해마다 달라 손으로 넣어야 한다. 넣지 않은 해는 그날도 평일로 취급되므로
연말에 한 번 갱신이 필요하다.
"""

# 매년 같은 날
FIXED = [
    (1, 1),    # 신정
    (3, 1),    # 삼일절
    (5, 5),    # 어린이날
    (6, 6),    # 현충일
    (8, 15),   # 광복절
    (10, 3),   # 개천절
    (10, 9),   # 한글날
    (12, 25),  # 성탄절
]

# 음력 기반 공휴일과 대체공휴일 — 확인한 해만 적는다 (YYYY-MM-DD)
LUNAR = {
    2026: [],   # 설날·추석·부처님오신날 미확인
}


def build():
    return {
        "weekdaysOnly": True,
        "fixed": [[m, d] for m, d in FIXED],
        "lunar": {str(y): v for y, v in LUNAR.items()},
        # 음력 공휴일이 확인된 연도 (그 밖의 해는 공휴일 판정이 불완전하다)
        "lunarKnown": [y for y, v in LUNAR.items() if v],
    }


if __name__ == '__main__':
    import json
    print(json.dumps(build(), ensure_ascii=False, indent=1))

# 공공데이터 적재 (#18)

원본 파일과 정리한 결과는 `raw/`에 저장한다. `raw/`는 `.gitignore`에 있어서 커밋되지 않는다.

## 준비 (처음 한 번)

```bash
cd Src/backend/data
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 가로수

```bash
.venv/bin/python trees.py --download   # 원본 내려받기 + 정리 → raw/trees_clean.csv
.venv/bin/python -m unittest test_trees.py   # 정리 규칙 테스트
```

정리 규칙:

- 수종이 "공분"인 행(빈 식재 자리로 보임)과 좌표가 없는 행은 뺀다.
- `source_key`(`관리청|경도|위도`)가 같은 행은 하나만 남긴다. 원본에 관리번호가 없어서 이 값을 나무의 원본 키로 쓴다.
- 구·동은 나무가 서 있는 위치 기준으로 지번 주소에서 꺼낸다. 관리청(`agency`)과 다를 수 있다.
- 주소가 비어 있으면 관리 자치구를 구로 쓰고, 동은 비워 둔다.

2026년판 기준 결과: 원본 287,636행 → 281,697그루 저장(공분 5,881, 중복 좌표 57, 좌표 없음 1 제외). 동이 비어 있는 나무는 1,404그루다.

DB에 넣는 단계는 마이그레이션(#17)이 생기면 추가한다.

## 기상

`Src/.env`에 `KMA_SERVICE_KEY`(공공데이터포털 일반 인증키, Decoding 값)를 넣고 실행한다.

```bash
.venv/bin/python weather.py                                    # 어제까지 최근 365일 → raw/weather.csv
.venv/bin/python weather.py --start 2025-01-01 --end 2025-12-31  # 기간 지정
.venv/bin/python -m unittest test_weather.py
```

- 서울 지점(108) 하나만 받아서 `region`은 `seoul`이다.
- 비가 오지 않은 날은 응답의 일강수량이 빈 값이라 0으로 저장한다.
- 일 최고기온 33℃ 이상이면 폭염(`is_heatwave`)으로 표시한다.
- 기상청은 전날 자료까지만 준다. 매일 수집은 상태 계산 엔진(#19)의 일 배치에서 이 스크립트를 부른다.

## 출처

| 데이터 | 제공 | 라이선스 |
|---|---|---|
| [서울시 가로수 위치 정보(경도, 위도)](https://data.seoul.go.kr/dataList/OA-22904/S/1/datasetView.do) | 서울특별시 정원도시국 조경과, 서울 열린데이터광장 | 공공누리 제4유형(출처표시, 상업적 이용금지, 변경금지) |
| [기상청 지상(종관, ASOS) 일자료 조회서비스](https://www.data.go.kr/data/15059093/openapi.do) | 기상청, 공공데이터포털 | 공공누리 제1유형(출처표시) |

- 가로수 데이터는 제4유형이라 원본과 정리 결과를 저장소에 올리지 않고, 내려받는 스크립트만 올린다.
- 서비스 화면(나무 지도·상세 페이지)에도 위 출처를 표시해야 한다.

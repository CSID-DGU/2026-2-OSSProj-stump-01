# ERD (초안)

> 이슈 #17. 2026-10-22까지 이의가 없으면 확정한다. 확정되면 이 문서를 기준으로 마이그레이션을 만든다.
> DB는 PostgreSQL + PostGIS 기준이다(#52에서 확정 대기).
> 실제 컬럼 타입·제약조건은 `migrations/`가 기준이다. 이 다이어그램의 타입(`varchar` 등)은 개념용이고, 실제로는 `text`를 쓴다. 현재 DB 전체 구조는 `schema.sql`에서 볼 수 있다.

수행계획서의 엔티티 9개(Tree, User, Adoption, Story, Record, Report, Weather, Fund, Notification)를 테이블로 옮겼다.
이야기의 "덧붙인 글 목록"은 여러 개라서 `story_entries` 테이블 하나를 더 두었다.

## 다이어그램

```mermaid
erDiagram
    users ||--o{ adoptions : "입양한다"
    users ||--o{ records : "기록한다"
    users ||--o{ notifications : "받는다"
    users ||--o{ reports : "처리한다(구청)"
    users ||--o{ fund_transactions : "집행 등록(구청)"
    trees ||--o{ adoptions : "입양된다"
    trees ||--o{ records : "기록된다"
    trees ||--o{ fund_transactions : "집행 대상"
    trees ||--o{ notifications : "관련 나무"
    adoptions ||--o| stories : "이야기"
    stories ||--o{ story_entries : "덧붙인 글"
    adoptions ||--o{ fund_transactions : "적립"
    records ||--o| reports : "신고 상세"
    reports ||--o{ notifications : "조치 완료 알림"
    fund_transactions ||--o{ notifications : "기금 사용 알림"

    users {
        bigint id PK
        varchar email UK
        varchar password_hash
        varchar nickname
        varchar real_name "실명(이야기 실명 공개용)"
        varchar role "citizen | officer"
        varchar agency "구청 담당자의 소속 관리청"
        timestamptz education_completed_at "교육 이수 시각, null=미이수"
        timestamptz created_at
    }

    trees {
        bigint id PK
        varchar source_key UK "관리청|경도|위도, 원본에 관리번호가 없음"
        varchar species "수종"
        geography location "Point, WGS84"
        varchar agency "관리청, 신고 배정 기준"
        varchar district "위치한 자치구"
        varchar dong "위치한 법정동"
        varchar road_name "노선"
        varchar address "지번 주소"
        varchar water_need "enough | normal | thirsty"
        varchar health_status "good | check | urgent"
        timestamptz status_updated_at "상태 계산 엔진이 마지막으로 쓴 시각"
        timestamptz created_at
    }

    adoptions {
        bigint id PK
        bigint tree_id FK
        bigint user_id FK
        varchar status "active | completed | cancelled"
        date start_date
        date end_date
        int paid_amount "모의 결제 금액"
        int discount_amount "관찰 공백 할인(#26)"
        varchar plaque_status "none | requested | issued"
        varchar sbt_status "none | issued"
        timestamptz created_at
    }

    stories {
        bigint id PK
        bigint adoption_id FK,UK
        varchar tree_name "나무에 붙인 이름"
        text body "사연"
        varchar photo_url "대표 사진"
        boolean is_public
        varchar author_display "real_name | nickname"
        timestamptz created_at
        timestamptz updated_at
    }

    story_entries {
        bigint id PK
        bigint story_id FK
        text body
        varchar photo_url
        timestamptz created_at
    }

    records {
        bigint id PK
        bigint tree_id FK
        bigint user_id FK
        varchar type "water | observe | report"
        timestamptz recorded_at
        int water_amount_ml "물주기만"
        jsonb checklist "관찰만"
        varchar photo_url
        geography location "기록한 위치, Point"
        varchar verification "none | location | photo"
        timestamptz created_at
    }

    reports {
        bigint id PK
        bigint record_id FK,UK
        varchar record_type "항상 report, 신고 기록에만 붙도록 FK에 씀"
        varchar category "leaning | broken_branch | pest | withering | other"
        varchar urgency "low | high, 유형으로 결정"
        varchar status "pending | inspecting | resolved"
        varchar agency "배정 관리청"
        boolean is_trusted "신고 시점 교육 이수 여부"
        bigint handled_by FK "처리한 구청 담당자"
        text action_note "조치 내용"
        timestamptz inspected_at
        timestamptz resolved_at
        timestamptz created_at
    }

    weather {
        date date PK
        varchar region PK "자치구 또는 seoul"
        numeric precipitation_mm
        numeric temp_avg
        numeric temp_max
        boolean is_heatwave
    }

    fund_transactions {
        bigint id PK
        varchar kind "deposit | expense"
        varchar category "plaque | tree | common"
        int amount
        bigint adoption_id FK "적립일 때"
        bigint target_tree_id FK "나무 집행일 때"
        varchar target_district "공동 집행 지역"
        text description "집행 내역"
        bigint created_by FK "집행 등록한 구청 담당자"
        timestamptz created_at
    }

    notifications {
        bigint id PK
        bigint user_id FK "수신자"
        varchar type "report_resolved | fund_used"
        bigint tree_id FK
        bigint report_id FK
        bigint fund_transaction_id FK
        varchar title
        text body
        timestamptz read_at
        timestamptz created_at
    }
```

## 상태값

DB에는 영어 코드로 저장하고, 화면에는 한국어로 보여 준다.

| 컬럼 | 코드 | 화면 표시 |
|---|---|---|
| `reports.status` | `pending` / `inspecting` / `resolved` | 확인 필요 / 현장 확인 / 조치 완료 |
| `trees.water_need` | `enough` / `normal` / `thirsty` | 충분 / 보통 / 목마름 |
| `trees.health_status` | `good` / `check` / `urgent` | 양호 / 확인 필요 / 긴급 |
| `records.type` | `water` / `observe` / `report` | 물주기 / 관찰 / 이상 신고 |
| `fund_transactions.category` | `plaque` / `tree` / `common` | 명판 / 해당 나무 / 공동 기금 |
| `users.role` | `citizen` / `officer` | 시민 / 구청 담당자 |

신고 상태는 `pending → inspecting → resolved` 순서로만 바뀐다. 되돌리기는 두지 않는다.

## 설계 결정

- **저장하지 않고 계산하는 값**: 수행계획서에는 있지만 다른 테이블에서 바로 구할 수 있어서 컬럼으로 두지 않았다. 컬럼으로 두면 원본과 값이 어긋날 수 있다.
  - 나무의 입양 여부: `adoptions`에 `status = 'active'`인 행이 있는지로 판단한다.
  - 입양의 관찰 횟수(#11): 입양 기간 동안 입양자가 남긴 `records`(`type = 'observe'`) 수를 센다.
  - 나이테 조치 표식(#21): `reports.resolved_at`으로 월별 집계한다. 별도 테이블을 두지 않는다.
- **나무당 입양자 1명**: `adoptions(tree_id)`에 `status = 'active'` 조건의 부분 유니크 인덱스를 건다.
- **기록과 신고**: 신고도 기록 3종 중 하나라서 `records`에 공통 정보(나무·작성자·사진·위치)를 두고, 신고에만 있는 처리 정보는 `reports`에 1:1로 둔다. 시민-BE는 두 행을 함께 만들고, 구청-BE는 `reports`의 처리 컬럼만 바꾼다.
  - `reports`는 `(record_id, record_type)`으로 `records(id, type)`를 참조하고 `record_type`은 항상 `report`다. 그래서 물주기·관찰 기록에 신고가 잘못 붙는 것을 DB가 막는다.
- **상태 전이**: `reports`는 `inspected_at` 없이 `inspecting`/`resolved`가 될 수 없고, `resolved`일 때만 `resolved_at`이 있다. 현장 확인을 건너뛴 조치 완료를 DB가 막는다.
- **신뢰도**: `is_trusted`는 신고할 때의 교육 이수 여부를 복사해 둔다. 나중에 이수하더라도 그전 신고의 신뢰도는 바뀌지 않는다.
- **기금**: 적립과 집행을 `fund_transactions` 한 테이블에 `kind`로 나누어 쌓는다. 잔액은 합계로 계산한다.
- **위치**: `geography(Point, 4326)`을 쓴다. 위치 확인 거리(#13)는 `ST_DWithin`, 지도 범위 조회(#4)는 공간 인덱스(GiST)로 처리한다.
- **관리청과 위치를 나눈다**: 가로수 데이터의 관리 주체(관리청)는 나무가 서 있는 자치구와 다를 수 있다(아래 "가로수 원본 데이터" 참고).
  - `agency`(관리청): 신고 배정(#20)과 구청 담당자 권한의 기준. 25개 자치구 + `서울시설공단` + `중부공원여가센터`.
  - `district`, `dong`(위치): 드릴다운(#24), 지도 필터, 공동 기금 집행 지역의 기준.
  - 둘 다 별도 테이블 없이 문자열로 둔다.

## 가로수 원본 데이터 (#18)

[서울시 가로수 위치 정보(경도, 위도)](https://data.seoul.go.kr/dataList/OA-22904/S/1/datasetView.do), 2026년판 xlsx를 확인한 결과다. 공공누리 제4유형이라 원본은 커밋하지 않는다.

- 287,636그루. 시트 27개(관리청별)이고, 각 시트의 컬럼은 `자치구`(실제로는 관리청), `노선`, `수종`, `도로명 주소`, `지번 주소`, `좌표(경도)`, `좌표(위도)` 7개다.
- **관리번호가 없다.** 그래서 `source_key`를 `관리청|경도|위도`로 만들어 유니크 키로 쓴다. 매년 새 파일로 다시 적재할 때 이 키로 같은 나무를 찾는다. 좌표가 완전히 같은 행이 58개 있어서 적재할 때 중복을 걸러 낸다.
- **관리청 ≠ 위치 자치구**: 자치구가 관리하는 나무 중 1,307그루는 다른 자치구에 서 있다(예: 용산구 관리, 마포구 공덕동 위치). `서울시설공단`(12,223그루)과 `중부공원여가센터`(727그루)는 자치구가 아닌 관리청이다.
- **동**: 따로 컬럼이 없어서 지번 주소에서 법정동을 꺼낸다(457개 동). 지번 주소가 빈 1,098그루는 동을 비워 두고, 필요하면 행정구역 경계 데이터와 공간 조인해서 채운다.
- **좌표**: WGS84 경도·위도라서 변환 없이 `geography(Point, 4326)`에 넣는다. 좌표가 없는 행은 1개다.
- **수종 "공분"(5,881행)**: 나무가 없는 빈 식재 자리로 보인다. 확인될 때까지 적재에서 뺀다.

기상 데이터는 [기상청 지상(종관, ASOS) 일자료 조회서비스](https://www.data.go.kr/data/15059093/openapi.do)(`getWthrDataList`, 서울 지점 `108`)를 쓴다. 일강수량 `sumRn`, 평균기온 `avgTa`, 최고기온 `maxTa`를 `weather`에 넣는다. 서울에 ASOS 지점이 1곳이라 `region`은 `seoul`로 시작한다.

## 담당 경계 (CLAUDE.md 시민·구청 경계 규칙)

| 테이블 | 쓰는 쪽 | 비고 |
|---|---|---|
| `reports` | 생성: 시민-BE / 상태·조치 컬럼: 구청-BE | |
| `trees.water_need`, `trees.health_status` | 상태 계산 엔진만 | 나머지는 읽기만 |
| `notifications` | 시민-BE 알림 모듈 | 구청-BE는 알림 생성 함수만 호출 |
| `fund_transactions` | `deposit`: 시민-BE(입양) / `expense`: 구청-BE | |
| `trees` 나머지 컬럼, `weather` | 공공데이터 적재 스크립트 | |

## 기본값 (2026-10-22까지 이의가 없으면 확정)

### 신고 유형과 긴급도

긴급도는 시민이 고르지 않고 신고 유형으로 정한다. 시민이 고르게 하면 대부분 "긴급"을 고르게 되어 큐 정렬이 의미가 없어진다. 시민-BE가 신고를 만들 때 아래 표대로 `urgency`를 채운다.

| `reports.category` | 화면 표시 | `urgency` |
|---|---|---|
| `leaning` | 기울어짐·쓰러짐 | `high` |
| `broken_branch` | 가지 꺾임 | `high` |
| `pest` | 병해충 의심 | `low` |
| `withering` | 시듦·고사 의심 | `low` |
| `other` | 기타 | `low` |

### 관찰 체크리스트

`records.checklist`는 항목별로 이상이 있으면 `true`인 JSON이다. 교육 콘텐츠(#34)가 정해지면 항목을 맞춘다.

```json
{ "leaf": false, "trunk_branch": true, "dry_soil": false, "trash": false }
```

| 키 | 화면 표시 |
|---|---|
| `leaf` | 잎 상태 이상(변색·마름) |
| `trunk_branch` | 줄기·가지 손상 |
| `dry_soil` | 흙이 말라 있음 |
| `trash` | 주변 쓰레기 |

### 그 밖의 기본값

- 공동 기금 집행 알림은 `target_district` 자치구의 현재 입양자(`adoptions.status = 'active'`)에게 보낸다. 나무 기금 집행 알림은 그 나무의 현재 입양자에게 보낸다.
- 기상 데이터는 서울 관측소 1곳(`region = 'seoul'`)으로 시작한다. 자치구별 값이 필요하면 방재기상관측(AWS) 자료를 따로 검토한다.
- 이 ERD에 넣지 않은 기능(교육·퀴즈 응시 기록 #10, 배지 #15, 타임캡슐 #16)은 담당자가 테이블을 추가할 때 이 문서에 이어서 적는다.

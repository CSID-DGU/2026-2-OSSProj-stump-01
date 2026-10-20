-- migrate:up
-- ERD.md(#17)의 테이블 10개를 만든다.
-- 상태값은 PostgreSQL enum 대신 text + CHECK로 둔다. 값을 추가할 때 CHECK만 바꾸면 돼서 고치기 쉽다.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── 사용자 ──
CREATE TABLE users (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email                  text NOT NULL UNIQUE,
    password_hash          text NOT NULL,
    nickname               text NOT NULL,
    real_name              text,
    role                   text NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'officer')),
    agency                 text,  -- 구청 담당자의 소속 관리청
    education_completed_at timestamptz,  -- null이면 교육 미이수
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_officer_has_agency CHECK (role <> 'officer' OR agency IS NOT NULL)
);

-- ── 나무 ──
CREATE TABLE trees (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_key        text NOT NULL UNIQUE,  -- 관리청|경도|위도 (원본에 관리번호가 없음)
    species           text NOT NULL,
    location          geography(Point, 4326) NOT NULL,
    agency            text NOT NULL,  -- 관리청: 신고 배정 기준
    district          text NOT NULL,  -- 위치한 자치구: 드릴다운 기준
    dong              text,           -- 위치한 법정동 (주소가 없으면 null)
    road_name         text,
    address           text,
    -- 아래 두 컬럼은 상태 계산 엔진(#19)만 쓴다
    water_need        text NOT NULL DEFAULT 'normal' CHECK (water_need IN ('enough', 'normal', 'thirsty')),
    health_status     text NOT NULL DEFAULT 'good' CHECK (health_status IN ('good', 'check', 'urgent')),
    status_updated_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trees_location_idx ON trees USING gist (location);  -- 지도 범위 조회, 거리 계산
CREATE INDEX trees_agency_idx ON trees (agency);
CREATE INDEX trees_district_dong_idx ON trees (district, dong);
CREATE INDEX trees_water_need_idx ON trees (water_need) WHERE water_need = 'thirsty';  -- 물 부족 목록(#23)

-- ── 입양 ──
CREATE TABLE adoptions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tree_id         bigint NOT NULL REFERENCES trees (id),
    user_id         bigint NOT NULL REFERENCES users (id),
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    start_date      date NOT NULL,
    end_date        date NOT NULL,
    paid_amount     integer NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),  -- 모의 결제 금액
    discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),  -- 관찰 공백 할인(#26)
    plaque_status   text NOT NULL DEFAULT 'none' CHECK (plaque_status IN ('none', 'requested', 'issued')),
    sbt_status      text NOT NULL DEFAULT 'none' CHECK (sbt_status IN ('none', 'issued')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT adoptions_period CHECK (end_date > start_date)
);

-- 나무당 입양자는 한 명이다(진행 중인 입양 기준)
CREATE UNIQUE INDEX adoptions_one_active_per_tree ON adoptions (tree_id) WHERE status = 'active';
CREATE INDEX adoptions_user_idx ON adoptions (user_id);

-- ── 이야기 ──
CREATE TABLE stories (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    adoption_id    bigint NOT NULL UNIQUE REFERENCES adoptions (id),
    tree_name      text NOT NULL,
    body           text NOT NULL,
    photo_url      text,
    is_public      boolean NOT NULL DEFAULT false,
    author_display text NOT NULL DEFAULT 'nickname' CHECK (author_display IN ('real_name', 'nickname')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE story_entries (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_id   bigint NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    body       text NOT NULL,
    photo_url  text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX story_entries_story_idx ON story_entries (story_id);

-- ── 기록 3종 ──
CREATE TABLE records (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tree_id         bigint NOT NULL REFERENCES trees (id),
    user_id         bigint NOT NULL REFERENCES users (id),
    type            text NOT NULL CHECK (type IN ('water', 'observe', 'report')),
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    water_amount_ml integer CHECK (water_amount_ml > 0),
    checklist       jsonb,  -- 예: {"leaf": false, "trunk_branch": true, "dry_soil": false, "trash": false}
    photo_url       text,
    location        geography(Point, 4326),  -- 기록한 위치 (위치 권한이 없으면 null)
    verification    text NOT NULL DEFAULT 'none' CHECK (verification IN ('none', 'location', 'photo')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- 물주기에만 양이 있고, 관찰에만 체크리스트가 있다
    CONSTRAINT records_water_amount CHECK ((type = 'water') = (water_amount_ml IS NOT NULL)),
    CONSTRAINT records_checklist CHECK ((type = 'observe') = (checklist IS NOT NULL)),
    CONSTRAINT records_id_type_key UNIQUE (id, type)  -- reports가 신고 기록에만 붙도록 FK 대상으로 쓴다
);

CREATE INDEX records_tree_type_time_idx ON records (tree_id, type, recorded_at DESC);  -- 상태 계산, 관찰 공백, 나이테
CREATE INDEX records_user_idx ON records (user_id);

-- ── 이상 신고 ──
CREATE TABLE reports (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_id    bigint NOT NULL UNIQUE,
    record_type  text NOT NULL DEFAULT 'report' CHECK (record_type = 'report'),  -- 값은 항상 'report'
    category     text NOT NULL CHECK (category IN ('leaning', 'broken_branch', 'pest', 'withering', 'other')),
    urgency      text NOT NULL CHECK (urgency IN ('low', 'high')),  -- 신고 유형으로 정한다(ERD.md 기본값)
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'inspecting', 'resolved')),
    agency       text NOT NULL,  -- 배정 관리청 (나무의 agency)
    is_trusted   boolean NOT NULL DEFAULT false,  -- 신고 시점의 교육 이수 여부
    handled_by   bigint REFERENCES users (id),
    action_note  text,
    inspected_at timestamptz,
    resolved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- 상태는 pending → inspecting → resolved 순서로만 바뀐다
    CONSTRAINT reports_inspected_at CHECK (status = 'pending' OR inspected_at IS NOT NULL),
    CONSTRAINT reports_resolved_at CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
    -- 물주기·관찰 기록에는 신고를 붙일 수 없다
    CONSTRAINT reports_record_fk FOREIGN KEY (record_id, record_type) REFERENCES records (id, type)
);

-- 신고 처리 큐(#20): 관리청별 미처리 신고를 신뢰도·긴급도·접수 순으로
CREATE INDEX reports_queue_idx ON reports (agency, is_trusted DESC, urgency, created_at)
    WHERE status <> 'resolved';

-- ── 기상 ──
CREATE TABLE weather (
    date             date NOT NULL,
    region           text NOT NULL,  -- 'seoul' (서울 ASOS 지점 108)
    precipitation_mm numeric(6, 1) NOT NULL DEFAULT 0,
    temp_avg         numeric(4, 1),
    temp_max         numeric(4, 1),
    is_heatwave      boolean NOT NULL DEFAULT false,
    PRIMARY KEY (date, region)
);

-- ── 기금 ──
CREATE TABLE fund_transactions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN ('deposit', 'expense')),
    category        text NOT NULL CHECK (category IN ('plaque', 'tree', 'common')),
    amount          integer NOT NULL CHECK (amount > 0),
    adoption_id     bigint REFERENCES adoptions (id),  -- 적립일 때
    target_tree_id  bigint REFERENCES trees (id),      -- 나무 집행일 때
    target_district text,                              -- 공동 기금 집행 지역
    description     text,
    created_by      bigint REFERENCES users (id),      -- 집행 등록한 구청 담당자
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fund_deposit_has_adoption CHECK (kind <> 'deposit' OR adoption_id IS NOT NULL),
    CONSTRAINT fund_tree_expense_has_tree CHECK (kind <> 'expense' OR category <> 'tree' OR target_tree_id IS NOT NULL),
    CONSTRAINT fund_common_expense_has_district CHECK (kind <> 'expense' OR category <> 'common' OR target_district IS NOT NULL)
);

CREATE INDEX fund_transactions_adoption_idx ON fund_transactions (adoption_id);
CREATE INDEX fund_transactions_tree_idx ON fund_transactions (target_tree_id);

-- ── 알림 ──
CREATE TABLE notifications (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             bigint NOT NULL REFERENCES users (id),
    type                text NOT NULL CHECK (type IN ('report_resolved', 'fund_used')),
    tree_id             bigint REFERENCES trees (id),
    report_id           bigint REFERENCES reports (id),
    fund_transaction_id bigint REFERENCES fund_transactions (id),
    title               text NOT NULL,
    body                text NOT NULL,
    read_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_report CHECK (type <> 'report_resolved' OR report_id IS NOT NULL),
    CONSTRAINT notifications_fund CHECK (type <> 'fund_used' OR fund_transaction_id IS NOT NULL)
);

CREATE INDEX notifications_user_time_idx ON notifications (user_id, created_at DESC);


-- migrate:down
DROP TABLE notifications;
DROP TABLE fund_transactions;
DROP TABLE weather;
DROP TABLE reports;
DROP TABLE records;
DROP TABLE story_entries;
DROP TABLE stories;
DROP TABLE adoptions;
DROP TABLE trees;
DROP TABLE users;

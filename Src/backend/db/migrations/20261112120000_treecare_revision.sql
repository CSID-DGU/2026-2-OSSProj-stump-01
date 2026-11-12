-- migrate:up
-- #67 ERD 개정: 유료 입양(TreeMate) → 나무돌보미 연계(TreeCare). 기준은 중간보고서 붙임 2 "전체 ERD 개정안".
-- 이미 합쳐진 init 마이그레이션은 고치지 않고 이 파일에서 바꾼다.
-- trees·weather에는 적재한 공공데이터가 있으므로 지우지 않고 ALTER로 고친다.
-- 입양·기금 관련 테이블과 기록(records)은 아직 앱이 없어 비어 있다는 전제로 바꾼다.

-- ── 범위에서 뺀 것: 관리기금, 물 필요도, 입양 ──
-- notifications가 fund_transactions를 참조하므로 그 컬럼부터 지운다
ALTER TABLE notifications DROP CONSTRAINT notifications_fund;
ALTER TABLE notifications DROP COLUMN fund_transaction_id;
DROP TABLE fund_transactions;

ALTER TABLE trees DROP COLUMN water_need;  -- trees_water_need_idx도 함께 지워진다

-- stories가 adoptions를 참조하므로 stories를 나무 기준으로 먼저 바꾼다
ALTER TABLE stories DROP COLUMN adoption_id;
ALTER TABLE stories ADD COLUMN tree_id bigint NOT NULL UNIQUE REFERENCES trees (id);  -- 나무별 공동 이야기: 나무당 하나
ALTER TABLE stories DROP COLUMN author_display;  -- 여러 돌보미가 함께 쓰므로 실명/별명 선택은 글(story_entries)마다 한다

DROP TABLE adoptions;

-- ── 돌보미 신청서 (adoptions 대체) ──
-- 한 명이 여러 그루, 한 그루에 여러 명(다대다)이라 나무당 1명 제약은 두지 않는다.
CREATE TABLE caregiver_applications (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users (id),
    tree_id       bigint NOT NULL REFERENCES trees (id),
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ended')),
    period_start  date NOT NULL,
    period_end    date NOT NULL,
    motivation    text,           -- 참여 동기. 항목은 구청 양식 확인 후 맞춘다(#59)
    reject_reason text,
    reviewed_by   bigint REFERENCES users (id),  -- 심사한 구청 담당자
    reviewed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT caregiver_applications_period CHECK (period_end >= period_start),
    CONSTRAINT caregiver_applications_reject_reason CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
    -- 승인·반려는 구청 담당자가 한다
    CONSTRAINT caregiver_applications_reviewed CHECK (
        status NOT IN ('approved', 'rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

-- 같은 사람이 같은 나무에 대기·승인 중인 신청을 두 개 가질 수 없다(반려·종료 뒤 재신청은 가능)
CREATE UNIQUE INDEX caregiver_applications_one_open ON caregiver_applications (user_id, tree_id)
    WHERE status IN ('pending', 'approved');
CREATE INDEX caregiver_applications_tree_status_idx ON caregiver_applications (tree_id, status);  -- 심사 대기, 사각지대
CREATE INDEX caregiver_applications_user_idx ON caregiver_applications (user_id);

-- ── 월간 보고서 ──
CREATE TABLE monthly_reports (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users (id),
    agency        text NOT NULL,  -- 제출할 관리청: 구청 검토 대기 목록의 기준 (묶인 기록의 나무 agency)
    status        text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'revision_requested')),
    total_minutes integer NOT NULL CHECK (total_minutes >= 0),  -- 고른 기록의 활동 시간 합계
    review_note   text,           -- 보완 요청 사유 등 구청 의견
    reviewed_by   bigint REFERENCES users (id),
    reviewed_at   timestamptz,
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT monthly_reports_reviewed CHECK (
        status = 'submitted' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT monthly_reports_revision_note CHECK (status <> 'revision_requested' OR review_note IS NOT NULL),
    CONSTRAINT monthly_reports_id_user_key UNIQUE (id, user_id)  -- records·volunteer_hours가 본인 보고서에만 붙도록 FK 대상으로 쓴다
);

CREATE INDEX monthly_reports_queue_idx ON monthly_reports (agency, submitted_at) WHERE status = 'submitted';  -- 검토 대기
CREATE INDEX monthly_reports_user_idx ON monthly_reports (user_id);

-- ── 기록: 날짜별 활동 기록 + 이상 신고 ──
ALTER TABLE records DROP CONSTRAINT records_water_amount;
ALTER TABLE records DROP CONSTRAINT records_checklist;
ALTER TABLE records DROP COLUMN water_amount_ml;
ALTER TABLE records DROP COLUMN checklist;
ALTER TABLE records DROP CONSTRAINT records_type_check;
ALTER TABLE records ADD CONSTRAINT records_type_check CHECK (type IN ('activity', 'report'));

ALTER TABLE records
    ADD COLUMN activity_date     date,     -- 활동한 날 (앱이 자동으로 채운다)
    ADD COLUMN activity_kind     text,     -- 활동 선택 항목. 값은 보고서 양식 설정에서 관리한다(#59)
    ADD COLUMN duration_min      integer CHECK (duration_min > 0),
    ADD COLUMN memo              text,
    ADD COLUMN monthly_report_id bigint,   -- 보고서로 제출되면 채운다. null이면 아직 보고서에 묶이지 않은 기록
    -- 활동 기록에는 날짜와 시간이 꼭 있다
    ADD CONSTRAINT records_activity_fields CHECK (
        type <> 'activity' OR (activity_date IS NOT NULL AND duration_min IS NOT NULL)
    ),
    -- 이상 신고는 보고서에 묶이지 않는다
    ADD CONSTRAINT records_report_not_in_monthly CHECK (type = 'activity' OR monthly_report_id IS NULL),
    -- 기록은 작성자 본인의 보고서에만 묶인다
    ADD CONSTRAINT records_monthly_report_fk FOREIGN KEY (monthly_report_id, user_id)
        REFERENCES monthly_reports (id, user_id);

DROP INDEX records_tree_type_time_idx;
CREATE INDEX records_tree_type_time_idx ON records (tree_id, type, recorded_at DESC);  -- 나무 상세, 나이테
-- 보고서 작성: 아직 묶이지 않은 기록이 있는 날짜를 찾는다
CREATE INDEX records_unreported_idx ON records (user_id, activity_date)
    WHERE type = 'activity' AND monthly_report_id IS NULL;
CREATE INDEX records_monthly_report_idx ON records (monthly_report_id);

-- ── 봉사시간: 구청이 승인한 보고서 한 편에 한 번만 ──
CREATE TABLE volunteer_hours (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           bigint NOT NULL REFERENCES users (id),
    monthly_report_id bigint NOT NULL UNIQUE,  -- 같은 보고서가 두 번 인정되는 것을 DB에서 막는다
    minutes           integer NOT NULL CHECK (minutes > 0),
    recorded_by       bigint NOT NULL REFERENCES users (id),  -- 승인한 구청 담당자
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT volunteer_hours_report_fk FOREIGN KEY (monthly_report_id, user_id)
        REFERENCES monthly_reports (id, user_id)
);

CREATE INDEX volunteer_hours_user_idx ON volunteer_hours (user_id, recorded_at);  -- 내 봉사시간, 공식 순위

-- ── 물품 지급 (회수 없음) ──
CREATE TABLE rental_items (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agency     text NOT NULL,  -- 물품을 가진 관리청
    name       text NOT NULL,  -- 예: 쿨토시, 집게
    stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rental_items_agency_name_key UNIQUE (agency, name)
);

CREATE TABLE rentals (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id     bigint NOT NULL REFERENCES rental_items (id),
    user_id     bigint NOT NULL REFERENCES users (id),
    quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    -- requested → approved → received, 또는 requested → rejected. 반납 상태는 없다
    status      text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'received')),
    handled_by  bigint REFERENCES users (id),  -- 승인·반려한 구청 담당자
    handled_at  timestamptz,
    received_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rentals_handled CHECK (status = 'requested' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL)),
    CONSTRAINT rentals_received_at CHECK ((status = 'received') = (received_at IS NOT NULL))
);

CREATE INDEX rentals_item_status_idx ON rentals (item_id, status);  -- 승인 대기
CREATE INDEX rentals_user_idx ON rentals (user_id);

-- ── 배지 (Should) ──
CREATE TABLE user_badges (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users (id),
    badge_code text NOT NULL,  -- 예: neighborhood_caregiver_5. 배지 목록은 설정 파일에서 관리한다
    earned_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_badges_user_badge_key UNIQUE (user_id, badge_code)  -- 같은 배지는 한 번만
);

-- ── 단체 (Should) ──
CREATE TABLE organizations (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL,
    invite_code text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 단체 관리자는 역할(users.role)이 아니라 멤버십이다
CREATE TABLE organization_members (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations (id),
    user_id         bigint NOT NULL REFERENCES users (id),
    role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_members_org_user_key UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- ── 공동 이야기의 글: 글쓴 돌보미 ──
-- 기존 글이 없다는 전제로 NOT NULL을 바로 건다
ALTER TABLE story_entries
    ADD COLUMN user_id        bigint NOT NULL REFERENCES users (id),
    ADD COLUMN author_display text NOT NULL DEFAULT 'nickname' CHECK (author_display IN ('real_name', 'nickname'));

-- ── 받은 호응 (Should, 로그인 없음) ──
CREATE TABLE story_reactions (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_entry_id bigint NOT NULL REFERENCES story_entries (id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN ('like', 'reply')),
    body           text,           -- 한 줄 응답
    device_key     text NOT NULL,  -- 로그인 없이 기기를 구분하는 값
    reacted_on     date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,  -- 하루 한 번 제약용 (한국 날짜)
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- 한 줄 응답 최대 80자 (앱의 상수와 같게 유지)
    CONSTRAINT story_reactions_body CHECK (
        (kind = 'reply' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 80)
        OR (kind = 'like' AND body IS NULL)
    ),
    -- 같은 기기는 글 하나에 하루 한 번
    CONSTRAINT story_reactions_once_a_day UNIQUE (story_entry_id, device_key, reacted_on)
);

-- ── 알림: 기금 알림 제거(위에서 컬럼 삭제), 신청·보고서·물품 결과와 받은 호응 추가 ──
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'application_result',     -- 돌보미 신청 승인·반려
    'monthly_report_result',  -- 월간 보고서 승인·보완 요청
    'rental_result',          -- 물품 승인·반려
    'report_resolved',        -- 이상 신고 조치 완료
    'story_reaction'          -- 받은 호응
));


-- migrate:down
-- 개정 전(init) 구조로 되돌린다. 새 테이블의 데이터는 사라진다.

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('report_resolved', 'fund_used'));

DROP TABLE story_reactions;
ALTER TABLE story_entries DROP COLUMN author_display;
ALTER TABLE story_entries DROP COLUMN user_id;
DROP TABLE organization_members;
DROP TABLE organizations;
DROP TABLE user_badges;
DROP TABLE rentals;
DROP TABLE rental_items;
DROP TABLE volunteer_hours;

DROP INDEX records_monthly_report_idx;
DROP INDEX records_unreported_idx;
ALTER TABLE records DROP CONSTRAINT records_monthly_report_fk;
ALTER TABLE records DROP CONSTRAINT records_report_not_in_monthly;
ALTER TABLE records DROP CONSTRAINT records_activity_fields;
ALTER TABLE records
    DROP COLUMN monthly_report_id,
    DROP COLUMN memo,
    DROP COLUMN duration_min,
    DROP COLUMN activity_kind,
    DROP COLUMN activity_date;
ALTER TABLE records DROP CONSTRAINT records_type_check;
ALTER TABLE records ADD CONSTRAINT records_type_check CHECK (type IN ('water', 'observe', 'report'));
ALTER TABLE records
    ADD COLUMN water_amount_ml integer CHECK (water_amount_ml > 0),
    ADD COLUMN checklist jsonb,
    ADD CONSTRAINT records_water_amount CHECK ((type = 'water') = (water_amount_ml IS NOT NULL)),
    ADD CONSTRAINT records_checklist CHECK ((type = 'observe') = (checklist IS NOT NULL));

DROP TABLE monthly_reports;
DROP TABLE caregiver_applications;

CREATE TABLE adoptions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tree_id         bigint NOT NULL REFERENCES trees (id),
    user_id         bigint NOT NULL REFERENCES users (id),
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    start_date      date NOT NULL,
    end_date        date NOT NULL,
    paid_amount     integer NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    plaque_status   text NOT NULL DEFAULT 'none' CHECK (plaque_status IN ('none', 'requested', 'issued')),
    sbt_status      text NOT NULL DEFAULT 'none' CHECK (sbt_status IN ('none', 'issued')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT adoptions_period CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX adoptions_one_active_per_tree ON adoptions (tree_id) WHERE status = 'active';
CREATE INDEX adoptions_user_idx ON adoptions (user_id);

ALTER TABLE stories ADD COLUMN author_display text NOT NULL DEFAULT 'nickname' CHECK (author_display IN ('real_name', 'nickname'));
ALTER TABLE stories DROP COLUMN tree_id;
ALTER TABLE stories ADD COLUMN adoption_id bigint NOT NULL UNIQUE REFERENCES adoptions (id);

ALTER TABLE trees ADD COLUMN water_need text NOT NULL DEFAULT 'normal' CHECK (water_need IN ('enough', 'normal', 'thirsty'));
CREATE INDEX trees_water_need_idx ON trees (water_need) WHERE water_need = 'thirsty';

CREATE TABLE fund_transactions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN ('deposit', 'expense')),
    category        text NOT NULL CHECK (category IN ('plaque', 'tree', 'common')),
    amount          integer NOT NULL CHECK (amount > 0),
    adoption_id     bigint REFERENCES adoptions (id),
    target_tree_id  bigint REFERENCES trees (id),
    target_district text,
    description     text,
    created_by      bigint REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fund_deposit_has_adoption CHECK (kind <> 'deposit' OR adoption_id IS NOT NULL),
    CONSTRAINT fund_tree_expense_has_tree CHECK (kind <> 'expense' OR category <> 'tree' OR target_tree_id IS NOT NULL),
    CONSTRAINT fund_common_expense_has_district CHECK (kind <> 'expense' OR category <> 'common' OR target_district IS NOT NULL)
);
CREATE INDEX fund_transactions_adoption_idx ON fund_transactions (adoption_id);
CREATE INDEX fund_transactions_tree_idx ON fund_transactions (target_tree_id);

ALTER TABLE notifications
    ADD COLUMN fund_transaction_id bigint REFERENCES fund_transactions (id),
    ADD CONSTRAINT notifications_fund CHECK (type <> 'fund_used' OR fund_transaction_id IS NOT NULL);

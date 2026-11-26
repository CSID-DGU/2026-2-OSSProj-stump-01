-- migrate:up
-- #143 단체 관심 구간. 단체가 도로·거리 구간을 골라 두면, 그 구간의 모든 돌보미 활동을 익명 합계로 묶어 본다.
-- 구간은 나무가 있는 길(노선명 → 동 → 자치구 중 있는 것)이고, 같은 이름의 길도 자치구가 다르면 다른 구간이다.
-- (나무 이름 번호 trees.place_no 와 같은 "길" 기준, 단체 리포트 organization-summary 와 같은 "자치구 + 길" 구분)

CREATE TABLE organization_sections (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    district        text NOT NULL,
    place           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_sections_unique UNIQUE (organization_id, district, place)
);
COMMENT ON TABLE organization_sections IS '단체 관심 구간. 단체 관리자가 추가·삭제하고, 그 구간의 돌보미 활동을 익명 합계로 본다(#143)';

-- 구간의 나무를 찾는 조회(자치구 + 길)를 빠르게
CREATE INDEX trees_section_idx ON trees (district, (COALESCE(road_name, dong, district)));

-- migrate:down
DROP INDEX IF EXISTS trees_section_idx;
DROP TABLE IF EXISTS organization_sections;

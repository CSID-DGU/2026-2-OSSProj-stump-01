-- migrate:up
-- #6 돌보미 신청서에 구청 양식(「나무돌보미(Adopt a Tree) 신청서(안)」) 항목을 넣는다.
-- 양식의 '입양대상지'는 이 서비스가 가로수만 다루므로 칸을 두지 않는다(tree_id가 대상).
-- 활동 기간은 양식대로 1년 기본이라 period_end는 서버가 시작일 + 1년 전날로 정한다(칸은 그대로).
-- 이 마이그레이션 전에 만든 신청서가 있어 새 칸은 NULL을 허용하고, 필수 여부는 API(zod)가 검사한다.
ALTER TABLE caregiver_applications
    ADD COLUMN applicant_name     text,     -- 신청인 성명 또는 단체명
    ADD COLUMN contact_person     text,     -- 기업·단체일 때 담당부서와 담당자
    ADD COLUMN headcount          integer CHECK (headcount > 0),  -- 신청 인원
    ADD COLUMN postal_code        char(5),  -- 우편번호
    ADD COLUMN address            text,
    ADD COLUMN phone              text,     -- 연락처
    ADD COLUMN participation_type text CHECK (participation_type IN
        ('individual', 'company', 'civic_group', 'religious_group', 'village_community', 'other')),  -- 참여유형
    ADD COLUMN activity_plan      text,     -- 활동계획 (양식 별첨 2를 글로 받는다)
    ADD COLUMN organization_intro text,     -- 기업·단체 소개 (양식 별첨 1, 선택)
    ADD COLUMN agreed_at          timestamptz;  -- 참여 안내 사항에 동의한 시각 (양식의 동의·서명)

-- migrate:down
ALTER TABLE caregiver_applications
    DROP COLUMN applicant_name,
    DROP COLUMN contact_person,
    DROP COLUMN headcount,
    DROP COLUMN postal_code,
    DROP COLUMN address,
    DROP COLUMN phone,
    DROP COLUMN participation_type,
    DROP COLUMN activity_plan,
    DROP COLUMN organization_intro,
    DROP COLUMN agreed_at;

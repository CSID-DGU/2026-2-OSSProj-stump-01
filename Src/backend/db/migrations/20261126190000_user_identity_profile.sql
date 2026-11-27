-- migrate:up
-- 가입 본인인증과 프로필. 봉사시간이 실제 사람에게 연결되도록 가입 때 본인인증을 하고,
-- 인증된 이름·생년월일·휴대폰은 본인인증을 다시 해야만 바뀐다. 주민등록번호는 받지 않는다.
-- 구청 담당자 계정과 이 마이그레이션 전에 만든 계정은 칸이 비어 있다(본인인증 전).
ALTER TABLE users
    ADD COLUMN birth_date            date,         -- 본인인증 결과
    ADD COLUMN phone                 text,         -- 본인인증한 휴대폰 번호 (010-0000-0000)
    ADD COLUMN postal_code           char(5),      -- 주소는 본인인증과 상관없이 본인이 고친다
    ADD COLUMN address               text,
    ADD COLUMN identity_ci_hash      text,         -- 본인인증 연계정보(CI)의 SHA-256. 한 사람 한 계정
    ADD COLUMN identity_verified_at  timestamptz;  -- 마지막 본인인증 시각

CREATE UNIQUE INDEX users_identity_ci_hash_key ON users (identity_ci_hash) WHERE identity_ci_hash IS NOT NULL;

-- migrate:down
DROP INDEX users_identity_ci_hash_key;
ALTER TABLE users
    DROP COLUMN birth_date,
    DROP COLUMN phone,
    DROP COLUMN postal_code,
    DROP COLUMN address,
    DROP COLUMN identity_ci_hash,
    DROP COLUMN identity_verified_at;

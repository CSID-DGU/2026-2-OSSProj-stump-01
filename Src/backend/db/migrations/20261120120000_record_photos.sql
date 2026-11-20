-- migrate:up
-- #5 활동 기록·이상 신고 사진. 시민 웹은 기록 하나에 사진을 3장까지 올린다.
-- 파일은 백엔드 uploads 폴더에 두고 여기에는 주소(/uploads/파일이름)만 남긴다.
-- records.photo_url 에는 첫 사진을 계속 넣는다(구청 신고 큐·보고서 검토가 그 칸을 읽는다).
CREATE TABLE record_photos (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_id  bigint NOT NULL REFERENCES records (id) ON DELETE CASCADE,
    url        text NOT NULL,
    position   smallint NOT NULL CHECK (position BETWEEN 1 AND 3),  -- 올린 순서
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (record_id, position)
);

-- migrate:down
DROP TABLE record_photos;

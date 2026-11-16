-- migrate:up
-- #4 나무 관리번호(trees.code). 서울 열린데이터광장 가로수 데이터에는 서울시 트리맵의 관리번호가 없어서
-- 우리가 번호를 새로 매긴다. 형식: "자치구코드(행정표준 시군구 코드 5자리)-구 안 순번 5자리", 예 11140-00123 (중구 123번째).
-- 시연 때는 "서울시가 부여한 관리번호로 바꿔 끼우면 된다"고 설명한다. 화면·QR 명판에는 id 대신 이 번호를 보여 준다.

ALTER TABLE trees ADD COLUMN code text UNIQUE;
COMMENT ON COLUMN trees.code IS '관리번호. 자치구코드-순번. assign_tree_codes()가 채운다';

-- 자치구 이름 → 행정표준 시군구 코드 (서울 25개 구)
CREATE TABLE district_codes (
    district text PRIMARY KEY,
    code     char(5) NOT NULL UNIQUE
);
INSERT INTO district_codes (district, code) VALUES
    ('종로구','11110'), ('중구','11140'), ('용산구','11170'), ('성동구','11200'), ('광진구','11215'),
    ('동대문구','11230'), ('중랑구','11260'), ('성북구','11290'), ('강북구','11305'), ('도봉구','11320'),
    ('노원구','11350'), ('은평구','11380'), ('서대문구','11410'), ('마포구','11440'), ('양천구','11470'),
    ('강서구','11500'), ('구로구','11530'), ('금천구','11545'), ('영등포구','11560'), ('동작구','11590'),
    ('관악구','11620'), ('서초구','11650'), ('강남구','11680'), ('송파구','11710'), ('강동구','11740');

-- code가 비어 있는 나무에 번호를 매긴다. 구마다 이미 쓴 가장 큰 순번 다음부터 이어 붙이므로
-- 기존 번호는 바뀌지 않는다. 적재 스크립트가 새 나무를 넣은 뒤 이 함수를 한 번 부른다.
-- 순서: 노선명 → 경도 → 위도 (같은 길의 나무가 이어지게). 반환값은 새로 매긴 개수.
CREATE OR REPLACE FUNCTION assign_tree_codes() RETURNS integer AS $$
DECLARE
    assigned integer;
BEGIN
    WITH last_seq AS (
        SELECT district, COALESCE(MAX(split_part(code, '-', 2)::integer), 0) AS seq
        FROM trees WHERE code IS NOT NULL GROUP BY district
    ),
    numbered AS (
        SELECT t.id,
               dc.code || '-' || lpad((COALESCE(ls.seq, 0) + row_number() OVER (
                   PARTITION BY t.district
                   ORDER BY t.road_name NULLS LAST, ST_X(t.location::geometry), ST_Y(t.location::geometry), t.id
               ))::text, 5, '0') AS new_code
        FROM trees t
        JOIN district_codes dc ON dc.district = t.district
        LEFT JOIN last_seq ls ON ls.district = t.district
        WHERE t.code IS NULL
    )
    UPDATE trees SET code = numbered.new_code FROM numbered WHERE trees.id = numbered.id;
    GET DIAGNOSTICS assigned = ROW_COUNT;
    RETURN assigned;
END;
$$ LANGUAGE plpgsql;

-- 이미 적재된 나무에 번호를 매긴다 (28만 그루 기준 약 1분)
SELECT assign_tree_codes();

-- migrate:down
DROP FUNCTION IF EXISTS assign_tree_codes();
DROP TABLE IF EXISTS district_codes;
ALTER TABLE trees DROP COLUMN IF EXISTS code;

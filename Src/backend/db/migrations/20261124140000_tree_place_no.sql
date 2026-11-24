-- migrate:up
-- 나무 이름 번호(trees.place_no). 같은 길에 같은 수종이 수십~수백 그루라 "은행나무, 소파로"만으로는
-- 내가 신청한 나무를 구분할 수 없다. 이름을 "은행나무, 소파로 3번"처럼 부르도록 길마다 번호를 매긴다.
-- - 길: 노선명, 없으면 동, 없으면 자치구 (화면에 보이는 이름과 같은 기준)
-- - 같은 이름의 길이 여러 구에 걸쳐도 서울 전체에서 번호를 이어 매긴다 → 서울 전체에서 이름이 겹치지 않는다
-- - 순서: 관리번호 순(구 코드 → 구 안 순번, 구 안에서는 노선명 → 서쪽부터)

ALTER TABLE trees ADD COLUMN place_no integer;
COMMENT ON COLUMN trees.place_no IS '나무 이름 번호. 같은 길(노선명·동·자치구 중 있는 것) 안의 순번. assign_tree_codes()가 채운다';

-- 같은 길에서 번호가 겹치지 않게 한다 (번호가 없는 나무는 여러 그루여도 된다)
CREATE UNIQUE INDEX trees_place_no_key ON trees ((COALESCE(road_name, dong, district)), place_no);

-- 원본 갱신으로 길이 바뀐 나무는 번호를 비운다. 그대로 두면 새 길의 번호와 겹칠 수 있다.
-- 비운 번호는 적재 스크립트가 부르는 assign_tree_codes()가 새 길의 다음 번호로 다시 채운다.
CREATE OR REPLACE FUNCTION reset_tree_place_no() RETURNS trigger AS $$
BEGIN
    IF COALESCE(NEW.road_name, NEW.dong, NEW.district) IS DISTINCT FROM COALESCE(OLD.road_name, OLD.dong, OLD.district) THEN
        NEW.place_no := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trees_reset_place_no
    BEFORE UPDATE OF road_name, dong, district ON trees
    FOR EACH ROW EXECUTE FUNCTION reset_tree_place_no();

-- 관리번호(code)를 매긴 뒤 이름 번호(place_no)도 매긴다. 적재 스크립트는 지금처럼 이 함수만 부르면 된다.
-- 둘 다 비어 있는 나무에만 매기고, 이미 쓴 가장 큰 번호 다음부터 이어 붙이므로 기존 번호는 바뀌지 않는다.
-- 반환값은 지금처럼 새로 매긴 관리번호 개수.
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

    WITH last_no AS (
        SELECT COALESCE(road_name, dong, district) AS place, MAX(place_no) AS no
        FROM trees WHERE place_no IS NOT NULL GROUP BY 1
    ),
    numbered AS (
        SELECT t.id,
               COALESCE(ln.no, 0) + row_number() OVER (
                   PARTITION BY COALESCE(t.road_name, t.dong, t.district)
                   ORDER BY t.code NULLS LAST, t.id
               ) AS new_no
        FROM trees t
        LEFT JOIN last_no ln ON ln.place = COALESCE(t.road_name, t.dong, t.district)
        WHERE t.place_no IS NULL
    )
    UPDATE trees SET place_no = numbered.new_no FROM numbered WHERE trees.id = numbered.id;

    RETURN assigned;
END;
$$ LANGUAGE plpgsql;

-- 이미 적재된 나무에 이름 번호를 매긴다
SELECT assign_tree_codes();

-- migrate:down
-- assign_tree_codes()를 관리번호만 매기던 모양(20261112190000)으로 되돌린다
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
DROP TRIGGER IF EXISTS trees_reset_place_no ON trees;
DROP FUNCTION IF EXISTS reset_tree_place_no();
DROP INDEX IF EXISTS trees_place_no_key;
ALTER TABLE trees DROP COLUMN IF EXISTS place_no;

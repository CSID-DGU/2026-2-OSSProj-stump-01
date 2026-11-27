-- migrate:up
-- #15 순위 끄기. 본인이 끄면 활동 순위·공식 순위·이달의 MVP 목록에 나오지 않는다(CLAUDE.md "순위는 본인이 끌 수 있다").
ALTER TABLE users ADD COLUMN ranking_hidden boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE users DROP COLUMN ranking_hidden;

-- migrate:up
-- #64 나무별 공동 이야기. 이야기(stories)는 나무마다 하나인 묶음이고, 내용은 돌보미들이 덧붙인 글(story_entries)에 있다.
-- 원안(TreeMate) 때 만든 stories.tree_name·body 는 필수가 아니게 바꾼다(묶음만 만들 때 비워 둔다).
-- 공개 여부는 글쓴 돌보미가 글마다 고른다(CLAUDE.md 절대 규칙). 비공개 글은 QR 이야기 페이지에 나오지 않는다.
-- stories.is_public 은 쓰지 않는다(글마다 고르는 story_entries.is_public 을 쓴다).
ALTER TABLE stories ALTER COLUMN tree_name DROP NOT NULL;
ALTER TABLE stories ALTER COLUMN body DROP NOT NULL;
ALTER TABLE story_entries ADD COLUMN is_public boolean NOT NULL DEFAULT true;

-- migrate:down
ALTER TABLE story_entries DROP COLUMN is_public;
UPDATE stories SET tree_name = '' WHERE tree_name IS NULL;
UPDATE stories SET body = '' WHERE body IS NULL;
ALTER TABLE stories ALTER COLUMN tree_name SET NOT NULL;
ALTER TABLE stories ALTER COLUMN body SET NOT NULL;

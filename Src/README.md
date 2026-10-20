# Src

## 로컬 DB 실행

PostgreSQL 17 + PostGIS를 Docker로 띄운다. Docker Desktop이 켜져 있어야 한다.

```bash
cd Src
cp .env.example .env        # 처음 한 번. 비밀번호는 아무 값이나 넣어도 된다
docker compose up -d        # 처음에는 이미지를 빌드해서 1~2분 걸린다
docker compose ps           # STATUS가 healthy면 준비 완료
```

- 접속: `localhost:5432`, 사용자·비밀번호·DB 이름은 `.env` 값
- psql로 들어가기: `docker exec -it treemate-db psql -U treemate -d treemate`
- 끄기: `docker compose down` (데이터는 남는다)
- 데이터까지 지우고 처음부터: `docker compose down -v`

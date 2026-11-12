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

## DB 마이그레이션 (dbmate)

테이블은 `backend/db/migrations/`의 SQL 파일로 만든다. DB가 떠 있는 상태에서 실행한다.

```bash
docker compose run --rm dbmate up        # 아직 적용 안 된 마이그레이션 적용
docker compose run --rm dbmate status    # 적용 상태 확인
docker compose run --rm dbmate rollback  # 마지막 마이그레이션 되돌리기
docker compose run --rm dbmate new 이름   # 새 마이그레이션 파일 만들기 (예: add_badges)
```

- 적용할 때마다 `backend/db/schema.sql`이 현재 DB 구조로 갱신된다. 마이그레이션과 같이 커밋한다.
- 이미 `develop`에 합쳐진 마이그레이션 파일은 고치지 않는다. 바꿀 게 있으면 새 마이그레이션을 만든다.
- 비밀번호에 `@`, `:`, `/` 같은 문자가 있으면 접속 주소가 깨지니 `.env`에서 쓰지 않는다.

## API 서버 (backend)

Node.js 22 이상이 필요하다. DB가 떠 있고 마이그레이션이 적용된 상태에서 실행한다.

```bash
cd Src/backend
npm install                # 처음 한 번, package.json이 바뀌었을 때
npm run dev                # 개발 서버 (파일을 고치면 자동 재시작)
```

- 주소: http://localhost:4000 , API 명세(Swagger UI): http://localhost:4000/docs
- 상태 확인: `curl localhost:4000/health` → `{"status":"ok"}`
- `.env`에 `JWT_SECRET`과 `PORT`가 있어야 한다(`.env.example` 참고).

```bash
npm test                   # 테스트 (DB가 떠 있어야 함)
npm run typecheck          # 타입 검사
npm run build              # dist/로 빌드, 실행은 npm start
```

- 테스트는 개발 DB를 건드리지 않는다. 실행할 때마다 `treecare_test` DB를 새로 만들고 `backend/db/migrations`를 적용한 뒤 돈다.

폴더:

```
backend/
  app.ts, server.ts   앱 조립, 서버 실행
  openapi.yaml        API 명세. API를 바꾸면 같이 고친다
  common/             DB 연결·트랜잭션, 인증(JWT)·권한, 에러 응답, 환경변수
  district/           구청 모듈 (/admin 아래, 구청 담당자만)
  citizen/            시민 모듈
  test/               테스트 DB 준비, 테스트 데이터 함수
```

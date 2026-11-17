# 서울 TreeCare 시민 웹

돌보미와 지나가는 시민이 휴대폰으로 쓰는 모바일 웹(PWA)이다. React + TypeScript + Vite로 만든다.
아직 백엔드 API에 연결하지 않았다. 기록은 `src/store/recordStore.ts`가 브라우저(localStorage)에 임시로 저장한다.

## 실행

```bash
cd Src/frontend/citizen
npm install     # 처음 한 번
npm run dev     # 개발 서버. 터미널에 나온 주소(http://localhost:5173)를 연다
```

휴대폰 화면으로 보려면 브라우저 개발자 도구(F12)에서 기기 모드(Ctrl+Shift+M)를 켜고 iPhone 12 Pro(390×844)를 고른다.

- `npm run build`: 배포용 빌드 (타입 검사 포함)
- `npm run lint`: 코드 검사

## 폴더

```
src/
  styles/tokens.css      디자인 토큰(색·글꼴·간격). 디자인 가이드와 같은 값
  styles/components.css  공용 부품 스타일(tc- 클래스). 디자인 가이드와 같은 내용
  index.css              화면 틀(앱 껍데기, 여백, 데스크탑 배치)
  components/            여러 화면이 같이 쓰는 부품 (하단 탭, 상단 바, 화면 제목)
  pages/                 화면 하나당 파일 하나
  mocks/                 API가 나오기 전까지 쓰는 가짜 데이터
  App.tsx                주소와 화면 연결
```

## 규칙

- 색·글꼴·간격은 값을 직접 쓰지 않고 `var(--primary)`처럼 토큰 이름으로 쓴다.
- 디자인 가이드: https://claude.ai/artifact/Nt5jA2r1uasxkeum3EqynZ
- 데스크탑(1024px 이상)에서는 하단 탭이 위로 올라가고, `field-only` 클래스를 붙인 현장 기능(QR 안내, 사진 촬영, 홈 화면 추가)은 숨겨진다.
- 코드 주석은 한국어로 쓴다.

# HANDOFF

> 세션을 시작하면 이 파일부터 읽는다. 세션 종료 시 최상단을 갱신한다.

## 지금 상태 (2026-07-21, 회사 PC)

- `main` 브랜치, 로컬 = 원격(origin/main) 동기화 완료. 최신 커밋 `29b4e32`.
- 감정서에 수리오격(카드형, 설명·영역 포함) + 시진 표기 + 시주모름 생략 적용된 상태.
- 미추적 파일 다수 남아 있음 (아래 "다음 할 일" 참고).

## 방금 한 일 (2026-07-21 세션)

- **5/15 두 PC 중복 작업 사고 정리**: 회사 PC에 커밋 안 된 수리오격 옛 초안이 남아 있었음.
  원격(집 PC에서 만든 더 발전된 카드형 버전, 4커밋)을 기준으로 삼고 옛 초안은 폐기.
- 옛 초안에만 있던 변경 3가지를 살려서 재적용 후 커밋·푸시 (`29b4e32`):
  1. 출생시간 시진 표기 ("13:00" → "미시") — 감정서(server.js buildPage1Html) + 미리보기(index.html)
  2. 시주 모름이면 문구 표시 대신 생략 — index.html `_renderCertificate` / `_buildCertPayload`
  3. 감정서 하단 문구 "참고 자료입니다" → "자료입니다" — certificate.html
- 폐기한 초안 백업: 회사 PC 스크래치패드 `backup-20260721` (내용은 전부 원격에 흡수/재적용됨 — 사라져도 무방)

## 다음 할 일

1. **[미검증] 실행 검증**: 시진 표기·시주모름 생략이 감정서 미리보기 + JPG/PDF 다운로드에서 잘 나오는지 확인
2. **[확인 필요] 희귀도 마이그레이션**: `backend/scripts/fill-rarity.mjs` (1회성 DB 마이그레이션, 커밋 `a2a8804`)를
   집 PC에서 이미 실행했는지 불명. 안 했으면 한 번 실행해야 기존 저장 이름들의 희귀도가 채워짐. **중복 실행 여부 확인 전 함부로 돌리지 말 것.**
3. **미추적 파일 정리** (커밋할지 버릴지 결정):
   - `backend/build_names_db.py`, `backend/enrich_names_db.py`, `backend/data/*.csv` — 이름 DB 구축용
   - `backend/templates/certificate_prototype.html`, `jangmyeongjeung_prototype.html` — 프로토타입
   - `scripts/enrich-saved-names.mjs`, `git-sync-flow.mermaid`, `frontend/package-lock.json`
   - `backend/__pycache__/` — 커밋 금지 캐시. `.gitignore`에 추가 권장

## 함정·주의

- **작업 시작 전 반드시 `git pull`, 퇴근 전 반드시 커밋+푸시.** 5/15처럼 커밋 안 하고 PC를 옮기면 같은 기능을 두 번 만들게 됨.
- 이 레포는 회사 PC(DESKTOP-Q0G9V7O)와 집 PC를 오가며 작업함.
- 감정서 수리오격은 원격 버전(카드형, `five_grid` API 필드, desc·영역 포함)이 정본. 컴팩트 행 방식 옛 초안(`suri_gyeoks`)은 폐기됨.

## 미검증

- 2026-07-21 재적용분(시진 표기 등 3건): server.js는 `node --check` 통과, 화면 실행 검증은 안 함.

## 시작 명령

- `cd backend` 후 `npm start` (또는 개발용 `npm run dev` — 파일 변경 시 자동 재시작)
- 서버가 http://localhost:3000 에서 프런트(frontend/index.html)까지 함께 서빙함 (포트는 env `PORT`로 변경 가능)

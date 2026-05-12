# 픽베이비네임 — 사주·한자·감정서 기능 구현 플레이북

> **목적**: 이 파일은 비개발자가 Claude Code(CMD) 또는 다른 AI 어시스턴트와 함께 픽베이비네임의 프리미엄 기능 3종(사주 보기, 다른 한자 추천, 감정서)을 처음부터 끝까지 만들기 위한 가이드입니다.
> 
> **사용법**:
> 1. 단계 순서대로 진행
> 2. 각 단계의 **📋 프롬프트** 블록을 복사해서 AI에게 그대로 전달
> 3. **✅ 확인** 항목으로 완료 여부 점검
> 4. 문제 발생 시 **🆘 자주 나는 오류** 섹션 참고

---

## 🧭 사전 — 필수 컨텍스트 (모든 프롬프트의 시작에 자동 적용됨)

AI에게 처음 말할 때 다음 한 줄을 먼저 전달:

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽고, 그 안의 "프로젝트 컨텍스트" 섹션을 모든 결정의 기준으로 삼아라.
```

---

## 📚 프로젝트 컨텍스트 (변경되지 않는 합의사항)

### 서비스 정보
- **이름**: 픽베이비네임 (PickBabyName)
- **핵심**: 한국 아기 이름 추천 + 월드컵 + 사주 분석
- **타겟**: 출산 예정 한국 부모 (모바일)

### 기술 스택
- 프론트엔드: 단일 `frontend/index.html` (HTML + 바닐라 JS + CSS, Pretendard 폰트, 모바일 우선 max-width 480px)
- 백엔드: Node.js + Express (`backend/server.js`)
- LLM: OpenRouter API (OpenAI SDK 호환)
- DB: Supabase (families / profiles / naming_list)
- 배포: Vercel

### 디자인 토큰
```css
--primary: #6C63FF;      --primary-light: #EEF0FF;
--accent: #FF6584;       --gold: #F5A623;
--bg: #F8F9FE;           --card: #FFFFFF;
--text: #2D2D2D;         --sub: #6B7280;
--border: #E5E7EB;       --radius: 14px;
```

### 유료화 모델 (이번 구현 범위)
- **상품**: "30일 작명 패스" 단일 / ₩7,900 / 자동갱신 없음
- **무료 한도** (누적·평생):
  - 새 이름 탐색 5회 (6회째부터 페이월)
  - 사주 보기 1회 (2회째부터 페이월)
  - 다른 한자 추천 1회 (2회째부터 페이월)
  - 감정서 1회 미리보기 (PDF 다운로드는 항상 유료)
- **결제 모듈은 이번 단계에 포함하지 않음** (기능 먼저, 결제는 나중)

### UX 패턴 (확정)
**Pattern A — 사주 중심**: 월드컵/왕중왕전/보관함 결과 화면에는 **[🔮 사주 보기 시작]** 버튼 하나만 노출.
사주 결과 화면 안에 **[✨ 다른 한자 추천]**, **[📜 감정서로 받기]** 두 버튼이 들어감.

### 시각 시안
완성된 시안: `mockup-saju.html` (브라우저로 열어볼 것). 모든 UI 작업은 이 시안의 디자인을 기준으로 함.

### 코드 컨벤션
- ES Modules (`import / export`)
- async/await 사용 (콜백 지양)
- 모든 한국어 문자열은 UTF-8
- 환경변수는 루트의 `.env` 사용

---

# 📍 단계 1 — 인명용 한자 메타DB 빌드

🎯 **목표**: 604자 한자 각각의 `음·획수·자원오행·뜻`을 담은 `backend/data/hanja_db.json` 완성  
⏱ **예상 시간**: 30분 (AI 처리 시간 포함)  
🔒 **사전 조건**: `backend/data/unique_hanja.json` 존재 확인

### 📋 프롬프트 1-A (DB 직접 생성 — API 없이)

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라.

[작업]
backend/data/unique_hanja.json 파일을 읽으면, 빈도순으로 정렬된 604개의 한국 인명용 한자 배열이 있다. 이 한자들 각각의 메타데이터를 생성해서 backend/data/hanja_db.json 파일을 만들어라.

[출력 형식]
{
  "智": {
    "char": "智",
    "sound": "지",
    "radical": "日",
    "strokes": 12,
    "ohaeng_won": "火",
    "meaning": "지혜",
    "name_usage": "지혜롭고 명민한 인격을 상징한다"
  },
  ...
}

[규칙]
- sound: 한국어 두음법칙 적용된 음 (예: 麗 → "여" 또는 "려")
- radical: 부수 1글자
- strokes: 정자 기준 총 획수 (정수)
- ohaeng_won: 자원오행. 반드시 木/火/土/金/水 중 하나
- meaning: 5~10자
- name_usage: 이름에서의 의미와 뉘앙스, 1문장

[방법]
모든 604자를 한 번에 처리하기엔 응답 분량이 많으므로, 100자씩 6~7회에 걸쳐 hanja_db.json 파일에 점진적으로 누적해서 작성하라. 매 묶음마다 Write 또는 Edit 도구로 파일을 갱신하라. 진행률을 보고하라.

[한국 한자 작명 지식]
- 자원오행은 한자가 가진 본래의 오행 속성으로, 부수와 의미를 종합해서 결정
- 예시: 智(日, 火 속성), 潤(氵, 水 속성), 賢(貝, 金 속성), 宇(宀, 土 속성), 林(木, 木 속성)
- 모호한 경우 전통 작명서 기준을 따름

완료 후 hanja_db.json의 항목 수와 자원오행별 통계(木/火/土/金/水 각 몇 자)를 보고하라.
```

### ✅ 확인
- `backend/data/hanja_db.json` 파일 생성됨
- 항목 수 약 600자 (오차 ±10 허용)
- 임의 한자 1글자 열어서 형식 확인
  ```powershell
  node -e "const db=require('./backend/data/hanja_db.json'); console.log(JSON.stringify(db['智'],null,2))"
  ```

### 📋 프롬프트 1-B (대안 — OpenRouter API 사용)

위 방식이 잘 안 되거나 시간이 오래 걸리면 기존 스크립트 사용:

```
backend/scripts/02-build-hanja-db.js 스크립트가 이미 작성돼 있다. .env 파일에 OPENROUTER_API_KEY가 설정돼 있는지 확인한 뒤 다음을 실행하라:

1. cd backend
2. node scripts/02-build-hanja-db.js --limit 30   # 시험
3. 결과 확인 후 node scripts/02-build-hanja-db.js  # 전체
```

➡️ **다음**: 단계 2

---

# 📍 단계 2 — 사주 계산 코어 모듈

🎯 **목표**: 생년월일시 → 사주팔자 → 오행 분포 → 용신을 계산하는 백엔드 모듈  
⏱ **예상 시간**: AI 작업 약 20분 + 검수 10분  
🔒 **사전 조건**: 단계 1 완료, `backend/package.json` 존재

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라.

[작업]
backend/lib/saju.js 모듈을 새로 만들어라. 이 모듈은 생년월일시를 받아 사주팔자와 오행 분포를 계산하는 순수 함수들을 export 한다.

[필요 패키지]
1. cd backend
2. npm install korean-lunar-calendar
(이미 설치되어 있으면 그대로 사용)

[모듈 API]
export function calculateSaju({ year, month, day, hour, isLunar = false }) → {
  palja: {
    year:  { cheon: '丙', ji: '午' },
    month: { cheon: '甲', ji: '申' },
    day:   { cheon: '辛', ji: '酉' },
    hour:  { cheon: '丙', ji: '寅' } | null  // hour가 null이면 null
  },
  elements: { 木: 2, 火: 3, 土: 1, 金: 3, 水: 0 },
  yongsin: '水',           // 가장 부족한 오행
  yongsin_desc: '水(물) 기운이 부족하여 이름에 水 속성 한자가 들어가면 균형이 좋아집니다',
  hour_known: true | false
}

[계산 규칙]
1. 년주: 60갑자 순환. 1984년이 갑자년 시작점.
   - 천간 = (year - 4) % 10 → 0:甲 1:乙 2:丙 3:丁 4:戊 5:己 6:庚 7:辛 8:壬 9:癸
   - 지지 = (year - 4) % 12 → 0:子 1:丑 2:寅 3:卯 4:辰 5:巳 6:午 7:未 8:申 9:酉 10:戌 11:亥
   
2. 월주: 월별 지지 고정(寅월=2월 등). 천간은 년 천간에서 계산.
   - 월 지지: 1월=丑, 2월=寅, 3월=卯, ... (입춘 기준 단순화)
   - 월 천간: (年干 인덱스 × 2 + 月支 인덱스) % 10
   
3. 일주: 1900-01-01을 기준일(甲戌)로 두고 일수 차이로 갑자 순환 계산.
   const baseDate = new Date('1900-01-01');
   const diffDays = Math.floor((target - baseDate) / 86400000);
   천간 = (10 + diffDays) % 10
   지지 = (10 + diffDays) % 12
   
4. 시주: 일 천간에 따라 子시의 시작 천간 결정.
   - 子시 시간대: 23:30~01:30, 丑시: 01:30~03:30, ... (2시간 단위)
   - 시 천간: (日干 인덱스 × 2 + 時支 인덱스) % 10

[오행 매핑]
천간: 甲乙=木, 丙丁=火, 戊己=土, 庚辛=金, 壬癸=水
지지: 寅卯=木, 巳午=火, 辰戌丑未=土, 申酉=金, 亥子=水

[용신 결정 (단순화 버전)]
- 5개 오행 중 카운트가 가장 낮은(혹은 0인) 것을 용신으로
- 동률이면 임의로 결정 후 yongsin_desc에서 안내

[보조 함수]
export function getElement(cheonOrJi) → '木'|'火'|'土'|'金'|'水'

[테스트]
모듈 작성 후 backend/scripts/test-saju.js 를 만들어 다음을 검증:
- 2026-08-15 04:30 (양력) → 결과 출력
- 시간 없음 (hour=null) → 시주 제외 결과 출력
- 2000-01-01 12:00 → 결과 출력

테스트는 node scripts/test-saju.js로 실행 가능해야 한다.

작업 완료 후 콘솔 출력 예시를 보여달라.
```

### ✅ 확인
- `backend/lib/saju.js` 생성됨
- `backend/scripts/test-saju.js` 실행 시 사주팔자와 오행 분포가 출력됨
- 동일 입력에 동일 결과 (결정론적)

### 🆘 자주 나는 오류
- `korean-lunar-calendar` 미설치 → `npm install korean-lunar-calendar`
- "Cannot find module" → `cd backend` 후 다시 실행
- 갑자 순환 어긋남 → 1984-02-04(입춘) 기준으로 미세 조정 요청

➡️ **다음**: 단계 3

---

# 📍 단계 3 — 사주 분석 API 엔드포인트

🎯 **목표**: 프론트엔드가 호출할 수 있는 `/api/saju/analyze` 엔드포인트 완성  
⏱ **예상 시간**: AI 작업 약 15분

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라.

[작업]
backend/server.js에 POST /api/saju/analyze 엔드포인트를 추가하라.

[요청 형식]
{
  "birth_date": "2026-08-15",      // 양력 YYYY-MM-DD
  "birth_hour": 4,                  // 시간 (0~23). null 가능 (시간 모름)
  "is_due_date": false,             // 예정일 기준 여부
  "name": "지우",                   // 한글 이름
  "hanja": "智宇",                  // 한자
  "last_name": "김",                // 성
  "gender": "남아",                 // 남아 / 여아
  "is_premium": false               // 결제자 여부 (모델 분기용)
}

[처리]
1. backend/lib/saju.js의 calculateSaju 호출 → 사주팔자·오행 분포·용신
2. backend/data/hanja_db.json 로드해서 hanja 각 글자의 자원오행 추출
3. 음령오행 계산: 이름 각 음의 초성 → 오행
   ㄱㅋ=木 / ㄴㄷㄹㅌ=火 / ㅇㅎ=土 / ㅅㅈㅊ=金 / ㅁㅂㅍ=水
4. 적합도 점수 산출 (0~100)
   - 음령오행이 용신을 포함하면 +30점
   - 자원오행이 용신을 포함하면 +50점
   - 그 외 오행 균형도 +20점
   - 시간 모름이면 보정 -5점
5. OpenRouter API로 자연어 풀이 요청 (모델 분기)
   - is_premium=false → 'openai/gpt-4o-mini'
   - is_premium=true → 'openai/gpt-4o'
   - 프롬프트는 결정론적 계산 결과를 자연스러운 한국어 1~2문단으로 풀어쓰기

[응답 형식]
{
  "palja": { ... },                  // saju.js 결과 그대로
  "elements": { 木:2, 火:3, ... },
  "yongsin": "水",
  "yongsin_desc": "...",
  "name_analysis": {
    "eumryeong": ["木","金","土"],   // 음령오행 (성+이름)
    "jawon": ["火","土"]              // 자원오행 (한자별)
  },
  "score": 78,
  "score_label": "보통 적합",         // 90+ 매우적합 / 70+ 보통적합 / 50+ 다소부족 / 그외 부적합
  "narrative": "김지우 智宇는 지혜와 우주를 품는 ..."
}

[에러 처리]
- 필수 필드 누락 → 400
- hanja_db.json에 없는 한자 → 자원오행 '土' 임시 처리 + 경고 로그
- LLM 호출 실패 → narrative 필드만 빈 값으로 다른 데이터 정상 반환

작업 완료 후 curl 또는 thunder client로 테스트하는 명령 예시를 알려달라.
```

### ✅ 확인
- 서버 재시작 후 다음 curl 정상 응답:
  ```powershell
  curl -X POST http://localhost:3000/api/saju/analyze -H "Content-Type: application/json" -d '{\"birth_date\":\"2026-08-15\",\"birth_hour\":4,\"name\":\"지우\",\"hanja\":\"智宇\",\"last_name\":\"김\",\"gender\":\"남아\"}'
  ```
- 응답에 `palja`, `elements`, `yongsin`, `score`, `narrative` 모두 포함

➡️ **다음**: 단계 4

---

# 📍 단계 4 — 사주 UI 통합 (월드컵 결과 → 사주 결과)

🎯 **목표**: `mockup-saju.html`의 1~3번 화면을 실제 `frontend/index.html`에 통합  
⏱ **예상 시간**: AI 작업 약 30~40분  
🔒 **사전 조건**: 단계 3 완료, `mockup-saju.html` 존재

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라. 그리고 mockup-saju.html을 읽어 시각 시안을 파악하라.

[작업]
frontend/index.html에 사주 보기 기능을 통합하라. UI는 mockup-saju.html의 화면 1, 2, 3을 그대로 적용한다.

[변경 사항]

1. 월드컵 결과 화면 (#page-worldcup의 결과 영역)과 왕중왕전 결과 화면(#page-grand의 결과 영역), 보관함의 이름 카드(#page-profile의 saved-name-list)에:
   - 기존 보관함 버튼/저장 버튼 좌측에 [🔮 사주 보기 시작] 버튼 추가
   - 클릭 시 openSajuFlow(nameObj) 호출

2. 새 함수 openSajuFlow(nameObj):
   - Supabase profiles 테이블의 birth_info 컬럼 확인 (없으면 추가 마이그레이션)
   - 정보가 없으면 생일 입력 모달 표시 (mockup의 화면 2)
   - 정보가 있으면 바로 fetch('/api/saju/analyze', ...)
   - 결과를 새 페이지 #page-saju에 표시

3. 새 페이지 #page-saju 추가:
   - 상단: ← 뒤로 + "🔮 [이름] 사주 풀이"
   - 사주팔자 4칸 그리드 (시주·일주·월주·년주, 천간 큰 글씨, 지지 작은 글씨, 오행 표기)
   - 오행 5각형 SVG 레이더 차트 (정확히 mockup의 SVG 형태 사용)
   - 용신 배너
   - 적합도 점수 + 진행바
   - AI 풀이 카드
   - 하단 액션 2개: [✨ 다른 한자 추천] [📜 감정서로 받기]
   - "💎 첫 1회 무료" 안내 푸터

4. 생일 입력 모달 (mockup 화면 2 그대로):
   - 양력 날짜 input
   - 예정일 체크박스
   - 시간 선택 12지 + "시간 모름" 옵션
   - 저장 → Supabase profiles 갱신 → 사주 분석 API 호출 → 결과 화면

5. CSS는 mockup-saju.html의 스타일을 frontend/index.html의 <style>에 추가. 기존 디자인 토큰(--primary 등) 재사용.

6. 라우팅: #saju hash 추가, goPage('saju') 지원.

[중요]
- 모바일 우선 (max-width 480px) 유지
- 기존 site의 컴포넌트(.card, .btn, .top-bar) 패턴 따르기
- 사주 보기 1회 무료 카운터는 추후 구현 (지금은 단순히 호출만 되게)
- Supabase profiles 테이블에 birth_info JSONB 컬럼이 없으면 콘솔에 마이그레이션 SQL 출력

[테스트 시나리오]
1. 로컬에서 npm start
2. 이름 생성 → 월드컵 진행 → 우승 화면에서 [🔮 사주 보기 시작] 클릭
3. 생일 입력 모달 → 정보 입력 → 분석 시작
4. 사주 결과 페이지가 정확히 mockup-saju.html 화면 3과 동일하게 나오는지

작업 시 mockup-saju.html을 자주 참고하고, 화면 비교를 위해 작업 후 두 파일의 차이를 보고하라.
```

### ✅ 확인
- 월드컵 우승 → 🔮 버튼 노출
- 생일 입력 모달 정상 작동
- 사주 결과 화면이 mockup과 90% 이상 동일
- 새로고침해도 입력한 생일 정보 유지

### 🆘 자주 나는 오류
- "birth_info column does not exist" → Supabase 콘솔에서 `ALTER TABLE profiles ADD COLUMN birth_info JSONB;` 실행
- SVG 차트 깨짐 → mockup-saju.html의 SVG 코드를 그대로 복사 권장

➡️ **다음**: 단계 5

---

# 📍 단계 5 — 다른 한자 추천 모듈

🎯 **목표**: 사주 결과에서 [✨ 다른 한자 추천] 클릭 시 작동하는 백엔드 로직  
⏱ **예상 시간**: AI 작업 약 20분

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라.

[작업]
backend/server.js에 POST /api/hanja/alternatives 엔드포인트를 추가하라.

[요청 형식]
{
  "name": "지우",
  "current_hanja": "智宇",
  "saju_yongsin": "水",        // 사주의 부족 오행
  "gender": "남아",
  "is_premium": false
}

[처리 로직]
1. backend/data/hanja_db.json 로드
2. 이름의 각 음(예: '지', '우') 별로 동일 음을 가진 한자 후보 추출
   (hanja_db에서 sound === '지'인 모든 한자, '우'인 모든 한자)
3. 가능한 조합 생성 (예: '지' 후보 × '우' 후보)
4. 각 조합의 점수 계산:
   - 자원오행이 saju_yongsin을 포함 → +50점
   - 두 한자의 자원오행이 상생 관계 → +20점 (木→火→土→金→水→木)
   - 의미 자연스러움 (LLM이 판단) → +30점
5. 상위 4~6개 조합 LLM에게 의미·뉘앙스 보강 요청
   - 모델 분기: is_premium=true → gpt-4o, false → gpt-4o-mini
6. 결과 반환:

[응답 형식]
{
  "base_name": "지우",
  "alternatives": [
    {
      "hanja": "智潤",
      "score": 92,
      "is_recommended": true,
      "elements_jawon": ["火", "水"],
      "elements_eumryeong": ["金", "土"],
      "meaning": "지혜로움과 윤택함",
      "explanation": "智(火)·潤(水)으로 사주의 부족한 水 기운을 강력하게 보완합니다",
      "category": "saju_match"   // saju_match | meaning | classic
    },
    ...
  ]
}

[카테고리]
- saju_match: 용신 보완 조합 (상위)
- meaning: 의미가 자연스러운 조합
- classic: 전통적·인기 조합

추천 4~6개 결과 반환.

작업 완료 후 curl 테스트 예시를 알려달라.
```

### ✅ 확인
- 응답에 `alternatives` 배열 (4~6개)
- `is_recommended: true` 항목이 최소 1개

➡️ **다음**: 단계 6

---

# 📍 단계 6 — 다른 한자 추천 UI

🎯 **목표**: `mockup-saju.html`의 화면 4를 `frontend/index.html`에 통합  

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md와 mockup-saju.html을 먼저 읽어라.

[작업]
frontend/index.html에 새 페이지 #page-hanja-alt 추가. UI는 mockup-saju.html 화면 4를 그대로.

[변경 사항]
1. 사주 결과 페이지의 [✨ 다른 한자 추천] 버튼 → goPage('hanja-alt') + fetch 호출
2. #page-hanja-alt 페이지 구성:
   - 상단: ← 뒤로(사주 결과로) + "✨ 다른 한자 추천"
   - 기준 이름 요약 카드
   - 섹션 1: "🎯 사주에 더 적합한 조합" (saju_match 카테고리)
   - 섹션 2: "📚 다른 의미 있는 조합" (meaning + classic)
   - 추천 1순위는 .recommended 클래스로 황금색 강조
   - 각 카드: 한자 + 한글 + 점수 + 의미 + 자원오행/음령오행
   - 하단 액션: [← 사주로 돌아가기] [📜 감정서로 받기]
   - "💎 첫 1회 무료" 푸터

3. CSS는 mockup-saju.html에서 .hanja-alt-card 관련 스타일을 복사.

4. 라우팅: #hanja-alt hash + state 관리 (어떤 이름의 추천인지 기억)

[테스트]
1. 사주 결과에서 [✨ 다른 한자 추천] 클릭
2. mockup 화면 4와 동일하게 4~6개 한자 카드 표시
3. 추천 1위는 황금 테두리
```

### ✅ 확인
- 사주 결과 → 한자 추천 화면 매끄러운 전환
- 추천 카드 디자인이 mockup과 일치

➡️ **다음**: 단계 7

---

# 📍 단계 7 — 감정서 미리보기 화면

🎯 **목표**: `mockup-saju.html` 화면 5를 통합 (PDF 생성 전 단계)  

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md와 mockup-saju.html을 먼저 읽어라.

[작업]
frontend/index.html에 새 페이지 #page-certificate 추가. UI는 mockup-saju.html 화면 5를 그대로.

[변경 사항]
1. 사주 결과 / 한자 추천 페이지의 [📜 감정서로 받기] 버튼 → goPage('certificate')
2. #page-certificate 페이지 구성:
   - 상단: ← 뒤로 + "📜 작명 감정서"
   - 감정서 종이 카드 (.cert-paper):
     - "미리보기" 워터마크
     - 作名鑑定書 헤더
     - 큰 글씨 한자 이름 (예: 金 智 宇)
     - 사주팔자 섹션
     - 오행 분포 섹션
     - 이름 적합도 섹션
     - 종합 평가 섹션 (AI 풀이)
     - 푸터 + 감정 완료 도장
   - 하단 액션 영역:
     - "🔒 화면 미리보기는 무료입니다" 문구
     - [📥 PDF로 다운로드] 버튼 (지금은 alert로 "결제 모듈 연동 예정" 표시)
   - "💎 화면 미리보기는 첫 1회 무료" 푸터

3. 데이터 소스: 직전 사주 결과 + 한자 추천 결과를 합쳐서 표시
4. CSS는 mockup-saju.html의 .cert-paper 관련 스타일 복사

작업 후 mockup-saju.html 화면 5와 시각적으로 비교해서 차이가 있으면 보고.
```

### ✅ 확인
- 감정서 종이 디자인이 mockup과 일치
- 워터마크 보임
- PDF 다운로드 버튼 클릭 시 alert (결제 모듈 자리)

➡️ **다음**: 단계 8

---

# 📍 단계 8 — 감정서 PDF 생성 (백엔드)

🎯 **목표**: 결제 후 실제 PDF 파일을 생성·다운로드하는 백엔드 기능 (결제 게이트는 추후)  
⏱ **예상 시간**: AI 작업 약 30분

### 📋 프롬프트

```
프로젝트 루트의 PLAYBOOK.md를 먼저 읽어라.

[작업]
backend/server.js에 POST /api/certificate/generate 엔드포인트를 추가하라. 이 API는 감정서 데이터를 받아 PDF 버퍼를 반환한다.

[필요 패키지]
1. cd backend
2. npm install puppeteer
(설치가 무거우면 대안으로 'pdfkit' 또는 'jspdf' 사용 가능. 그 경우 추천 사유를 알려달라)

[요청 형식]
{
  "data": {
    "full_name_korean": "김지우",
    "full_name_hanja": "金智宇",
    "birth_date": "2026-08-15",
    "birth_hour": "04:30",
    "palja": "丙寅 / 辛酉 / 甲申 / 丙午",
    "elements_str": "木 2 · 火 3 · 土 1 · 金 3 · 水 0",
    "yongsin": "水",
    "score": 78,
    "score_label": "보통 적합",
    "summary": "지혜와 우주를 품는 단아한 이름..."
  }
}

[처리]
1. backend/templates/certificate.html 템플릿 파일에 위 데이터를 치환
   - 템플릿은 mockup-saju.html 화면 5의 cert-paper 디자인을 단독 HTML로 추출
   - 워터마크는 제거 (실제 PDF는 무워터마크)
   - 페이지 크기 A4 세로
2. puppeteer로 HTML → PDF 변환
3. PDF 버퍼를 응답으로 반환 (Content-Type: application/pdf, Content-Disposition: attachment; filename="작명감정서_김지우.pdf")

[프론트엔드 연결]
frontend/index.html의 [📥 PDF로 다운로드] 버튼:
- 현재는 alert
- 이번 단계에서 fetch(/api/certificate/generate) → blob → 다운로드로 연결
- 단, 사용자 결제 상태(localStorage 'is_premium')가 false면 페이월 모달 표시 (mockup 화면 6 활용)
- true면 실제 다운로드

[페이월 모달 추가]
mockup-saju.html 화면 6을 #paywall-modal로 frontend/index.html에 추가:
- ₩7,900 / 30일 작명 패스
- "단발 결제 · 자동갱신 없음" 문구
- [💎 결제하기] 버튼은 현재 alert('결제 모듈은 다음 단계')
- [나중에 하기] 버튼은 모달 닫기

[테스트]
1. localStorage에 is_premium='true' 임시 세팅
2. 감정서 → PDF 다운로드 클릭 → PDF 파일 받기
3. localStorage 지우고 다시 → 페이월 모달 노출

작업 후 받은 PDF의 디자인이 mockup-saju.html 화면 5와 시각적으로 일치하는지 비교 보고.
```

### ✅ 확인
- 임시 premium 상태에서 PDF 정상 다운로드
- 비프리미엄 상태에서 페이월 모달 정상 노출

### 🆘 자주 나는 오류
- puppeteer 설치 실패(Windows) → `npm install puppeteer --ignore-scripts` 시도하거나 pdfkit으로 변경 요청
- 한글 폰트 깨짐 → 템플릿에 `@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR')` 추가

➡️ **다음**: 모든 기능 통합 완료 — 이후 단계는 결제 모듈 연동(별도 가이드 필요 시 요청)

---

# 🆘 자주 나는 오류 & 일반 디버깅

### 1. Module not found
```
원인: npm install이 안 됨 또는 wrong cwd
해결: cd backend 후 npm install
```

### 2. CORS error in browser
```
backend/server.js에 이미 cors 미들웨어 있음. 만약 빠졌으면 추가:
import cors from 'cors';
app.use(cors());
```

### 3. Supabase 권한 오류
```
원인: RLS 정책 미설정
해결: Supabase 콘솔 → Authentication → Policies 에서 profiles 테이블 RLS 확인
```

### 4. OpenRouter API 응답 지연
```
원인: 무료 모델은 가끔 느림
해결: 'qwen/qwen3-235b-a22b:free' 대신 'openai/gpt-4o-mini' 사용 (.env 변경)
```

### 5. localStorage 충돌 (모드 전환 시)
```
브라우저 F12 → Application → Local Storage → 픽베이비네임 도메인 → Clear
```

---

# 🎯 진행 체크리스트

각 단계 완료 시 ✓ 표시 (수기로 메모):

- [ ] 단계 1 — 한자 메타DB 빌드 (hanja_db.json 생성됨)
- [ ] 단계 2 — 사주 계산 모듈 (lib/saju.js + test-saju.js 통과)
- [ ] 단계 3 — 사주 API (/api/saju/analyze 응답 정상)
- [ ] 단계 4 — 사주 UI (월드컵 → 사주 결과 흐름 완성)
- [ ] 단계 5 — 한자 추천 API (/api/hanja/alternatives 응답 정상)
- [ ] 단계 6 — 한자 추천 UI (화면 4 통합)
- [ ] 단계 7 — 감정서 미리보기 UI (화면 5 통합)
- [ ] 단계 8 — PDF 생성 + 페이월 모달 (화면 6)

모든 체크가 끝나면 픽베이비네임 프리미엄 기능 3종 + 페이월 UI까지 완성. 다음은 토스페이먼츠 결제 연동.

---

# 📞 막혔을 때

각 단계 프롬프트의 결과가 기대와 다르면 다음과 같이 후속 프롬프트로 수정 요청:

```
[방금 한 작업의 [구체적 부분]이 [구체적 결과]가 되어야 하는데
실제로는 [현재 결과]이다. mockup-saju.html 화면 [N]번과 비교해서
[구체적 항목]을 수정해라.]
```

예시:
```
사주 결과 화면의 오행 5각형 차트가 mockup-saju.html 화면 3과 다르게 보인다.
mockup의 SVG 코드를 그대로 복사해서 사용해라.
```

---

**작성일**: 2026-05-13  
**버전**: v1.0  
**프로젝트 위치**: `C:\Users\ADMIN\Documents\projects\naming-worldcup\`

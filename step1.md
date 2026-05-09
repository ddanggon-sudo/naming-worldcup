# Step 1 — 이름 생성기

## 개요
사용자가 기준을 설정하면 OpenRouter(qwen/qwen3-235b-a22b:free)가 그에 맞는 한국 아기 이름을 생성한다.

---

## 기술 스택
| 구분 | 선택 |
|------|------|
| Frontend | HTML + CSS + Vanilla JS (단일 파일) |
| Backend | Python + FastAPI |
| API | OpenRouter (OpenAI SDK 호환) |
| 환경변수 | python-dotenv → `.env` |

---

## 화면 구성

```
┌─────────────────────────────────────────┐
│           아기 이름 생성기               │
├─────────────────────────────────────────┤
│ 성(姓)   [    ] (예: 김, 이, 박)        │
│ 성별     [남아 ▼]                       │
│                                         │
│ ☐ 두자 이름   ☐ 외자 이름              │
│ ☐ 매일 부르기 편해야 함                 │
│ ☐ 유행을 덜 타야 함                    │
│ ☐ 어른이 되어도 잘 어울려야 함         │
│ ☐ 형제 이름과 조화로워야 함            │
│     └→ 형제 이름 [          ]          │
│ ☐ 놀림받기 쉬운 요소가 없어야 함       │
│ ☐ 발음이 자연스러워야 함               │
│ ☐ 너무 흔하지 않아야 함               │
│                                         │
│ 이름 인상  [부드러운 느낌 ▼]           │
│ 생성 개수  [10 ▼]                      │
│                                         │
│          [✨ 이름 생성하기]             │
├─────────────────────────────────────────┤
│ 결과 목록                               │
│  1. 지우 (智宇) — 지혜롭고 넓은 뜻     │
│     [♡ 저장] [→ 월드컵에 추가]         │
│  2. ...                                 │
└─────────────────────────────────────────┘
```

---

## 입력 필드 명세

| 필드 | 타입 | 값 |
|------|------|----|
| 성 | text input | 자유 입력 |
| 성별 | select | 남아 / 여아 |
| 이름 글자 수 | checkbox | 두자 / 외자 (복수 선택 가능) |
| 발음 편의 | checkbox | - |
| 시대 초월 | checkbox | - |
| 성인 어울림 | checkbox | - |
| 형제 조화 | checkbox | → 체크 시 형제 이름 text input 노출 |
| 놀림 방지 | checkbox | - |
| 자연스러운 발음 | checkbox | - |
| 희귀성 | checkbox | - |
| 이름 인상 | select | 부드러운/밝은/똑똑한/강한/세련된/차분한/개성 있는 |
| 생성 개수 | select | 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 |

---

## 백엔드 API

### `POST /api/generate`

**Request body:**
```json
{
  "last_name": "김",
  "gender": "남아",
  "syllables": ["두자"],
  "criteria": ["매일 부르기 편해야 함", "유행을 덜 타야 함"],
  "sibling_names": ["지훈"],
  "impression": "부드러운 느낌",
  "count": 10
}
```

**Response:**
```json
{
  "names": [
    {
      "name": "지우",
      "hanja": "智宇",
      "meaning": "지혜롭고 넓은 우주를 품는다는 뜻",
      "reason": "부드러운 발음, 시대를 타지 않는 느낌"
    }
  ]
}
```

---

## 프롬프트 설계

```
당신은 한국 아기 이름 전문가입니다.

[요청 조건]
- 성: {last_name}
- 성별: {gender}
- 글자 수: {syllables}
- 선택한 기준: {criteria}
- 이름 인상: {impression}
- 형제 이름: {sibling_names} (있을 경우 조화 고려)

위 조건에 맞는 한국 아기 이름 {count}개를 추천해 주세요.
각 이름마다 다음 항목을 JSON 배열로 반환하세요:
- name: 한글 이름
- hanja: 한자 (적절한 한자 조합)
- meaning: 이름 뜻 (1~2문장)
- reason: 선택한 기준에 맞는 이유 (1문장)

중복 없이, 다양한 느낌으로 추천하세요.
반드시 JSON만 반환하고 다른 텍스트는 쓰지 마세요.
```

---

## 파일 구조

```
gon/
├── backend/
│   ├── main.py          # FastAPI 앱, /api/generate 엔드포인트
│   ├── openrouter.py    # OpenRouter 호출 로직
│   └── requirements.txt
├── frontend/
│   └── index.html       # 전체 UI (HTML + CSS + JS 단일 파일)
└── .env
```

---

## 구현 순서
1. `backend/requirements.txt` 작성 및 패키지 설치
2. `backend/openrouter.py` — API 호출 함수 구현
3. `backend/main.py` — FastAPI 서버 + CORS 설정
4. `frontend/index.html` — UI 구현 및 fetch 연동
5. 로컬 테스트 (`uvicorn main:app --reload`)

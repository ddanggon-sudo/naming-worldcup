"""
OpenRouter 호출 + names_db.json 기반 추천 로직

[추천 흐름]
1. names_db.json에서 후보 필터링 (성별 + 인기도 + 느낌 점수)
2. LLM에게 큐레이션 요청: "이 30개 후보 중 10개 골라 + 한자/의미/이유"
3. 결과를 SSE 스트리밍용 제너레이터로 yield
"""

import json
import os
import random
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

MODEL = "qwen/qwen3-235b-a22b:free"


# ════════════════════════════════════════════════════════════
# names_db.json 캐시 (전역 1회 로드)
# ════════════════════════════════════════════════════════════

_DATA_PATH = Path(__file__).parent / "data" / "names_db.json"
_NAMES_DB = None
_NAMES_BY_KEY = None  # {(name, gender): name_obj}


def _load_names_db():
    global _NAMES_DB, _NAMES_BY_KEY
    if _NAMES_DB is None:
        if not _DATA_PATH.exists():
            raise FileNotFoundError(
                f"names_db.json이 없습니다. "
                f"먼저 'python backend/build_names_db.py'를 실행하세요."
            )
        with open(_DATA_PATH, 'r', encoding='utf-8') as f:
            _NAMES_DB = json.load(f)
        _NAMES_BY_KEY = {(n['name'], n['gender']): n for n in _NAMES_DB['names']}
    return _NAMES_DB


# ════════════════════════════════════════════════════════════
# LLM 호출 헬퍼
# ════════════════════════════════════════════════════════════

def _chat(prompt: str, temperature: float = 0.7) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return response.choices[0].message.content.strip()


def _extract_json(text: str):
    """마크다운 코드블록 또는 순수 JSON에서 파싱"""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[-1].strip() == "```":
            text = "\n".join(lines[1:-1])
        else:
            text = "\n".join(lines[1:])
    return json.loads(text)


# ════════════════════════════════════════════════════════════
# 후보 필터링
# ════════════════════════════════════════════════════════════

def _filter_candidates(
    gender: str,
    popularity: str,
    vibes: list,
    exclude: list,
    max_count: int = 30,
) -> list:
    """
    후보 추출:
    1. 성별 일치 (HARD)
    2. 인기도 일치 (HARD, 결과 너무 적으면 인접 tier 추가)
    3. 느낌 매칭 점수로 정렬 (SOFT)
    4. 이전 등장 이름 제외
    """
    db = _load_names_db()
    all_names = db['names']
    exclude_set = set(exclude or [])

    # 1. 성별 + 제외 필터
    pool = [
        n for n in all_names
        if n['gender'] == gender and n['name'] not in exclude_set
    ]

    # 2. 인기도 필터
    if popularity and popularity != 'any':
        same_tier = [n for n in pool if n['tier'] == popularity]
        if len(same_tier) >= max_count:
            pool = same_tier
        elif len(same_tier) >= 5:
            # 결과 부족 → 같은 tier + 일부 다른 tier 섞기
            others = [n for n in pool if n['tier'] != popularity]
            random.shuffle(others)
            pool = same_tier + others[: max(0, max_count - len(same_tier))]
        # else: 너무 적으면 인기도 필터 무시

    # 3. 느낌 점수 정렬
    if vibes:
        vibes_set = set(vibes)
        scored = []
        for n in pool:
            match = sum(1 for v in n.get('vibes', []) if v in vibes_set)
            # 같은 점수 내 약간의 랜덤성으로 매번 다른 추천
            scored.append((match + random.random() * 0.3, n))
        scored.sort(key=lambda x: -x[0])
        pool = [n for _, n in scored]
    else:
        random.shuffle(pool)

    return pool[:max_count]


# ════════════════════════════════════════════════════════════
# LLM 큐레이션 프롬프트
# ════════════════════════════════════════════════════════════

POPULARITY_DESC = {
    'any': '상관없음',
    '🔥매우인기': '🔥 매우 인기 (등록 10,000건 이상 - 흔한 이름)',
    '⭐인기': '⭐ 인기 (등록 3,000~10,000건)',
    '✨적당': '✨ 적당 (등록 500~3,000건)',
    '💎개성': '💎 개성있게 (등록 100~500건 - 덜 흔함)',
    '🌙희귀': '🌙 독특하게 (등록 100건 미만 - 매우 희귀)',
}


def _build_curation_prompt(
    last_name: str,
    gender: str,
    popularity: str,
    vibes: list,
    candidates: list,
    count: int,
) -> str:
    pop_desc = POPULARITY_DESC.get(popularity, popularity)
    vibes_str = ', '.join(vibes) if vibes else '특별한 선호 없음'
    candidate_str = ', '.join(c['name'] for c in candidates)

    return f"""당신은 한국 작명 전문가입니다.

[부모의 요청]
- 성: {last_name}
- 성별: {gender}
- 인기도 선호: {pop_desc}
- 원하는 느낌: {vibes_str}

[후보 이름 {len(candidates)}개 - 한국 대법원 가족관계 통계의 실제 등록 이름]
{candidate_str}

위 조건을 가장 잘 만족하는 이름 {count}개를 위 후보에서 골라주세요.
각 이름마다 어울리는 한자·의미·추천 이유를 작성해주세요.

반드시 아래 형식의 JSON 배열로만 응답하세요. 다른 텍스트는 절대 쓰지 마세요.

[
  {{
    "name": "이름(성 제외, 반드시 후보 리스트에서 선택)",
    "hanja": "어울리는 한자 조합",
    "meaning": "이름의 뜻 (1~2문장)",
    "reason": "이 이름이 부모 조건과 맞는 이유 (1문장)"
  }}
]

규칙:
- 반드시 위 후보 리스트에 있는 이름만 선택할 것
- 한자는 이름 뜻이 잘 살아나는 일반적인 조합으로
- 의미는 한자에 기반하여 자연스럽게 1~2문장
- 추천 이유는 부모의 인기도/느낌 선호와 구체적으로 연결
- 중복 없이 다양하게 {count}개
"""


# ════════════════════════════════════════════════════════════
# 메인: 추천 제너레이터
# ════════════════════════════════════════════════════════════

def _build_static_reason(name_obj: dict, popularity: str, vibes: list) -> str:
    """필터 조건과 이름 메타데이터로 자동 reason 생성 (AI 없음)"""
    parts = []
    tier = name_obj.get('tier', '')
    if popularity and popularity != 'any' and tier == popularity:
        parts.append(f"{tier} 카테고리")
    matching = [v for v in name_obj.get('vibes', []) if v in (vibes or [])]
    if matching:
        parts.append(f"{' · '.join(matching)} 느낌")
    rank = name_obj.get('rank')
    if rank:
        parts.append(f"통계 {rank:,}위")
    return ' · '.join(parts) if parts else '통계 기반 추천'


def generate_names_stream(
    last_name: str,
    gender: str,
    popularity: str = "any",
    vibes: list = None,
    exclude: list = None,
    count: int = 10,
):
    """
    이름 추천 제너레이터.

    [전략]
    1. 필터링으로 상위 후보 추출 (코드만)
    2. 보강된 한자/의미가 있으면 그대로 사용 (AI 호출 0회)
    3. 보강 안 된 이름이 있으면 LLM으로 즉석 생성 (fallback)
    """
    vibes = vibes or []
    exclude = exclude or []

    # 1. 후보 추출 (count보다 약간 넉넉히)
    candidates = _filter_candidates(
        gender=gender,
        popularity=popularity,
        vibes=vibes,
        exclude=exclude,
        max_count=max(count * 2, 20),
    )

    if not candidates:
        return

    actual_count = min(count, len(candidates))
    selected = candidates[:actual_count]

    # 2. 보강 안 된 이름이 있는지 체크
    unenriched = [c for c in selected if not c.get('hanja') or not c.get('meaning')]

    # 3. 보강 안 된 이름만 LLM으로 즉석 생성 (있을 때만)
    fallback_data = {}
    if unenriched:
        try:
            prompt = _build_curation_prompt(
                last_name=last_name,
                gender=gender,
                popularity=popularity,
                vibes=vibes,
                candidates=unenriched,
                count=len(unenriched),
            )
            raw = _chat(prompt)
            llm_results = _extract_json(raw)
            for r in llm_results:
                if isinstance(r, dict) and r.get('name'):
                    fallback_data[r['name'].strip()] = r
        except Exception:
            pass  # 실패해도 빈 hanja/meaning으로 진행

    # 4. 결과 yield
    for c in selected:
        name = c['name']
        hanja = c.get('hanja') or ''
        meaning = c.get('meaning') or ''

        # DB에 없으면 fallback 사용
        if (not hanja or not meaning) and name in fallback_data:
            fb = fallback_data[name]
            hanja = hanja or fb.get('hanja', '')
            meaning = meaning or fb.get('meaning', '')

        yield {
            'name': name,
            'hanja': hanja,
            'meaning': meaning,
            'reason': _build_static_reason(c, popularity, vibes),
            'tier': c.get('tier', ''),
            'rank': c.get('rank'),
            'count_in_db': c.get('count'),
            'vibes': c.get('vibes', []),
        }


# ════════════════════════════════════════════════════════════
# 희귀도 조회 (DB 우선, 없으면 LLM)
# ════════════════════════════════════════════════════════════

_TIER_TO_RARITY = {
    '🔥매우인기': '매우 흔함',
    '⭐인기': '흔한 편',
    '✨적당': '보통',
    '💎개성': '희귀',
    '🌙희귀': '매우 희귀',
}


def get_name_rarity(name: str, gender: str) -> dict:
    """
    이름의 등록 건수/희귀도 조회.
    1순위: names_db.json (통계 데이터, LLM 비용 0)
    2순위: LLM 추정 (DB에 없는 이름)
    """
    _load_names_db()  # 캐시 초기화 보장

    # 1순위: DB 조회
    if _NAMES_BY_KEY:
        key = (name, gender)
        if key in _NAMES_BY_KEY:
            n = _NAMES_BY_KEY[key]
            tier = n['tier']
            return {
                'estimated_population': n['count'],
                'rarity': _TIER_TO_RARITY.get(tier, '보통'),
                'rarity_description': (
                    f'{tier} · 18년 누적 {n["count"]:,}건 등록 · {n["rank"]}위'
                ),
            }

    # 2순위: LLM fallback
    prompt = f"""한국 이름 "{name}"({gender})에 대해 다음을 추정해 주세요.
통계청 2015년 기준 데이터를 참고하여 추정하세요.

반드시 아래 JSON만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.

{{
  "estimated_population": 숫자(정수),
  "rarity": "매우 희귀 | 희귀 | 보통 | 흔한 편 | 매우 흔함 중 하나",
  "rarity_description": "한 문장 설명"
}}
"""
    raw = _chat(prompt)
    return _extract_json(raw)

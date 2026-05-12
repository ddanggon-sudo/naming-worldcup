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
    """
    AI에게 '30개 중 N개 선별 + 추천 이유 작성' 요청.
    한자/의미는 DB에 이미 있으므로 AI에게 묻지 않음.
    """
    pop_desc = POPULARITY_DESC.get(popularity, popularity)
    vibes_str = ', '.join(vibes) if vibes else '특별한 선호 없음'

    # 후보 정보 풍부하게 (한자·tier·느낌 태그까지 보여줌 → AI 판단 도움)
    lines = []
    for c in candidates:
        bits = [f"{c['name']}"]
        if c.get('hanja'):
            bits.append(f"({c['hanja']})")
        bits.append(f"· {c.get('tier', '')}")
        if c.get('vibes'):
            bits.append(f"· {' · '.join(c['vibes'])}")
        lines.append('- ' + ' '.join(bits))
    candidate_block = '\n'.join(lines)

    return f"""당신은 한국 작명 전문가입니다.

[부모의 요청]
- 성: {last_name}
- 성별: {gender}
- 인기도 선호: {pop_desc}
- 원하는 느낌: {vibes_str}

[후보 이름 {len(candidates)}개 - 통계로 사전 필터링됨]
{candidate_block}

위 후보 중에서 부모의 요청에 가장 잘 맞는 이름 {count}개를 골라주세요.
각 이름마다 "왜 이 이름이 부모님께 어울리는지" 한 문장 추천 이유를 작성해주세요.

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트 절대 쓰지 마세요.

[
  {{
    "name": "이름 (반드시 후보 리스트에서)",
    "reason": "이 이름이 부모 조건과 맞는 이유 (1문장, 인기도와 느낌을 구체적으로 연결)"
  }}
]

규칙:
- 반드시 위 후보 리스트의 이름만 선택 (창작 X)
- 한자나 의미는 작성하지 마세요 (이미 DB에 있음)
- 추천 이유에서 부모의 인기도/느낌 선호를 구체적으로 언급
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
    이름 추천 제너레이터 (다이어그램 구조).

    [흐름]
    1. 코드 필터링: 5,400개 → 30개 후보 (LLM X, names_db.json 기반)
    2. AI 큐레이션: 30개 중 N개 선별 + 추천 이유 작성 (LLM 1회)
    3. 결과 yield: 한자/의미는 DB에서, 이유는 AI에서, 메타데이터 합쳐서
    """
    vibes = vibes or []
    exclude = exclude or []

    # ─────────────────────────────────────────
    # 1. 코드 필터링: 30개 후보 추출
    # ─────────────────────────────────────────
    candidates = _filter_candidates(
        gender=gender,
        popularity=popularity,
        vibes=vibes,
        exclude=exclude,
        max_count=30,
    )

    if not candidates:
        return

    actual_count = min(count, len(candidates))
    candidate_names = {c['name'] for c in candidates}
    candidate_map = {c['name']: c for c in candidates}

    # ─────────────────────────────────────────
    # 2. AI 큐레이션: 30개 → N개 + 추천 이유
    # ─────────────────────────────────────────
    ai_picks = {}  # {name: reason}
    try:
        prompt = _build_curation_prompt(
            last_name=last_name,
            gender=gender,
            popularity=popularity,
            vibes=vibes,
            candidates=candidates,
            count=actual_count,
        )
        raw = _chat(prompt)
        llm_results = _extract_json(raw)
        for r in llm_results:
            if not isinstance(r, dict):
                continue
            name = r.get('name', '').strip()
            if name and name in candidate_names:
                ai_picks[name] = r.get('reason', '').strip()
    except Exception:
        pass  # AI 실패시 아래 fallback에서 처리

    # ─────────────────────────────────────────
    # 3. 부족하면 후보 상위에서 보충 (fallback)
    # ─────────────────────────────────────────
    final_names = list(ai_picks.keys())
    if len(final_names) < actual_count:
        for c in candidates:
            if len(final_names) >= actual_count:
                break
            if c['name'] not in final_names:
                final_names.append(c['name'])

    # ─────────────────────────────────────────
    # 4. yield: AI 선별 이름 + DB 한자/의미 + AI 이유
    # ─────────────────────────────────────────
    for name in final_names[:actual_count]:
        meta = candidate_map.get(name, {})
        ai_reason = ai_picks.get(name, '')
        reason = ai_reason or _build_static_reason(meta, popularity, vibes)

        yield {
            'name': name,
            'hanja': meta.get('hanja') or '',
            'meaning': meta.get('meaning') or '',
            'reason': reason,
            'tier': meta.get('tier', ''),
            'rank': meta.get('rank'),
            'count_in_db': meta.get('count'),
            'vibes': meta.get('vibes', []),
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

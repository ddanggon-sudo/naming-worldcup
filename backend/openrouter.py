import json
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

MODEL = "qwen/qwen3-235b-a22b:free"


def _chat(prompt: str) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.9,
    )
    return response.choices[0].message.content.strip()


def _extract_json(text: str):
    """마크다운 코드블록 또는 순수 JSON 추출"""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    return json.loads(text)


def generate_names(
    last_name: str,
    gender: str,
    syllables: list[str],
    criteria: list[str],
    sibling_names: list[str],
    impression: str,
    count: int,
) -> list[dict]:
    syllable_str = " 또는 ".join(syllables) if syllables else "두자 또는 외자"
    criteria_str = "\n".join(f"- {c}" for c in criteria) if criteria else "- 없음"
    sibling_str = ", ".join(sibling_names) if sibling_names else "없음"

    prompt = f"""당신은 한국 아기 이름 전문가입니다.

[요청 조건]
- 성: {last_name}
- 성별: {gender}
- 글자 수: {syllable_str}
- 이름 인상: {impression}
- 형제 이름: {sibling_str}
- 선택한 기준:
{criteria_str}

위 조건에 맞는 한국 아기 이름 {count}개를 추천해 주세요.
각 이름마다 아래 항목을 포함한 JSON 배열로만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.

[
  {{
    "name": "한글 이름(성 제외)",
    "hanja": "한자",
    "meaning": "이름 뜻 (1~2문장)",
    "reason": "위 기준에 맞는 이유 (1문장)"
  }}
]

규칙:
- 중복 없이 다양한 느낌으로 추천
- 반드시 JSON 배열만 반환 (마크다운 코드블록 포함 가능)
"""
    raw = _chat(prompt)
    return _extract_json(raw)


def get_name_rarity(name: str, gender: str) -> dict:
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
import os
import json

from openrouter import generate_names_stream, get_name_rarity

app = FastAPI(title="아기 이름 생성기")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


# ── 요청 모델 ──────────────────────────────────────────

class GenerateRequest(BaseModel):
    last_name: str = Field(..., min_length=1)
    gender: str  # "남아" | "여아"

    # 새 필드: 인기도와 느낌
    popularity: str = "any"  # "any" 또는 tier 라벨 (예: "🔥매우인기")
    vibes: list[str] = []     # 최대 3개

    # 호환성 유지 (현재 미사용)
    syllables: list[str] = []
    exclude: list[str] = []
    count: int = Field(10, ge=1, le=30)


class RarityRequest(BaseModel):
    name: str
    gender: str


# ── 엔드포인트 ──────────────────────────────────────────

@app.post("/api/generate")
async def api_generate(req: GenerateRequest):
    """
    이름 추천 (SSE 스트리밍).
    프론트엔드는 'data: {...}\\n\\n' 형식의 이벤트를 하나씩 받아 표시.
    """
    def event_stream():
        try:
            for name_obj in generate_names_stream(
                last_name=req.last_name,
                gender=req.gender,
                popularity=req.popularity,
                vibes=req.vibes,
                exclude=req.exclude,
                count=req.count,
            ):
                yield f"data: {json.dumps(name_obj, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = {"error": str(e)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/worldcup/rarity")
async def api_rarity(req: RarityRequest):
    try:
        result = get_name_rarity(req.name, req.gender)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 프론트엔드 서빙 ────────────────────────────────────

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

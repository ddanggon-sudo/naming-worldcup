from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
import os

from openrouter import generate_names, get_name_rarity

app = FastAPI(title="아기 이름 생성기")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


# ── 요청/응답 모델 ──────────────────────────────────────

class GenerateRequest(BaseModel):
    last_name: str = Field(..., min_length=1)
    gender: str  # "남아" | "여아"
    syllables: list[str] = []  # ["두자", "외자"]
    criteria: list[str] = []
    sibling_names: list[str] = []
    impression: str = "부드러운 느낌"
    count: int = Field(10, ge=10, le=100)


class RarityRequest(BaseModel):
    name: str
    gender: str


# ── 엔드포인트 ──────────────────────────────────────────

@app.post("/api/generate")
async def api_generate(req: GenerateRequest):
    try:
        names = generate_names(
            last_name=req.last_name,
            gender=req.gender,
            syllables=req.syllables,
            criteria=req.criteria,
            sibling_names=req.sibling_names,
            impression=req.impression,
            count=req.count,
        )
        return {"names": names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

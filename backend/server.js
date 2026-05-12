import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.OPENROUTER_API_KEY) {
  console.error('[fatal] OPENROUTER_API_KEY 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODELS = [
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
  'openai/gpt-4o',
];

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── names_db.json 로드 (서버 시작 시 1회) ──────────────────────

let _namesDB = null;

function loadDB() {
  if (_namesDB) return _namesDB;
  const dataPath = path.join(__dirname, 'data', 'names_db.json');
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  _namesDB = raw.names;
  console.log(`[db] 이름 DB 로드 완료: ${_namesDB.length}개`);
  return _namesDB;
}

// ── DB 필터링 (Python openrouter.py 포팅) ──────────────────────

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function filterCandidates({ gender, popularity, vibes, exclude, maxCount }) {
  const db = loadDB();
  const excludeSet = new Set(exclude || []);

  // 1. 성별 + 제외 필터
  let pool = db.filter(n => n.gender === gender && !excludeSet.has(n.name));

  // 2. 인기도 tier 필터
  if (popularity && popularity !== 'any') {
    const sameTier = pool.filter(n => n.tier === popularity);
    if (sameTier.length >= maxCount) {
      pool = sameTier;
    } else if (sameTier.length >= 5) {
      const others = shuffleArray(pool.filter(n => n.tier !== popularity));
      pool = [...sameTier, ...others.slice(0, Math.max(0, maxCount - sameTier.length))];
    }
    // 5개 미만이면 인기도 필터 무시 (전체 pool 사용)
  }

  // 3. 느낌(vibes) 매칭 점수로 정렬
  if (vibes && vibes.length) {
    const vibesSet = new Set(vibes);
    pool = pool
      .map(n => ({
        score: (n.vibes || []).filter(v => vibesSet.has(v)).length + Math.random() * 0.3,
        n,
      }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.n);
  } else {
    shuffleArray(pool);
  }

  return pool.slice(0, maxCount);
}

function buildStaticReason(n, popularity, vibes) {
  const parts = [];
  if (popularity && popularity !== 'any' && n.tier === popularity) parts.push(n.tier);
  const matching = (n.vibes || []).filter(v => (vibes || []).includes(v));
  if (matching.length) parts.push(matching.join(' · '));
  if (n.rank) parts.push(`통계 ${n.rank.toLocaleString()}위`);
  return parts.join(' · ') || '통계 기반 추천';
}

// ── LLM 폴백 (DB 후보 부족 시) ────────────────────────────────

const POPULARITY_DESC = {
  '🔥매우인기': '🔥 매우 인기 (최근 10년 인기 상위권)',
  '⭐인기':    '⭐ 인기 (자주 쓰이지만 최상위는 아닌 이름)',
  '✨적당':    '✨ 적당 (너무 흔하지도 생소하지도 않은 이름)',
  '💎개성':   '💎 개성있게 (덜 흔하고 개성 있는 이름)',
  '🌙희귀':   '🌙 독특하게 (인기 500위 밖의 희귀한 이름)',
};

function buildFallbackPrompt({ gender, popularity, vibes, count, exclude }) {
  const popDesc = POPULARITY_DESC[popularity] ?? null;
  const vibesStr = vibes && vibes.length ? vibes.join(', ') : null;
  const excludeStr = exclude.length ? `\n제외 이름: ${exclude.join(', ')}` : '';
  return `한국 아기 ${gender} 이름 ${count}개를 추천해주세요.
${popDesc ? `인기도: ${popDesc}` : ''}
${vibesStr ? `느낌: ${vibesStr}` : ''}${excludeStr}

아래 형식으로 한 줄에 하나씩 JSON 객체만 반환하세요.
{"name":"이름","hanja":"한자","meaning":"뜻(1~2문장)","reason":"이유(1문장)"}`;
}

// ── POST /api/generate ─────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const {
    last_name, gender,
    popularity = 'any',
    vibes = [],
    count = 10,
    exclude = [],
  } = req.body;

  if (!last_name || typeof last_name !== 'string') return res.status(400).json({ detail: '성(姓)을 입력해주세요.' });
  if (!/^[가-힣a-zA-Z]{1,5}$/.test(last_name)) return res.status(400).json({ detail: '성(姓)은 한글/영문 1~5자만 허용됩니다.' });
  if (!gender || typeof gender !== 'string') return res.status(400).json({ detail: '성별을 선택해주세요.' });
  const clampedCount = Math.min(30, Math.max(1, Number(count) || 10));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // 1. DB 필터링: 요청 수의 2배 후보 추출 후 상위 N개 선택
    const maxCount = Math.max(clampedCount * 2, 20);
    const candidates = filterCandidates({ gender, popularity, vibes, exclude, maxCount });
    const selected = candidates.slice(0, clampedCount);

    console.log(`[generate/db] ${gender} 인기도=${popularity} vibes=${vibes} → 후보${candidates.length}개 중 ${selected.length}개 선택`);

    // 2. DB 결과 스트리밍 (LLM 호출 없음)
    for (const c of selected) {
      const obj = {
        name: c.name,
        hanja: c.hanja || '',
        meaning: c.meaning || '',
        reason: buildStaticReason(c, popularity, vibes),
        tier: c.tier,
        rank: c.rank,
        count_in_db: c.count,
        vibes: c.vibes || [],
      };
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    }

    // 3. DB 결과가 부족하면 LLM으로 나머지 보완
    const remaining = clampedCount - selected.length;
    if (remaining > 0) {
      console.log(`[generate/llm-fallback] DB 부족 (${selected.length}/${clampedCount}), LLM으로 ${remaining}개 보완`);
      const dbNames = new Set(selected.map(n => n.name));
      const extExclude = [...exclude, ...selected.map(n => n.name)];
      const prompt = buildFallbackPrompt({ gender, popularity, vibes, count: remaining, exclude: extExclude });

      for (const model of MODELS) {
        try {
          const stream = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.9,
            stream: true,
          });
          let buf = '';
          for await (const chunk of stream) {
            buf += chunk.choices?.[0]?.delta?.content ?? '';
            buf = buf.replace(/<think>[\s\S]*?<\/think>/g, '');
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('{')) continue;
              try {
                const obj = JSON.parse(t);
                if (!obj.name || dbNames.has(obj.name)) continue;
                res.write(`data: ${JSON.stringify(obj)}\n\n`);
              } catch (_) {}
            }
          }
          break;
        } catch (e) {
          const status = e?.status ?? e?.response?.status;
          console.warn(`[generate/llm-fallback] ${model} 실패 (${status ?? e.code})`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('[generate] 오류:', e.message);
    res.write(`data: {"error":"${e.message}"}\n\n`);
    res.end();
  }
});

// ── POST /api/worldcup/rarity ──────────────────────────────────

const TIER_TO_RARITY = {
  '🔥매우인기': '매우 흔함',
  '⭐인기':    '흔한 편',
  '✨적당':    '보통',
  '💎개성':   '희귀',
  '🌙희귀':   '매우 희귀',
};

function calcRarity(pop) {
  if (pop >= 50000) return '매우 흔함';
  if (pop >= 10000) return '흔한 편';
  if (pop >= 2000)  return '보통';
  if (pop >= 200)   return '희귀';
  return '매우 희귀';
}

function lookupRarityFromDB(name, gender) {
  const db = loadDB();
  const found = db.find(n => n.name === name && n.gender === gender);
  if (!found) return null;
  return {
    estimated_population: found.count,
    rarity: TIER_TO_RARITY[found.tier] || '보통',
    rarity_description: `${found.tier} · 누적 ${found.count.toLocaleString()}건 등록 · ${found.rank}위`,
    source: 'names_db',
  };
}

async function fetchKoreannameRarity(name, gender) {
  const url = `https://koreanname.me/api/name/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://koreanname.me/' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`koreanname.me ${res.status}`);
  const data = await res.json();
  const rank = data.rank;
  if (!rank || typeof rank.count !== 'number') throw new Error('데이터 없음');
  const pop = gender === '여아' ? (rank.female?.count ?? rank.count)
            : gender === '남아' ? (rank.male?.count  ?? rank.count)
            : rank.count;
  const years = (data.year || []).filter(y => y.count > 0);
  const latestYear = years.length ? years[years.length - 1].year : null;
  return { estimated_population: pop, rarity: calcRarity(pop), data_year: latestYear, source: 'koreanname.me' };
}

app.post('/api/worldcup/rarity', async (req, res) => {
  const { name, gender } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ detail: '이름을 입력해주세요.' });
  if (!gender || typeof gender !== 'string') return res.status(400).json({ detail: '성별을 선택해주세요.' });

  // 1순위: 로컬 names_db.json
  const dbResult = lookupRarityFromDB(name, gender);
  if (dbResult) {
    console.log(`[rarity] DB 히트: ${name} ${dbResult.estimated_population}건`);
    return res.json(dbResult);
  }

  // 2순위: koreanname.me
  try {
    const result = await fetchKoreannameRarity(name, gender);
    console.log(`[rarity] koreanname.me 성공: ${name} ${result.estimated_population}명`);
    return res.json(result);
  } catch (e) {
    console.warn(`[rarity] koreanname.me 실패 (${e.message})`);
  }

  // 3순위: 매우 희귀 처리
  return res.json({ estimated_population: 0, rarity: '매우 희귀', data_year: null, source: 'names_db' });
});

// ── 정의되지 않은 API 경로 ─────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ detail: 'Not found' }));

// ── 프론트엔드 폴백 ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`서버 실행 중 → http://localhost:${PORT}`));
}

export default app;

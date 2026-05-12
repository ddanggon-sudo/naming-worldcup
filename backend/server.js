import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { calculateSaju, getElement } from './lib/saju.js';

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

// ── hanja_db.json 로드 (서버 시작 시 1회) ──────────────────────

let _hanjaDB = null;
function loadHanjaDB() {
  if (_hanjaDB) return _hanjaDB;
  const p = path.join(__dirname, 'data', 'hanja_db.json');
  const raw = readFileSync(p, 'utf-8').replace(/^﻿/, '');
  const parsed = JSON.parse(raw);
  // 플랫 or 중첩 구조 모두 지원
  _hanjaDB = (parsed.hanja && typeof parsed.hanja === 'object' && !Array.isArray(parsed.hanja))
    ? parsed.hanja : parsed;
  console.log(`[db] 한자 DB 로드 완료: ${Object.keys(_hanjaDB).length}자`);
  return _hanjaDB;
}

// ── 음령오행 계산 ────────────────────────────────────────────────
// 초성 인덱스 → 오행: ㄱㄲㅋ=木 / ㄴㄷㄸㄹㅌ=火 / ㅇㅎ=土 / ㅅㅆㅈㅉㅊ=金 / ㅁㅂㅃㅍ=水
const CHOSEONG_OHAENG = [
  '木','木','火','火','火','火','水','水','水','金',
  '金','土','金','金','金','木','火','水','土',
];

function getEumryeongOhaeng(koreanChar) {
  const code = koreanChar.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null; // 한글 음절 아님
  const choseongIdx = Math.floor((code - 0xAC00) / (21 * 28));
  return CHOSEONG_OHAENG[choseongIdx] || null;
}

function calcEumryeong(fullName) {
  // fullName: 성+이름 (예: '김지우')
  return [...fullName]
    .map(c => getEumryeongOhaeng(c))
    .filter(Boolean);
}

// ── 오행 균형 점수 ───────────────────────────────────────────────
function calcBalanceScore(elements) {
  // 5개 오행 중 0인 것의 비율로 감점
  const zeros = Object.values(elements).filter(v => v === 0).length;
  return Math.round(20 * (1 - zeros / 5));
}

// ── 적합도 점수 라벨 ─────────────────────────────────────────────
function scoreLabel(score) {
  if (score >= 90) return '매우 적합';
  if (score >= 70) return '보통 적합';
  if (score >= 50) return '다소 부족';
  return '부적합';
}

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

app.post('/api/worldcup/rarity', async (req, res) => {
  const { name, gender } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ detail: '이름을 입력해주세요.' });
  if (!gender || typeof gender !== 'string') return res.status(400).json({ detail: '성별을 선택해주세요.' });

  const db = loadDB();
  const found = db.find(n => n.name === name && n.gender === gender);
  if (found) {
    console.log(`[rarity] DB 히트: ${name} ${found.count}건`);
    return res.json({
      estimated_population: found.count,
      rarity: TIER_TO_RARITY[found.tier] || '보통',
      source: 'names_db',
    });
  }

  // DB에 없으면 20명 미만 · 매우 희귀
  return res.json({ estimated_population: null, rarity: '매우 희귀', source: 'names_db' });
});

// ── POST /api/enrich ──────────────────────────────────────────
// 이름에 어울리는 한자·뜻을 DB 또는 LLM으로 반환

async function chatOnce(prompt) {
  for (const model of MODELS) {
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });
      const content = res.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('빈 응답');
      return content;
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      console.warn(`[enrich] ${model} 실패 (${status ?? e.code})`);
      const retryable = status === 429 || status === 503 || status === 500
        || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET';
      if (!retryable) throw e;
    }
  }
  throw new Error('모든 모델이 응답하지 않습니다.');
}

function parseJsonSafe(text) {
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) { try { return JSON.parse(block[1].trim()); } catch (_) {} }
  try { return JSON.parse(text); } catch (_) {}
  const start = text.search(/\{/);
  if (start !== -1) { try { return JSON.parse(text.slice(start)); } catch (_) {} }
  return null;
}

app.post('/api/enrich', async (req, res) => {
  const { name, gender } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ detail: '이름을 입력해주세요.' });

  // 1순위: names_db.json
  const db = loadDB();
  const found = db.find(n => n.name === name && (gender ? n.gender === gender : true));
  if (found?.hanja && found?.meaning) {
    console.log(`[enrich] DB 히트: ${name}`);
    return res.json({ hanja: found.hanja, meaning: found.meaning });
  }

  // 2순위: LLM
  try {
    const prompt = `한국 이름 "${name}"(${gender || '성별 무관'})에 어울리는 한자 조합과 이름 뜻을 추천해주세요.
아래 JSON 형식으로만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.
{"hanja":"한자조합","meaning":"이름의 뜻 (1~2문장)"}`;

    const raw = await chatOnce(prompt);
    const data = parseJsonSafe(raw);
    if (data?.hanja && data?.meaning) {
      console.log(`[enrich] LLM 성공: ${name} → ${data.hanja}`);
      return res.json({ hanja: data.hanja, meaning: data.meaning });
    }
    throw new Error('LLM 응답 파싱 실패');
  } catch (e) {
    console.warn(`[enrich] LLM 실패: ${e.message}`);
    return res.status(500).json({ detail: '한자·뜻 생성에 실패했습니다.' });
  }
});

// ── POST /api/saju/analyze ────────────────────────────────────
app.post('/api/saju/analyze', async (req, res) => {
  const {
    birth_date, birth_hour = null,
    is_due_date = false,
    name, hanja, last_name, gender,
    is_premium = false,
  } = req.body;

  // 필수 필드 검증
  if (!birth_date || !name || !hanja || !last_name || !gender) {
    return res.status(400).json({ detail: 'birth_date, name, hanja, last_name, gender 필드가 필요합니다.' });
  }

  // birth_date 파싱
  const [year, month, day] = birth_date.split('-').map(Number);
  if (!year || !month || !day) {
    return res.status(400).json({ detail: 'birth_date 형식은 YYYY-MM-DD 입니다.' });
  }

  try {
    // 1. 사주 계산
    const sajuResult = calculateSaju({
      year, month, day,
      hour: (birth_hour !== null && birth_hour !== '') ? Number(birth_hour) : null,
    });
    const { palja, elements, yongsin, yongsin_desc, hour_known } = sajuResult;

    // 2. 자원오행 추출
    const hanjaDB = loadHanjaDB();
const jawonList = [...hanja].map(ch => {
      const entry = hanjaDB[ch];
      if (!entry) {
        console.warn(`[saju] 한자 DB 미등록: ${ch} → 土 임시 처리`);
        return '土';
      }
      return entry.ohaeng_won;
    });

    // 3. 음령오행 (성+이름 모두)
    const fullName = last_name + name;
    const eumryeongList = calcEumryeong(fullName);

    // 4. 점수 계산
    let score = 0;
    if (eumryeongList.includes(yongsin)) score += 30;
    if (jawonList.includes(yongsin))     score += 50;
    score += calcBalanceScore(elements);
    if (!hour_known) score -= 5;
    score = Math.max(0, Math.min(100, score));

    // 5. LLM 자연어 풀이
    const model = is_premium ? 'openai/gpt-4o' : 'openai/gpt-4o-mini';
    const sajuStr = [
      `년주 ${palja.year.cheon}${palja.year.ji}`,
      `월주 ${palja.month.cheon}${palja.month.ji}`,
      `일주 ${palja.day.cheon}${palja.day.ji}`,
      palja.hour ? `시주 ${palja.hour.cheon}${palja.hour.ji}` : '시주 미상',
    ].join(' / ');
    const elemStr = Object.entries(elements).map(([k,v]) => `${k}:${v}`).join(' ');
    const llmPrompt = `한국 아기 이름 분석 결과를 자연스러운 한국어로 2~3문장으로 풀어 써주세요.

이름: ${last_name}${name} (${hanja})
성별: ${gender}
사주팔자: ${sajuStr}
오행 분포: ${elemStr}
용신(부족 오행): ${yongsin}
자원오행: ${jawonList.join(' ')}
음령오행: ${eumryeongList.join(' ')}
적합도 점수: ${score}점 (${scoreLabel(score)})

부모가 이 이름을 지어주며 어떤 의미를 담았는지, 사주와 이름의 조화 여부를 따뜻하게 설명해 주세요.`;

    let narrative = '';
    try {
      const llmRes = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: llmPrompt }],
        temperature: 0.7,
        max_tokens: 300,
      });
      narrative = llmRes.choices?.[0]?.message?.content?.trim() || '';
    } catch (llmErr) {
      console.warn(`[saju] LLM 호출 실패: ${llmErr.message}`);
      // narrative는 빈 값으로 나머지 데이터는 정상 반환
    }

    return res.json({
      palja,
      elements,
      yongsin,
      yongsin_desc,
      hour_known,
      name_analysis: {
        eumryeong: eumryeongList,
        jawon:     jawonList,
      },
      score,
      score_label: scoreLabel(score),
      narrative,
    });

  } catch (err) {
    console.error('[saju] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
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

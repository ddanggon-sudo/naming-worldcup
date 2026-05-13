import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import { calculateSaju, getElement } from './lib/saju.js';
import { calculateSuri } from './lib/suri.js';
import { generateDeokdam } from './lib/deokdam.js';
import {
  getYearGapja, monthToHan, dayToHan, hourToShi, getHanKoreanReading,
} from './lib/han-utils.js';

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
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: '1d',
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

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
  const { name, gender, hanja } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ detail: '이름을 입력해주세요.' });

  // 한자가 주어진 경우: 해당 한자의 뜻만 조회
  if (hanja && typeof hanja === 'string') {
    try {
      const prompt = `한국 이름 "${name}"(${gender || '성별 무관'})의 한자 표기 "${hanja}"의 뜻을 설명해주세요.
아래 JSON 형식으로만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.
{"meaning":"이름의 뜻 (1~2문장)"}`;

      const raw = await chatOnce(prompt);
      const data = parseJsonSafe(raw);
      if (data?.meaning) {
        console.log(`[enrich] LLM 한자뜻 성공: ${name} (${hanja})`);
        return res.json({ hanja, meaning: data.meaning });
      }
      throw new Error('LLM 응답 파싱 실패');
    } catch (e) {
      console.warn(`[enrich] LLM 실패: ${e.message}`);
      return res.status(500).json({ detail: '뜻 생성에 실패했습니다.' });
    }
  }

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

// ── POST /api/hanja/alternatives ─────────────────────────────
app.post('/api/hanja/alternatives', async (req, res) => {
  const {
    name, current_hanja = '',
    saju_yongsin, gender = '남아',
    is_premium = false,
  } = req.body;

  if (!name || !saju_yongsin) {
    return res.status(400).json({ detail: 'name, saju_yongsin 필드가 필요합니다.' });
  }

  try {
    const hanjaDB = loadHanjaDB();
    const syllables = [...name]; // ['지','우']

    // 1. 음별 후보 추출 (음 일치 한자, 글자당 최대 30개)
    const candidatesBySyllable = syllables.map(syl => {
      const matches = Object.values(hanjaDB).filter(e => e.sound === syl);
      return matches.slice(0, 30);
    });

    // 후보가 하나도 없는 음절이 있으면 조기 반환
    if (candidatesBySyllable.some(arr => arr.length === 0)) {
      return res.json({ base_name: name, alternatives: [] });
    }

    // 2. 조합 생성 (cartesian product)
    const combos = candidatesBySyllable.reduce((acc, arr) =>
      acc.flatMap(combo => arr.map(item => [...combo, item])),
    [[]]);

    // 3. 음령오행 (이름 부분만 — 모든 조합 동일)
    const eumryeongList = calcEumryeong(name);

    // 4. 상생 관계 헬퍼
    const SANGSEONG_NEXT = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' };
    function isSangseong(a, b) {
      return SANGSEONG_NEXT[a] === b || SANGSEONG_NEXT[b] === a;
    }

    // 5. 점수 산출 + 현재 한자 제외
    const scored = combos
      .map(combo => {
        const hanjaStr = combo.map(c => c.char).join('');
        const jawon    = combo.map(c => c.ohaeng_won);
        let score = 0;
        if (jawon.includes(saju_yongsin))             score += 50;
        if (combo.length === 2 && isSangseong(jawon[0], jawon[1])) score += 20;
        if (combo.length >= 3) {
          for (let i = 0; i < combo.length - 1; i++) {
            if (isSangseong(jawon[i], jawon[i+1])) score += 10;
          }
        }
        return { combo, hanjaStr, jawon, baseScore: score };
      })
      .filter(({ hanjaStr }) => hanjaStr !== current_hanja)
      .sort((a, b) => b.baseScore - a.baseScore);

    if (scored.length === 0) {
      return res.json({ base_name: name, alternatives: [] });
    }

    // 6. 상위 15개 후보 LLM 평가
    const TOP_N = 15;
    const topCandidates = scored.slice(0, TOP_N);
    const model = is_premium ? 'openai/gpt-4o' : 'openai/gpt-4o-mini';

    const candidateList = topCandidates.map(({ hanjaStr, jawon, combo }, i) => {
      const details = combo.map(c => `${c.char}(${c.meaning})`).join('·');
      return `${i+1}. ${hanjaStr} [자원오행: ${jawon.join('+')}] 뜻: ${details}`;
    }).join('\n');

    const llmPrompt = `한국 아기 이름 한자 조합 후보입니다. 상위 6개를 추천해 주세요.

이름: ${name}  성별: ${gender}  사주 용신(부족 오행): ${saju_yongsin}

후보:
${candidateList}

각 항목 평가 기준:
- hanja: 후보 한자 문자열 (그대로 복사)
- meaning_score: 이름으로서 의미의 자연스러움 (0~20점)
- meaning: 두 글자 합친 뜻 (10자 이내 한국어)
- explanation: 사주·이름 조화 설명 (1문장, 해당 한자 언급 포함)
- category: "saju_match"(용신 보완) | "meaning"(의미 아름다움) | "classic"(전통·인기)

응답 JSON:
{"items":[{"hanja":"池優","meaning_score":25,"meaning":"...","explanation":"...","category":"saju_match"},...]}

상위 6개만, JSON만 반환하세요.`;

    let llmItems = [];
    try {
      const llmRes = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: llmPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1000,
      });
      const parsed = JSON.parse(llmRes.choices[0].message.content);
      llmItems = parsed.items || parsed.data || Object.values(parsed)[0] || [];
    } catch (llmErr) {
      console.warn('[hanja-alt] LLM 실패:', llmErr.message);
      llmItems = topCandidates.slice(0, 4).map(cand => ({
        hanja: cand.hanjaStr,
        meaning_score: 0,
        meaning: cand.combo.map(c => c.meaning).join('·'),
        explanation: cand.jawon.includes(saju_yongsin)
          ? `${cand.hanjaStr}는 사주 용신(${saju_yongsin})을 보완하는 조합입니다.`
          : `${cand.hanjaStr}는 의미가 아름다운 조합입니다.`,
        category: cand.jawon.includes(saju_yongsin) ? 'saju_match' : 'meaning',
      }));
    }

    // 7. 결과 조립 (hanja 문자열로 후보 매핑)
    const candByHanja = Object.fromEntries(topCandidates.map(c => [c.hanjaStr, c]));
    const alternatives = llmItems
      .filter(item => item.hanja && candByHanja[item.hanja])
      .map(item => {
        const cand = candByHanja[item.hanja];
        return {
          hanja:             cand.hanjaStr,
          score:             Math.min(100, cand.baseScore + (item.meaning_score ?? 0)),
          is_recommended:    false,
          elements_jawon:    cand.jawon,
          elements_eumryeong: eumryeongList,
          meaning:           item.meaning || '—',
          explanation:       item.explanation || '',
          category:          cand.jawon.includes(saju_yongsin) ? 'saju_match' : (item.category || 'meaning'),
        };
      })
      .sort((a, b) => b.score - a.score);

    if (alternatives.length > 0) alternatives[0].is_recommended = true;

    return res.json({ base_name: name, alternatives });

  } catch (err) {
    console.error('[hanja-alt] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
});

// ── POST /api/certificate/generate ───────────────────────────
const OHAENG_COLOR = { 木:'#10b981', 火:'#ef4444', 土:'#a16207', 金:'#94a3b8', 水:'#3b82f6' };

// HTML에서 <style> 블록과 <body> 내용을 분리 추출
function extractPageContent(html) {
  const styles = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) styles.push(m[1]);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return { styles: styles.join('\n'), bodyContent: bodyMatch ? bodyMatch[1] : '' };
}

// 숫자 → 한글 음 (음력/양력 날짜 읽기용, 1~31)
function _koreanNum(n) {
  const ones = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  if (n <= 0) return '';
  if (n < 10) return ones[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  return (tens > 1 ? ones[tens] : '') + '십' + (unit > 0 ? ones[unit] : '');
}

// 페이지2 HTML 블록 렌더 헬퍼
function _renderGivenNameChars(chars) {
  return chars.map(c => {
    const meaning = (c.meaning || '').split(',')[0].trim();
    return `
      <div class="name-char-row">
        <div class="ann-left">${meaning} ${c.sound || ''} <span class="ann-strokes-h">(${c.strokes})</span></div>
        <span class="name-han-big">${c.char}</span>
      </div>`;
  }).join('');
}

function _renderDeokdam(items) {
  const item = (it) => `<div class="deokdam-row">
        <span class="dd-ko-side">${it.ko}</span>
        <span class="dd-han-vert">${it.hanja}</span>
      </div>`;
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(`<div class="dd-row-group">${item(items[i])}${items[i+1] ? item(items[i+1]) : ''}</div>`);
  }
  return rows.join('\n      ');
}

function _renderPalja(pillars) {
  return [...pillars].reverse().map(p => {
    const cheon = p.cheon
      ? `<div class="p-unit"><div class="p-han">${p.cheon}</div><div class="p-ko">${p.cheon_ko}</div></div>`
      : `<div class="p-empty">　</div>`;
    const ji = p.ji
      ? `<div class="p-unit"><div class="p-han">${p.ji}</div><div class="p-ko">${p.ji_ko}</div></div>`
      : `<div class="p-empty">　</div>`;
    return `<div class="pillar-block">${cheon}${ji}</div>`;
  }).join('');
}

// 페이지1 HTML 생성 (기존 로직 그대로)
function buildPage1Html(data) {
  const {
    full_name_hanja  = '',
    full_name_korean = '',
    palja_str        = '',
    birth_date       = '',
    birth_hour       = null,
    elements         = {},
    yongsin          = '',
    score            = 0,
    score_label      = '',
    eum_str          = '',
    jawon_str        = '',
    summary          = '',
  } = data;

  const ohaengPills = ['木','火','土','金','水'].map(k => {
    const cnt = elements[k] || 0;
    const isLow = k === yongsin || cnt === 0;
    return `<span class="ohaeng-pill${isLow ? ' low' : ''}" style="color:${isLow ? '#ef4444' : OHAENG_COLOR[k]}">${k} ${cnt}</span>`;
  }).join('');

  const today   = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;
  const hanjaSpaced = [...full_name_hanja].join(' ');
  const koSpaced    = [...full_name_korean].join(' ');

  let paljaDisplay = palja_str;
  if (birth_date) {
    const bd = birth_date.replace(/-/g, '.');
    const bh = birth_hour != null ? ` ${String(birth_hour).padStart(2,'0')}:00` : '';
    paljaDisplay += `\n(양력 ${bd}${bh})`;
  }

  let html = readFileSync(path.join(__dirname, 'templates', 'certificate.html'), 'utf-8');
  return html
    .replace('{{HANJA_NAME}}',   hanjaSpaced)
    .replace('{{KO_NAME}}',      koSpaced)
    .replace('{{PALJA_STR}}',    paljaDisplay)
    .replace('{{OHAENG_PILLS}}', ohaengPills)
    .replace('{{YONGSIN}}',      yongsin)
    .replace('{{SCORE}}',        String(score))
    .replace('{{SCORE_LABEL}}',  score_label)
    .replace('{{EUM_STR}}',      eum_str)
    .replace('{{JAWON_STR}}',    jawon_str)
    .replace('{{SUMMARY}}',      summary)
    .replace('{{DATE}}',         dateStr);
}

// 페이지2 HTML 생성
async function buildPage2Html(data) {
  const {
    full_name_hanja  = '',
    full_name_korean = '',
    birth_date       = '',
    birth_hour       = null,
    gender           = '',
    is_premium       = false,
  } = data;

  // 성/이름 분리 (성: 첫 글자)
  const lastHanja  = full_name_hanja[0]  || '';
  const givenHanja = full_name_hanja.slice(1) || '';

  // 생년월일 파싱
  const [y, mo, d] = birth_date ? birth_date.split('-').map(Number) : [2024, 1, 1];
  const h = typeof birth_hour === 'number' ? birth_hour : null;

  // 한자 날짜 변환
  const birthYearGapja = getYearGapja(y);
  const birthMonthHan  = monthToHan(mo);
  const birthDayHan    = dayToHan(d);
  const birthShiHan    = hourToShi(h);
  const birthInfoKo    = `${y}년 양력 ${mo}월 ${d}일 ${h !== null ? h + '시' : '시 모름'} 탄생`;

  // 한글 음 (출생정보 한자 옆 병기용)
  const birthYearKo  = [...birthYearGapja].map(c => getHanKoreanReading(c)).join('') + '년';
  const birthMonthKo = _koreanNum(mo) + '월';
  const birthDayKo   = _koreanNum(d) + '일';
  const birthHourKo  = h !== null ? getHanKoreanReading(birthShiHan[0]) + '시' : '시 모름';

  // 수리 5격
  const suri = (lastHanja && givenHanja) ? calculateSuri(lastHanja, givenHanja) : null;
  const charData      = suri ? suri.chars : [...full_name_hanja].map(c => ({ char: c, strokes: 0, yang_eum: '?' }));
  const lastCharData  = charData[0] || { char: lastHanja, strokes: 0, yang_eum: '?' };
  const hanjaDB       = loadHanjaDB();
  const givenCharData = charData.slice(1).map(c => ({
    ...c,
    sound:   hanjaDB[c.char]?.sound   || '',
    meaning: hanjaDB[c.char]?.meaning || '',
  }));

  // 사주팔자 재계산
  const sajuResult = (y > 0) ? calculateSaju({ year: y, month: mo, day: d, hour: h }) : null;
  const pillars = sajuResult ? [
    { header: '년주', cheon: sajuResult.palja.year.cheon,  cheon_ko: getHanKoreanReading(sajuResult.palja.year.cheon),  ji: sajuResult.palja.year.ji,  ji_ko: getHanKoreanReading(sajuResult.palja.year.ji)  },
    { header: '월주', cheon: sajuResult.palja.month.cheon, cheon_ko: getHanKoreanReading(sajuResult.palja.month.cheon), ji: sajuResult.palja.month.ji, ji_ko: getHanKoreanReading(sajuResult.palja.month.ji) },
    { header: '일주', cheon: sajuResult.palja.day.cheon,   cheon_ko: getHanKoreanReading(sajuResult.palja.day.cheon),   ji: sajuResult.palja.day.ji,   ji_ko: getHanKoreanReading(sajuResult.palja.day.ji)   },
    { header: '시주', cheon: sajuResult.palja.hour?.cheon || '', cheon_ko: getHanKoreanReading(sajuResult.palja.hour?.cheon || ''), ji: sajuResult.palja.hour?.ji || '', ji_ko: getHanKoreanReading(sajuResult.palja.hour?.ji || '') },
  ] : [];

  // 덕담 LLM 생성 (실패 시 기본값)
  const DEFAULT_DEOKDAM = [
    { hanja:'富家成長', ko:'부가성장' }, { hanja:'父祖有德', ko:'부조유덕' },
    { hanja:'人格出衆', ko:'인격출중' }, { hanja:'明哲人物', ko:'명철인물' },
    { hanja:'專門家', ko:'전문가' }, { hanja:'博士得名', ko:'박사득명' },
    { hanja:'健康長壽', ko:'건강장수' }, { hanja:'良配貴子', ko:'양배귀자' },
  ];
  let deokdamItems = DEFAULT_DEOKDAM;
  try {
    deokdamItems = await generateDeokdam({
      name: full_name_korean.slice(1),
      hanja: givenHanja,
      saju: sajuResult ? { palja: sajuResult.palja, elements: sajuResult.elements } : {},
      gender: gender || '무관',
      isPremium: is_premium,
    });
  } catch (e) {
    console.warn('[cert-gen] 덕담 생성 실패, 기본값 사용:', e.message);
  }

  // 템플릿 치환
  let html = readFileSync(path.join(__dirname, 'templates', 'certificate-page2.html'), 'utf-8');
  const vars = {
    '{{cert_title}}':          '作名證',
    '{{birth_year_gapja}}':    birthYearGapja,
    '{{birth_year_ko}}':       birthYearKo,
    '{{birth_month_han}}':     birthMonthHan,
    '{{birth_month_ko}}':      birthMonthKo,
    '{{birth_day_han}}':       birthDayHan,
    '{{birth_day_ko}}':        birthDayKo,
    '{{birth_shi_han}}':       birthShiHan,
    '{{birth_hour_ko}}':       birthHourKo,
    '{{birth_info_ko}}':       birthInfoKo,
    '{{last_name_hanja}}':     lastHanja,
    '{{last_name_strokes}}':   String(lastCharData.strokes),
    '{{last_name_yang_eum}}':  lastCharData.yang_eum,
    '{{name_ko}}':             full_name_korean,
    '{{office_name}}':         '픽마이네임 작명연구소',
    '{{seal_char}}':           '印',
    '{{GIVEN_NAME_CHARS_HTML}}': _renderGivenNameChars(givenCharData),
    '{{DEOKDAM_HTML}}':        _renderDeokdam(deokdamItems),
    '{{PALJA_HTML}}':          _renderPalja(pillars),
    '{{DIVIDER_TOP}}':         '148mm',
    '{{PALJA_TOP}}':           '155mm',
  };
  for (const [k, v] of Object.entries(vars)) html = html.split(k).join(v);
  return html;
}

// 2페이지 PDF 생성
async function buildCertificatePdf(data) {
  const html1 = buildPage1Html(data);
  const html2 = await buildPage2Html(data);

  const p1 = extractPageContent(html1);
  const p2 = extractPageContent(html2);

  const combined = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700;900&family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #fff; }
    .pdf-page {
      width: 210mm; height: 297mm;
      position: relative;
      page-break-after: always;
      overflow: hidden;
    }
    .pdf-page:last-child { page-break-after: auto; }
    ${p1.styles}
    ${p2.styles}
    body { padding: 0 !important; margin: 0 !important; }
  </style>
</head>
<body>
  <div class="pdf-page" style="padding:20mm 18mm;background:#fff;">${p1.bodyContent}</div>
  <div class="pdf-page" style="background:#fefdf6;">${p2.bodyContent}</div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(combined, { waitUntil: 'networkidle0', baseURL: templatesBase });
  const pdfRaw = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  return Buffer.from(pdfRaw);
}

app.post('/api/certificate/generate', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ detail: 'data 필드가 필요합니다.' });

  try {
    const pdfBuffer = await buildCertificatePdf(data);
    const safeKo = (data.full_name_korean || '').replace(/\s/g, '');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''%EC%9E%91%EB%AA%85%EA%B0%90%EC%A0%95%EC%84%9C_${encodeURIComponent(safeKo)}.pdf`,
      'Content-Length': pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[cert-gen] 오류:', err.message);
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

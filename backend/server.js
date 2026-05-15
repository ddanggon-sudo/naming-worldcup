import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import puppeteerCore from 'puppeteer-core';
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
app.use('/fonts', express.static(path.join(__dirname, 'fonts'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: '1d',
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ── Puppeteer 브라우저 런처 (Vercel: @sparticuz/chromium-min, 로컬: puppeteer) ──
// chromium-min은 바이너리 미포함 — 런타임에 원격 URL에서 /tmp 로 다운로드
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

async function _createBrowser() {
  const isLinux = process.platform === 'linux';

  // Vercel/Lambda(Linux): @sparticuz/chromium-min + 원격 바이너리
  if (isLinux) {
    try {
      const { default: chromium } = await import('@sparticuz/chromium-min');
      const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
      return await puppeteerCore.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
      });
    } catch (e) {
      console.log('[launchBrowser] chromium-min 실패:', e.message);
    }
  }

  // 로컬 개발: puppeteer 관리 Chrome (npx puppeteer browsers install chrome)
  try {
    const executablePath = puppeteer.executablePath();
    return await puppeteerCore.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    console.log('[launchBrowser] puppeteer 관리 Chrome 실패:', e.message);
  }

  // 시스템 Chrome 경로 fallback
  const localPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const executablePath of localPaths) {
    try {
      return await puppeteerCore.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    } catch {}
  }

  throw new Error('사용 가능한 Chrome/Chromium을 찾을 수 없습니다.');
}

// Item 6: warm 인스턴스에서 브라우저 재사용 (cold start 비용 1회로 감소)
let _browserInstance = null;

async function launchBrowser() {
  if (_browserInstance) {
    try {
      // 살아있는지 확인 (연결 끊기면 예외)
      await _browserInstance.pages();
      return _browserInstance;
    } catch {
      _browserInstance = null;
    }
  }
  _browserInstance = await _createBrowser();
  return _browserInstance;
}

async function releaseBrowser(browser) {
  // 재사용 모드: 브라우저를 닫지 않고 유지
  // 단, 모듈 레벨 인스턴스가 아닌 경우(폴백 등)는 닫음
  if (browser !== _browserInstance) {
    try { await browser.close(); } catch {}
  }
}


// ── 모듈 레벨 데이터 초기화 (Item 2: cold start 최적화) ──────────
const _hanyangFontB64 = (() => {
  const p = path.join(__dirname, 'fonts', 'UNI_HSR_subset.woff2');
  return readFileSync(p).toString('base64');
})();
function loadHanyangFontB64() { return _hanyangFontB64; }

const _hanjaDB = (() => {
  const p = path.join(__dirname, 'data', 'hanja_db.json');
  const raw = readFileSync(p, 'utf-8').replace(/^﻿/, '');
  const parsed = JSON.parse(raw);
  const db = (parsed.hanja && typeof parsed.hanja === 'object' && !Array.isArray(parsed.hanja))
    ? parsed.hanja : parsed;
  console.log(`[db] 한자 DB 로드 완료: ${Object.keys(db).length}자`);
  return db;
})();
function loadHanjaDB() { return _hanjaDB; }

const _hanjaMetaExt = (() => {
  const p = path.join(__dirname, 'data', 'hanja_meta_ext.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
})();
function loadHanjaMetaExt() { return _hanjaMetaExt; }

const _hanjaHun = (() => {
  const p = path.join(__dirname, 'data', 'hanja_hun.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
})();
function loadHanjaHun() { return _hanjaHun; }

const _hanjaSound = (() => {
  const p = path.join(__dirname, 'data', 'hanja_sound.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
})();
function loadHanjaSound() { return _hanjaSound; }

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

// ── 성씨 한자 변환 맵 ────────────────────────────────────────────
const SURNAME_MAP = {
  '김':'金','이':'李','박':'朴','최':'崔','정':'鄭',
  '강':'姜','조':'趙','윤':'尹','장':'張','임':'林',
  '한':'韓','오':'吳','서':'徐','신':'申','권':'權',
  '황':'黃','안':'安','송':'宋','류':'柳','유':'柳',
  '전':'全','홍':'洪','고':'高','문':'文','양':'梁',
  '손':'孫','배':'裵','백':'白','허':'許','남':'南',
  '심':'沈','노':'盧','하':'河','곽':'郭','성':'成',
  '차':'車','주':'朱','우':'禹','구':'具','민':'閔',
  '나':'羅','엄':'嚴','원':'元','채':'蔡','천':'千',
  '방':'方','공':'孔','현':'玄','함':'咸','변':'邊',
  '염':'廉','여':'呂','추':'秋','도':'都','소':'蘇',
  '석':'石','진':'陳','선':'宣','마':'馬','길':'吉',
  '왕':'王','지':'池','태':'太','용':'龍','봉':'奉',
  '경':'慶','은':'殷','옥':'玉',
};

const SURI_LEVEL_PT = { '吉': 2, '中': 1, '凶': 0 };

function calcSuriScore(lastNameKo, givenHanja) {
  const lastHanja = SURNAME_MAP[lastNameKo];
  if (!lastHanja || !givenHanja) return 0;
  try {
    const result = calculateSuri(lastHanja, givenHanja);
    const gyeoks = [result.cheon_gyeok, result.in_gyeok, result.ji_gyeok, result.oe_gyeok, result.chong_gyeok];
    return gyeoks.reduce((sum, g) => sum + (SURI_LEVEL_PT[g.level] ?? 0), 0); // 0~10
  } catch { return 0; }
}

// ── 통합 적합도 공식 ─────────────────────────────────────────────
// Base 45 + 자원오행 0~20 + 음령오행 0~15 + 오행균형 0~10 + 수리사격 0~10 - 시간패널티 0~5
function calcUnifiedScore({ lastNameKo, givenHanja, givenNameKo, yongsin, elements, hour_known }) {
  const hanjaDB = loadHanjaDB();
  const jawon = [...(givenHanja || '')].map(c => hanjaDB[c]?.ohaeng_won).filter(Boolean);
  const jawonScore = jawon.includes(yongsin) ? 20 : 0;
  const eumList = calcEumryeong((lastNameKo || '') + (givenNameKo || ''));
  const eumScore = eumList.includes(yongsin) ? 15 : 0;
  const zeros = elements ? Object.values(elements).filter(v => v === 0).length : 2;
  const balScore = Math.round(10 * (1 - zeros / 5));
  const suriScore = calcSuriScore(lastNameKo, givenHanja);
  const penalty = (hour_known === false) ? 5 : 0;
  return Math.max(0, Math.min(100, 45 + jawonScore + eumScore + balScore + suriScore - penalty));
}

// ── 적합도 점수 라벨 ─────────────────────────────────────────────
function scoreLabel(score) {
  if (score >= 85) return '매우 적합';
  if (score >= 70) return '적합';
  if (score >= 55) return '보통';
  return '다소 부족';
}

// ── names_db.json 로드 (서버 시작 시 1회) ──────────────────────
const _namesDB = (() => {
  const dataPath = path.join(__dirname, 'data', 'names_db.json');
  const names = JSON.parse(readFileSync(dataPath, 'utf-8')).names;
  console.log(`[db] 이름 DB 로드 완료: ${names.length}개`);
  return names;
})();
function loadDB() { return _namesDB; }

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

    // 4. 점수 계산 (통합 공식)
    const score = calcUnifiedScore({
      lastNameKo: last_name,
      givenHanja: hanja,
      givenNameKo: name,
      yongsin,
      elements,
      hour_known,
    });

    // 5. 즉시 반환 (LLM 풀이는 /api/saju/narrative 에서 스트리밍)
    const hanja_details = [...hanja].map(ch => {
      const entry = hanjaDB[ch];
      return { char: ch, sound: entry?.sound || '', meaning: entry?.meaning || '' };
    });

    return res.json({
      palja,
      elements,
      yongsin,
      yongsin_desc,
      hour_known,
      hanja_details,
      name_analysis: {
        eumryeong: eumryeongList,
        jawon:     jawonList,
      },
      score,
      score_label: scoreLabel(score),
    });

  } catch (err) {
    console.error('[saju] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
});

// ── POST /api/saju/narrative (LLM 풀이 SSE 스트리밍) ─────────────
app.post('/api/saju/narrative', async (req, res) => {
  const {
    birth_date, birth_hour = null,
    name, hanja, last_name, gender,
    palja, elements, yongsin, score,
  } = req.body;

  if (!name || !hanja || !last_name || !gender || !palja || !elements || !yongsin) {
    return res.status(400).json({ detail: 'name, hanja, last_name, gender, palja, elements, yongsin 필드가 필요합니다.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sajuStr = [
    `년주 ${palja.year?.cheon}${palja.year?.ji}`,
    `월주 ${palja.month?.cheon}${palja.month?.ji}`,
    `일주 ${palja.day?.cheon}${palja.day?.ji}`,
    palja.hour ? `시주 ${palja.hour.cheon}${palja.hour.ji}` : '시주 미상',
  ].join(' / ');
  const elemStr = Object.entries(elements).map(([k,v]) => `${k}:${v}`).join(' ');
  const jawonList = [...hanja].map(ch => _hanjaDB[ch]?.ohaeng_won || '土');
  const eumryeongList = calcEumryeong(last_name + name);
  const scoreVal = score ?? 0;

  const llmPrompt = `당신은 한국의 전통 작명 전문가입니다. 아래 정보를 바탕으로 부모에게 드리는 정성스러운 작명 풀이를 작성해주세요.

[분석 정보]
이름: ${last_name}${name} (${hanja})
성별: ${gender}
사주팔자: ${sajuStr}
오행 분포: ${elemStr}
용신(보완이 필요한 기운): ${yongsin}
자원오행(이름 한자의 기운): ${jawonList.join(' ')}
음령오행(이름 소리의 기운): ${eumryeongList.join(' ')}
적합도 점수: ${scoreVal}점 (${scoreLabel(scoreVal)})

[작성 형식]
아래 4개 문단으로 구성하세요. 문단 제목은 붙이지 말고 자연스러운 문장으로만 쓰세요. 문단 사이는 반드시 빈 줄 하나로 구분하세요. 각 문단은 3~4문장으로 작성합니다.

문단 1 — 이름의 기운: 이름 한자 각각의 뜻과 소리가 어우러져 만들어내는 전체적인 기운과 이미지를 설명하세요.

문단 2 — 사주 특성: 이 아이의 사주팔자에서 드러나는 타고난 기질과 강점, 오행 분포가 보여주는 성격적 특성을 서술하세요.

문단 3 — 이름과 사주의 조화: 용신(${yongsin})을 기준으로 이름이 사주의 부족한 기운을 어떻게 채워주는지, 또는 보완 방향을 설명하세요.

문단 4 — 부모의 마음과 덕담: 이 이름이 아이의 삶에서 어떤 빛이 될지, 이름에 담긴 소망과 기운이 앞날에 어떻게 펼쳐질지를 서술하세요. 단, 아래 표현은 절대 사용하지 마세요.
- 아이 이름을 직접 부르는 문장 (예: "승윤아,", "지우야,")
- "부모님께서는 네가..." 또는 "부모님은 네가..." 형식의 문장
- 아이에게 직접 말하는 2인칭 문체 ("너는", "네가", "너의")
3인칭 또는 서술형으로만 작성하세요.`;

  try {
    const stream = await client.chat.completions.create({
      model: 'anthropic/claude-haiku-4-5',
      messages: [{ role: 'user', content: llmPrompt }],
      temperature: 0.75,
      max_tokens: 1200,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content ?? '';
      if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (llmErr) {
    console.warn(`[saju/narrative] LLM 실패: ${llmErr.message}`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── POST /api/hanja/alternatives ─────────────────────────────
app.post('/api/hanja/alternatives', async (req, res) => {
  const {
    name, current_hanja = '',
    saju_yongsin, gender = '남아',
    is_premium = false,
    elements = null, hour_known = true,
    last_name = '',
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
      console.log(`[hanja-alt] 음절 매칭 실패: ${syllables.map((s,i) => s+'='+candidatesBySyllable[i].length+'건').join(', ')}`);
      return res.json({ base_name: name, alternatives: [] });
    }
    console.log(`[hanja-alt] 이름="${name}" 성="${last_name}" 용신="${saju_yongsin}" 후보=${candidatesBySyllable.map(a=>a.length).join('×')}=${candidatesBySyllable.reduce((s,a)=>s*a.length,1)}조합`);

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
      console.log(`[hanja-alt] scored 빈 배열 (current_hanja="${current_hanja}"가 유일한 조합?)`);
      return res.json({ base_name: name, alternatives: [] });
    }

    // 6. 상위 15개 후보 LLM 평가
    const TOP_N = 15;
    const topCandidates = scored.slice(0, TOP_N);
    const model = 'google/gemini-2.5-flash';

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
- meaning_score: 이름으로서 의미의 자연스러움 (0~30점)
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
          score:             calcUnifiedScore({
            lastNameKo: last_name,
            givenHanja: cand.hanjaStr,
            givenNameKo: name,
            yongsin: saju_yongsin,
            elements,
            hour_known,
          }),
          is_recommended:    false,
          elements_jawon:    cand.jawon,
          elements_eumryeong: eumryeongList,
          meaning:           item.meaning || '—',
          explanation:       item.explanation || '',
          category:          cand.jawon.includes(saju_yongsin) ? 'saju_match' : (item.category || 'meaning'),
        };
      })
      .sort((a, b) => b.score - a.score);

    if (alternatives.length > 0) {
      // 기준 점수 계산
      const baseScore = calcUnifiedScore({
        lastNameKo: last_name,
        givenHanja: current_hanja,
        givenNameKo: name,
        yongsin: saju_yongsin,
        elements,
        hour_known,
      });
      // 기준보다 높은 경우에만 추천 표시, 동점 모두 표시
      const topScore = alternatives[0].score;
      if (topScore > baseScore) {
        alternatives.forEach(alt => {
          if (alt.score === topScore) alt.is_recommended = true;
        });
      }
    } else {
      console.log(`[hanja-alt] LLM 필터링 후 0건: llmItems=${llmItems.length} candByHanja keys=[${Object.keys(candByHanja).slice(0,5).join(',')}] llm hanja=[${llmItems.map(i=>i.hanja).join(',')}]`);
    }

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
  const hun = loadHanjaHun();
  return chars.map(c => {
    const meaning = hun[c.char] || (c.meaning || '').split(',')[0].trim();
    const sound   = c.sound || '';
    const strokes = c.strokes || '?';
    // 수직: 뜻(훈) → 공백 → 음 → 획수 순서 (top→bottom)
    return `
      <div class="name-char-row">
        <div class="ann-left">${meaning}　${sound}<span class="ann-strokes-h">(${strokes})</span></div>
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

// 덕담 고정 8개 (LLM 생성 불필요)
const FIXED_DEOKDAM = [
  { hanja: '富家成長', ko: '부가성장' }, { hanja: '父祖有德', ko: '부조유덕' },
  { hanja: '人格出衆', ko: '인격출중' }, { hanja: '明哲人物', ko: '명철인물' },
  { hanja: '專門才能', ko: '전문재능' }, { hanja: '博士得名', ko: '박사득명' },
  { hanja: '健康長壽', ko: '건강장수' }, { hanja: '良配貴子', ko: '양배귀자' },
];

// 페이지2 HTML 생성 (embedFont=false 이면 URL 사용, 브라우저 캐시 활용)
function buildPage2Html(data, { embedFont = true } = {}) {
  const {
    full_name_hanja  = '',
    full_name_korean = '',
    birth_date       = '',
    birth_hour       = null,
    gender           = '',
    is_premium       = false,
  } = data;

  // 성/이름 분리: frontend는 이름(given) 한자만 보내므로 성은 SURNAME_MAP으로 조회
  const lastNameKo = full_name_korean[0] || '';
  const lastHanja  = SURNAME_MAP[lastNameKo] || full_name_hanja[0] || '';
  const givenHanja = full_name_hanja; // frontend sends given name hanja only

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
  const charData = suri
    ? suri.chars
    : [lastHanja, ...[...givenHanja]].map(c => ({ char: c, strokes: 0, yang_eum: '?' }));
  const lastCharData  = charData[0] || { char: lastHanja, strokes: 0, yang_eum: '?' };
  const hanjaDB    = loadHanjaDB();
  const metaExt    = loadHanjaMetaExt();
  const uniSound   = loadHanjaSound();
  const hun        = loadHanjaHun();
  const lastSound  = hanjaDB[lastHanja]?.sound  || metaExt[lastHanja]?.sound  || uniSound[lastHanja] || lastHanja;
  const lastHun    = hun[lastHanja] || (hanjaDB[lastHanja]?.meaning || metaExt[lastHanja]?.meaning || '').split(',')[0].trim();
  const givenCharData = charData.slice(1).map(c => ({
    ...c,
    sound:   hanjaDB[c.char]?.sound   || metaExt[c.char]?.sound   || uniSound[c.char] || c.char,
    meaning: hanjaDB[c.char]?.meaning || metaExt[c.char]?.meaning || '',
  }));

  // 사주팔자 재계산
  const sajuResult = (y > 0) ? calculateSaju({ year: y, month: mo, day: d, hour: h }) : null;
  const pillars = sajuResult ? [
    { header: '년주', cheon: sajuResult.palja.year.cheon,  cheon_ko: getHanKoreanReading(sajuResult.palja.year.cheon),  ji: sajuResult.palja.year.ji,  ji_ko: getHanKoreanReading(sajuResult.palja.year.ji)  },
    { header: '월주', cheon: sajuResult.palja.month.cheon, cheon_ko: getHanKoreanReading(sajuResult.palja.month.cheon), ji: sajuResult.palja.month.ji, ji_ko: getHanKoreanReading(sajuResult.palja.month.ji) },
    { header: '일주', cheon: sajuResult.palja.day.cheon,   cheon_ko: getHanKoreanReading(sajuResult.palja.day.cheon),   ji: sajuResult.palja.day.ji,   ji_ko: getHanKoreanReading(sajuResult.palja.day.ji)   },
    { header: '시주', cheon: sajuResult.palja.hour?.cheon || '', cheon_ko: getHanKoreanReading(sajuResult.palja.hour?.cheon || ''), ji: sajuResult.palja.hour?.ji || '', ji_ko: getHanKoreanReading(sajuResult.palja.hour?.ji || '') },
  ] : [];

  const deokdamItems = FIXED_DEOKDAM;

  // 템플릿 치환
  let html = readFileSync(path.join(__dirname, 'templates', 'certificate-page2.html'), 'utf-8');
  if (embedFont) {
    // Puppeteer/스크린샷 환경: data URI 인라인 (URL 로딩 불가)
    const fontB64 = loadHanyangFontB64();
    html = html.replace(
      /src:\s*url\('[^']*UNI_HSR[^']*'\)\s*format\('woff2'\)[^;]*;/,
      `src: url('data:font/woff2;base64,${fontB64}') format('woff2');`
    );
  }
  // embedFont=false 이면 템플릿 원본 URL (/fonts/UNI_HSR_subset.woff2) 그대로 사용
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
    '{{last_name_strokes}}':   String(lastCharData.strokes || '?'),
    '{{last_name_yang_eum}}':  lastCharData.yang_eum,
    '{{last_name_hun}}':       lastHun,
    '{{last_name_sound}}':     lastSound,
    '{{name_ko}}':             full_name_korean,
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
// 감정서 PDF (page1만)
async function buildCertificatePdf(data) {
  const html = buildPage1Html(data);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(html, { waitUntil: 'networkidle0', baseURL: templatesBase });
  await page.evaluate(async () => { await document.fonts.ready; });
  const pdfRaw = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await page.close();
  await releaseBrowser(browser);
  return Buffer.from(pdfRaw);
}

// 감정서 + 증명서 합본 PDF (page1 + page2)
async function buildCertificateFullPdf(data) {
  const html1 = buildPage1Html(data);
  const html2 = buildPage2Html(data);

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
  <div class="pdf-page" style="background:#fff;">${p2.bodyContent}</div>
</body>
</html>`;

  const browser = await launchBrowser();
  const page = await browser.newPage();
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(combined, { waitUntil: 'networkidle0', baseURL: templatesBase });
  await page.evaluate(async () => { await document.fonts.ready; });
  const pdfRaw = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await page.close();
  await releaseBrowser(browser);
  return Buffer.from(pdfRaw);
}

// ── POST /api/certificate/preview-page2 → token 발급 ─────────
const _previewTokens = new Map(); // token → html (TTL 5분)

app.post('/api/certificate/preview-page2', (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ detail: 'data 필드가 필요합니다.' });
  try {
    const html  = buildPage2Html(data, { embedFont: false });
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    _previewTokens.set(token, html);
    setTimeout(() => _previewTokens.delete(token), 5 * 60 * 1000);
    return res.json({ token });
  } catch (err) {
    console.error('[cert-preview] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
});

// ── GET /api/certificate/preview-page2/:token ─────────────────
app.get('/api/certificate/preview-page2/:token', (req, res) => {
  const html = _previewTokens.get(req.params.token);
  if (!html) return res.status(404).send('미리보기가 만료됐습니다.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.send(html);
});

// 감정서 JPG 생성 (page1만, 고해상도)
async function buildCertificateJpg(data) {
  // full page1 HTML을 그대로 사용 — extractPageContent 래퍼 방식은 이중 패딩 버그 유발
  const html = buildPage1Html(data);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(html, { waitUntil: 'networkidle0', baseURL: templatesBase });
  await page.evaluate(async () => { await document.fonts.ready; });

  // 실제 렌더 높이 측정 후 viewport 재설정 (내용이 1123px를 넘어도 잘리지 않게)
  const renderHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const captureHeight = Math.max(renderHeight, 1123);
  if (captureHeight > 1123) {
    await page.setViewport({ width: 794, height: captureHeight, deviceScaleFactor: 2 });
  }

  const jpgBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 95,
    clip: { x: 0, y: 0, width: 794, height: captureHeight },
  });
  await page.close();
  await releaseBrowser(browser);
  return Buffer.from(jpgBuffer);
}

app.post('/api/certificate/generate-jpg', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ detail: 'data 필드가 필요합니다.' });

  try {
    const jpgBuffer = await buildCertificateJpg(data);
    const safeKo = (data.full_name_korean || '').replace(/\s/g, '');
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename*=UTF-8''%EC%9E%91%EB%AA%85%EA%B0%90%EC%A0%95%EC%84%9C_${encodeURIComponent(safeKo)}.jpg`,
      'Content-Length': jpgBuffer.length,
    });
    return res.send(jpgBuffer);
  } catch (err) {
    console.error('[cert-jpg] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
});

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

// 작명증 JPG 생성 (page2만)
async function buildCert2Jpg(data) {
  const html = buildPage2Html(data);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(html, { waitUntil: 'networkidle0', baseURL: templatesBase });
  await page.evaluate(async () => { await document.fonts.ready; });
  const renderHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const captureHeight = Math.max(renderHeight, 1123);
  if (captureHeight > 1123) {
    await page.setViewport({ width: 794, height: captureHeight, deviceScaleFactor: 2 });
  }
  const jpgBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 95,
    clip: { x: 0, y: 0, width: 794, height: captureHeight },
  });
  await page.close();
  await releaseBrowser(browser);
  return Buffer.from(jpgBuffer);
}

// 작명증 PDF 생성 (page2만)
async function buildCert2Pdf(data) {
  const html = buildPage2Html(data);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const templatesBase = 'file:///' + path.join(__dirname, 'templates').replace(/\\/g, '/') + '/';
  await page.setContent(html, { waitUntil: 'networkidle0', baseURL: templatesBase });
  await page.evaluate(async () => { await document.fonts.ready; });
  const pdfRaw = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await page.close();
  await releaseBrowser(browser);
  return Buffer.from(pdfRaw);
}

app.post('/api/certificate/generate-cert2-jpg', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ detail: 'data 필드가 필요합니다.' });
  try {
    const jpgBuffer = await buildCert2Jpg(data);
    const safeKo = (data.full_name_korean || '').replace(/\s/g, '');
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename*=UTF-8''%EC%9E%91%EB%AA%85%EC%A6%9D_${encodeURIComponent(safeKo)}.jpg`,
      'Content-Length': jpgBuffer.length,
    });
    return res.send(jpgBuffer);
  } catch (err) {
    console.error('[cert2-jpg] 오류:', err.message);
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/certificate/generate-cert2', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ detail: 'data 필드가 필요합니다.' });
  try {
    const pdfBuffer = await buildCert2Pdf(data);
    const safeKo = (data.full_name_korean || '').replace(/\s/g, '');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''%EC%9E%91%EB%AA%85%EC%A6%9D_${encodeURIComponent(safeKo)}.pdf`,
      'Content-Length': pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[cert2-pdf] 오류:', err.message);
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

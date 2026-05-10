import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
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
  'openai/gpt-4o-mini',      // 메인 (빠름)
  'google/gemini-2.5-flash', // 폴백
  'openai/gpt-4o',           // 최후 폴백
];

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── 유틸 ──────────────────────────────────────────────────────

function extractJson(text) {
  // 1. <think>...</think> 제거
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // 2. 마크다운 코드블록 시도
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (_) {}
  }

  // 3. 직접 전체 파싱
  try { return JSON.parse(text); } catch (_) {}

  // 4. 괄호 깊이 추적으로 가장 바깥 JSON 배열 또는 객체를 정확히 추출
  const startIdx = text.search(/[\[{]/);
  if (startIdx !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = startIdx; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(startIdx, i + 1)); } catch (_) { break; }
        }
      }
    }
    // 5. 배열이 잘린 경우 닫는 괄호 보완
    const openChar = text[startIdx];
    const closeChar = openChar === '[' ? ']' : '}';
    try { return JSON.parse(text.slice(startIdx) + closeChar); } catch (_) {}
  }

  // 6. 최후 수단: name 필드가 있는 중첩 없는 객체들 추출
  const objs = [];
  const objRe = /\{(?:[^{}]|\{[^{}]*\})*"name"(?:[^{}]|\{[^{}]*\})*\}/g;
  let m;
  while ((m = objRe.exec(text)) !== null) {
    try { objs.push(JSON.parse(m[0])); } catch (_) {}
  }
  if (objs.length) return objs;

  console.error('[extractJson] 파싱 실패. raw text 앞 200자:', text.slice(0, 200));
  throw new Error('JSON 파싱 실패');
}

async function chat(prompt) {
  for (const model of MODELS) {
    try {
      console.log(`[chat] ${model}`);
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
      });
      const content = res.choices?.[0]?.message?.content;
      if (!content) throw new Error('응답 내용이 비어 있습니다.');
      return content.trim();
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      console.warn(`[chat] ${model} 실패 (${status ?? e.code})`);
      const retryable = status === 429 || status === 503 || status === 500
        || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET';
      if (!retryable) throw e;
    }
  }
  throw new Error('모든 모델이 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
}

const SYLLABLE_MAP = { '외자 이름': 1, '두자 이름': 2, '세자 이름': 3 };

function buildPrompt({ last_name, gender, syllables, criteria, sibling_names, impression, preferred_names, count, exclude }) {
  const syllableNums   = syllables.map(s => SYLLABLE_MAP[s]).filter(Boolean);
  const syllableStr    = syllableNums.length
    ? syllableNums.map(n => `${n}글자`).join(' 또는 ')
    : '2글자 또는 1글자';
  const criteriaStr    = criteria.length ? criteria.map(c => `- ${c}`).join('\n') : '- 없음';
  const siblingStr     = sibling_names.length ? sibling_names.join(', ') : '없음';
  const excludeStr     = exclude.length ? `\n\n이미 추천한 이름이므로 제외: ${exclude.join(', ')}` : '';
  const impressions    = Array.isArray(impression) ? impression : (impression ? [impression] : []);
  const impressionStr  = impressions.length ? impressions.join(', ') : '제한 없음';
  const preferred      = Array.isArray(preferred_names) ? preferred_names : [];
  const preferredStr   = preferred.length ? preferred.join(', ') : '없음';

  return `당신은 한국 아기 이름 전문가입니다.

[요청 조건]
- 성: ${last_name}
- 성별: ${gender}
- 이름 글자 수: 반드시 ${syllableStr}인 이름만 추천 (성 제외, 이 규칙은 절대 어기지 마세요)
- 이름 인상: ${impressionStr}
- 선호 이름 (참고용): ${preferredStr}${preferredStr !== '없음' ? ' — 이 이름들과 비슷한 느낌·음감·스타일의 이름을 추천해 주세요' : ''}
- 형제 이름: ${siblingStr}
- 선택한 기준:
${criteriaStr}${excludeStr}

위 조건에 맞는 한국 아기 이름 ${count}개를 추천해 주세요.
아래 형식으로 한 줄에 하나씩 JSON 객체를 반환하세요. 다른 텍스트는 절대 쓰지 마세요.

{"name":"한글이름","hanja":"한자","meaning":"이름 뜻(1~2문장)","reason":"이유(1문장)"}

규칙:
- name 글자 수는 반드시 ${syllableStr}
- 중복 없이 다양한 느낌으로 ${count}개
- 반드시 한 줄에 완전한 JSON 객체 하나만, 배열 없이`;
}

function filterBySyllables(names, syllables) {
  if (!syllables.length) return names;
  const allowed = new Set(syllables.map(s => SYLLABLE_MAP[s]).filter(Boolean));
  if (!allowed.size) return names;
  return names.filter(n => allowed.has([...n.name].length));
}

// ── POST /api/generate ─────────────────────────────────────────
// 5개씩 배치로 나눠 호출. 프론트가 /api/generate를 여러 번 호출.

app.post('/api/generate', async (req, res) => {
  const {
    last_name, gender,
    syllables = [], criteria = [], sibling_names = [],
    impression = [],
    preferred_names = [],
    count = 5,
    exclude = [],
  } = req.body;

  if (!last_name || typeof last_name !== 'string') return res.status(400).json({ detail: '성(姓)을 입력해주세요.' });
  if (!/^[가-힣a-zA-Z]{1,5}$/.test(last_name)) return res.status(400).json({ detail: '성(姓)은 한글/영문 1~5자만 허용됩니다.' });
  if (!gender || typeof gender !== 'string') return res.status(400).json({ detail: '성별을 선택해주세요.' });
  const clampedCount = Math.min(30, Math.max(1, Number(count) || 10));

  const prompt = buildPrompt({ last_name, gender, syllables, criteria, sibling_names, impression, preferred_names, count: clampedCount, exclude });
  const allowed = new Set(syllables.map(s => SYLLABLE_MAP[s]).filter(Boolean));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const model of MODELS) {
    try {
      console.log(`[generate/stream] ${model}`);
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        stream: true,
      });

      let buf = '';
      for await (const chunk of stream) {
        buf += chunk.choices?.[0]?.delta?.content ?? '';
        // think 태그 제거
        buf = buf.replace(/<think>[\s\S]*?<\/think>/g, '');
        // 완성된 줄 처리
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('{')) continue;
          try {
            const obj = JSON.parse(t);
            if (!obj.name) continue;
            if (allowed.size && !allowed.has([...obj.name].length)) continue;
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
          } catch (_) {}
        }
      }
      // 남은 버퍼 처리
      const t = buf.trim();
      if (t.startsWith('{')) {
        try {
          const obj = JSON.parse(t);
          if (obj.name && (!allowed.size || allowed.has([...obj.name].length))) {
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
          }
        } catch (_) {}
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      console.warn(`[generate/stream] ${model} 실패 (${status ?? e.code})`);
      const retryable = status === 429 || status === 503 || status === 500
        || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET';
      if (!retryable) break;
    }
  }

  res.write('data: {"error":"모든 모델이 응답하지 않습니다. 잠시 후 다시 시도해주세요."}\n\n');
  res.end();
});

// ── POST /api/worldcup/rarity ──────────────────────────────────

function calcRarity(pop) {
  if (pop >= 50000) return '매우 흔함';
  if (pop >= 10000) return '흔한 편';
  if (pop >= 2000)  return '보통';
  if (pop >= 200)   return '희귀';
  return '매우 희귀';
}

async function fetchKoreannameRarity(name, gender) {
  const url = `https://koreanname.me/api/name/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://koreanname.me/',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`koreanname.me ${res.status}`);
  const data = await res.json();

  const rank = data.rank;
  if (!rank || typeof rank.count !== 'number') throw new Error('데이터 없음');

  const pop = gender === '여아' ? (rank.female?.count ?? rank.count)
            : gender === '남아' ? (rank.male?.count  ?? rank.count)
            : rank.count;

  // 가장 최근 데이터가 있는 연도 추출
  const years = (data.year || []).filter(y => y.count > 0);
  const latestYear = years.length ? years[years.length - 1].year : null;

  return { estimated_population: pop, rarity: calcRarity(pop), data_year: latestYear, source: 'koreanname.me' };
}

app.post('/api/worldcup/rarity', async (req, res) => {
  const { name, gender } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ detail: '이름을 입력해주세요.' });
  if (!gender || typeof gender !== 'string') return res.status(400).json({ detail: '성별을 선택해주세요.' });

  // 1차: koreanname.me 실제 데이터
  try {
    const result = await fetchKoreannameRarity(name, gender);
    console.log(`[rarity] koreanname.me 성공: ${name} ${result.estimated_population}명`);
    return res.json(result);
  } catch (e) {
    console.warn(`[rarity] koreanname.me 실패 (${e.message}), AI 폴백`);
  }

  // 2차 폴백: AI 추정
  const prompt = `한국 이름 "${name}"(${gender})의 사용 인구를 추정해 주세요.
가장 최신 통계청 데이터를 참고하여 추정하세요.

반드시 아래 JSON만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.

{
  "estimated_population": 숫자(정수),
  "data_year": 참고한 통계청 데이터 연도(정수, 예: 2023)
}`;

  try {
    const raw = await chat(prompt);
    const data = extractJson(raw);
    const pop = Number(data.estimated_population) || 0;
    return res.json({
      estimated_population: pop,
      rarity: calcRarity(pop),
      data_year: data.data_year || null,
      source: 'ai',
    });
  } catch (e) {
    console.error('rarity error:', e.message);
    res.status(500).json({ detail: '희귀도 조회 중 오류가 발생했습니다.' });
  }
});

// ── POST /api/tts ──────────────────────────────────────────────

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') return res.status(400).json({ detail: 'text required' });

  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) return res.status(503).json({ detail: 'no_key' });

  try {
    const r = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.88, pitch: 1.5 },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'TTS error'); }
    const { audioContent } = await r.json();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(audioContent, 'base64'));
  } catch (e) {
    console.error('[tts]', e.message);
    res.status(500).json({ detail: e.message });
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

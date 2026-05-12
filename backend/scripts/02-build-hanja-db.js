// ─────────────────────────────────────────────────────────
// 02-build-hanja-db.js
// 고유 한자 메타데이터를 LLM(gpt-4o-mini)으로 일괄 생성
//
// 출력: backend/data/hanja_db.json
//   {
//     "智": {
//       "char": "智",
//       "sound": "지",
//       "radical": "日",
//       "strokes": 12,
//       "ohaeng_won": "火",
//       "meaning": "지혜",
//       "name_usage": "지혜롭고 명민한 인격을 상징"
//     },
//     ...
//   }
//
// 특징:
//  - Resume 지원: 이미 처리된 한자는 건너뜀
//  - 배치 단위 저장: 중간에 끊어져도 안전
//  - 환경변수: OPENROUTER_API_KEY 필요
//
// 사용법:
//   node scripts/02-build-hanja-db.js              # 전체 실행
//   node scripts/02-build-hanja-db.js --limit 30   # 시험 실행 (30자만)
// ─────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

if (!process.env.OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY 환경변수가 없습니다 (.env 확인)');
  process.exit(1);
}

const INPUT = path.join(__dirname, '..', 'data', 'unique_hanja.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'hanja_db.json');

const BATCH_SIZE = 15;
const MODEL = 'openai/gpt-4o-mini';
const DELAY_MS = 500; // 배치 사이 대기 (Rate limit 보호)

// CLI 인자 파싱
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1]) : null;
const FORCE = args.includes('--force'); // 기존 항목 포함 전체 재처리

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// ─── 데이터 로드 ───────────────────────────────────────
console.log('📂 입력 파일 로드...');
const inputData = JSON.parse(readFileSync(INPUT, 'utf-8'));
const allHanja = inputData.hanja;
console.log(`   고유 한자: ${allHanja.length}자`);

let hanjaDB = {};
if (existsSync(OUTPUT)) {
  const rawText = readFileSync(OUTPUT, 'utf-8').replace(/^﻿/, ''); // BOM 제거
  const raw = JSON.parse(rawText);
  // 중첩 형식 {meta, hanja:{...}} 도 지원
  hanjaDB = (raw && typeof raw.hanja === 'object' && !Array.isArray(raw.hanja))
    ? raw.hanja
    : raw;
  console.log(`   기존 DB: ${Object.keys(hanjaDB).length}자 (resume)`);
}

// 처리 대상 결정
let toProcess = FORCE ? allHanja : allHanja.filter(h => !hanjaDB[h]);
if (FORCE) console.log(`   ⚠ --force: 기존 항목 포함 전체 재처리`);
if (LIMIT) {
  toProcess = toProcess.slice(0, LIMIT);
  console.log(`   ⚠ 시험 모드: ${LIMIT}자만 처리`);
}
console.log(`   처리 대상: ${toProcess.length}자\n`);

if (toProcess.length === 0) {
  console.log('✅ 이미 모든 한자가 처리되었습니다.');
  process.exit(0);
}

// ─── 프롬프트 생성 ──────────────────────────────────────
function buildPrompt(chars) {
  return `다음 한자들의 작명용 메타데이터를 JSON으로 반환하세요.

한자 목록: ${chars.join(' ')}

각 한자 정보:
- char: 한자 1글자
- sound: 한국어 두음법칙 적용된 음 (예: 智→"지", 麗→"여" 또는 "려")
- radical: 부수 (예: 日, 水, 木)
- strokes: 정자 기준 총 획수 (정수)
- ohaeng_won: 자원오행 (반드시 "木" "火" "土" "金" "水" 중 하나)
- meaning: 기본 뜻 (한국어, 5~10자)
- name_usage: 이름에 사용될 때의 의미와 뉘앙스 (한국어, 1문장)

반환 형식 (JSON 객체):
{
  "items": [
    { "char": "智", "sound": "지", "radical": "日", "strokes": 12, "ohaeng_won": "火", "meaning": "지혜", "name_usage": "..." },
    ...
  ]
}

반드시 JSON만 반환하고, 다른 텍스트는 포함하지 마세요.`;
}

// ─── 배치 처리 ─────────────────────────────────────────
async function processBatch(chars, batchNum, totalBatches) {
  console.log(`\n📦 배치 ${batchNum}/${totalBatches} (${chars.length}자): ${chars.join(' ')}`);

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(chars) }],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.2,
    });

    const text = res.choices[0].message.content;
    const parsed = JSON.parse(text);
    const items = parsed.items || parsed.data || parsed.hanja || Object.values(parsed)[0];

    if (!Array.isArray(items)) {
      throw new Error('응답이 배열이 아닙니다');
    }

    let added = 0;
    for (const item of items) {
      if (item.char && chars.includes(item.char)) {
        // 자원오행 유효성 검사
        if (!['木', '火', '土', '金', '水'].includes(item.ohaeng_won)) {
          console.warn(`   ⚠ ${item.char}: 잘못된 자원오행 "${item.ohaeng_won}" → 木으로 임시 설정`);
          item.ohaeng_won = '木';
        }
        // 획수 유효성 검사
        if (!Number.isInteger(item.strokes) || item.strokes < 1 || item.strokes > 50) {
          console.warn(`   ⚠ ${item.char}: 잘못된 획수 "${item.strokes}" → 0으로 설정 (수동검수필요)`);
          item.strokes = 0;
        }
        hanjaDB[item.char] = item;
        added++;
      }
    }

    console.log(`   ✅ ${added}자 추가 (총 ${Object.keys(hanjaDB).length}자)`);

    // 매 배치마다 저장 (안전성)
    writeFileSync(OUTPUT, JSON.stringify(hanjaDB, null, 2), 'utf-8');

    return added;
  } catch (e) {
    console.error(`   ❌ 배치 실패: ${e.message}`);
    return 0;
  }
}

// ─── 메인 루프 ─────────────────────────────────────────
const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
let totalAdded = 0;
const startTime = Date.now();

for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
  const batch = toProcess.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const added = await processBatch(batch, batchNum, totalBatches);
  totalAdded += added;

  if (i + BATCH_SIZE < toProcess.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

// ─── 완료 보고 ─────────────────────────────────────────
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n${'='.repeat(50)}`);
console.log(`✅ 완료`);
console.log(`   추가된 한자: ${totalAdded}자`);
console.log(`   전체 DB 크기: ${Object.keys(hanjaDB).length}자`);
console.log(`   소요 시간: ${elapsed}초`);
console.log(`   저장 위치: ${OUTPUT}`);
console.log(`${'='.repeat(50)}`);

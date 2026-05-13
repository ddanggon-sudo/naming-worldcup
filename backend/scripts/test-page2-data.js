/**
 * test-page2-data.js — 프롬프트1 검증 스크립트
 * 실행: cd backend && node scripts/test-page2-data.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import {
  arabicToHan, monthToHan, dayToHan,
  hourToShi, getYearGapja, strokesToYangEum,
} from '../lib/han-utils.js';
import { calculateSuri } from '../lib/suri.js';
import { generateDeokdam } from '../lib/deokdam.js';

let pass = 0, fail = 0;

function check(label, got, expected) {
  const ok = got === expected;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(got)} ${ok ? '' : `(기대: ${JSON.stringify(expected)})`}`);
}

// ── han-utils 검증 ────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
console.log('🔢 arabicToHan');
console.log('─────────────────────────────────────────────');
check('arabicToHan(1)',    arabicToHan(1),    '一');
check('arabicToHan(10)',   arabicToHan(10),   '十');
check('arabicToHan(12)',   arabicToHan(12),   '十二');
check('arabicToHan(20)',   arabicToHan(20),   '二十');
check('arabicToHan(27)',   arabicToHan(27),   '二十七');
check('arabicToHan(31)',   arabicToHan(31),   '三十一');
check('arabicToHan(100)',  arabicToHan(100),  '一百');
check('arabicToHan(2026)', arabicToHan(2026), '二千二十六');

console.log('\n─────────────────────────────────────────────');
console.log('📅 monthToHan / dayToHan');
console.log('─────────────────────────────────────────────');
check('monthToHan(1)',  monthToHan(1),  '一月');
check('monthToHan(4)',  monthToHan(4),  '四月');
check('monthToHan(12)', monthToHan(12), '十二月');
check('dayToHan(1)',    dayToHan(1),    '一日');
check('dayToHan(27)',   dayToHan(27),   '二十七日');
check('dayToHan(31)',   dayToHan(31),   '三十一日');

console.log('\n─────────────────────────────────────────────');
console.log('⏰ hourToShi');
console.log('─────────────────────────────────────────────');
check('hourToShi(null)',      hourToShi(null),      '時不知');
check('hourToShi(undefined)', hourToShi(undefined), '時不知');
check('hourToShi(0)',  hourToShi(0),  '子時');
check('hourToShi(1)',  hourToShi(1),  '丑時');
check('hourToShi(4)',  hourToShi(4),  '寅時');
check('hourToShi(12)', hourToShi(12), '午時');
check('hourToShi(23)', hourToShi(23), '子時');

console.log('\n─────────────────────────────────────────────');
console.log('📆 getYearGapja');
console.log('─────────────────────────────────────────────');
check('getYearGapja(1984)', getYearGapja(1984), '甲子');
check('getYearGapja(2026)', getYearGapja(2026), '丙午');
check('getYearGapja(2025)', getYearGapja(2025), '乙巳');
check('getYearGapja(2000)', getYearGapja(2000), '庚辰');

console.log('\n─────────────────────────────────────────────');
console.log('☯️  strokesToYangEum');
console.log('─────────────────────────────────────────────');
check('strokesToYangEum(8)',  strokesToYangEum(8),  '음');
check('strokesToYangEum(7)',  strokesToYangEum(7),  '양');
check('strokesToYangEum(12)', strokesToYangEum(12), '음');
check('strokesToYangEum(9)',  strokesToYangEum(9),  '양');

// ── suri 검증 ──────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
console.log('🔢 calculateSuri("金", "智宇")');
console.log('─────────────────────────────────────────────');
const suri = calculateSuri('金', '智宇');
console.log('  글자 정보:');
suri.chars.forEach(c => console.log(`    ${c.char}: ${c.strokes}획 (${c.yang_eum})`));
console.log(`  천격(天格): ${suri.cheon_gyeok.num} → ${suri.cheon_gyeok.level} ${suri.cheon_gyeok.label}`);
console.log(`  인격(人格): ${suri.in_gyeok.num} → ${suri.in_gyeok.level} ${suri.in_gyeok.label}`);
console.log(`  지격(地格): ${suri.ji_gyeok.num} → ${suri.ji_gyeok.level} ${suri.ji_gyeok.label}`);
console.log(`  외격(外格): ${suri.oe_gyeok.num} → ${suri.oe_gyeok.level} ${suri.oe_gyeok.label}`);
console.log(`  총격(總格): ${suri.chong_gyeok.num} → ${suri.chong_gyeok.level} ${suri.chong_gyeok.label}`);

// 5격 값 기본 검증 (획수가 0이 아닌 경우)
const hasStrokes = suri.chars.every(c => c.strokes > 0);
if (hasStrokes) { pass++; console.log('  ✅ 모든 글자 획수 조회 성공'); }
else            { fail++; console.log('  ❌ 획수 0인 글자 있음 (hanja_db 미등록)'); }

// ── deokdam 검증 ───────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
console.log('📜 generateDeokdam (LLM 호출 — 약 5~10초 소요)');
console.log('─────────────────────────────────────────────');
try {
  const items = await generateDeokdam({
    name: '지우',
    hanja: '智宇',
    saju: {
      palja: {
        year:  { cheon: '丙', ji: '午' },
        month: { cheon: '壬', ji: '辰' },
        day:   { cheon: '辛', ji: '未' },
        hour:  { cheon: '甲', ji: '午' },
      },
    },
    gender: '남아',
    isPremium: false,
  });

  if (Array.isArray(items) && items.length === 8) {
    pass++;
    console.log('  ✅ 덕담 8개 생성 완료:');
    items.forEach((it, i) => console.log(`    ${i + 1}. ${it.hanja}/${it.ko}`));
  } else {
    fail++;
    console.log(`  ❌ 덕담 개수 오류: ${items?.length}개`);
    console.log('  원시 응답:', JSON.stringify(items));
  }
} catch (e) {
  fail++;
  console.log(`  ❌ LLM 호출 실패: ${e.message}`);
}

// ── 최종 결과 ──────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════');
console.log(`결과: ${pass}개 통과 / ${fail}개 실패`);
if (fail === 0) console.log('✅ test-page2-data.js 전체 통과');
else            console.log('❌ 일부 실패 — 위 로그 확인');
console.log('═════════════════════════════════════════════\n');

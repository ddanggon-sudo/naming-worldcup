/**
 * test-saju.js — saju.js 검증 스크립트
 * 실행: node scripts/test-saju.js
 */

import { calculateSaju, getElement } from '../lib/saju.js';

function printResult(label, result) {
  const { palja, elements, yongsin, yongsin_desc, hour_known } = result;
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`📋 ${label}`);
  console.log(`${'─'.repeat(52)}`);
  console.log('사주팔자:');
  console.log(`  년주: ${palja.year.cheon}${palja.year.ji}  (${getElement(palja.year.cheon)}${getElement(palja.year.ji)})`);
  console.log(`  월주: ${palja.month.cheon}${palja.month.ji}  (${getElement(palja.month.cheon)}${getElement(palja.month.ji)})`);
  console.log(`  일주: ${palja.day.cheon}${palja.day.ji}  (${getElement(palja.day.cheon)}${getElement(palja.day.ji)})`);
  if (palja.hour) {
    console.log(`  시주: ${palja.hour.cheon}${palja.hour.ji}  (${getElement(palja.hour.cheon)}${getElement(palja.hour.ji)})`);
  } else {
    console.log(`  시주: (시간 모름)`);
  }
  console.log(`오행: 木${elements['木']} 火${elements['火']} 土${elements['土']} 金${elements['金']} 水${elements['水']}`);
  console.log(`용신: ${yongsin}  |  시간 포함: ${hour_known}`);
  console.log(`설명: ${yongsin_desc}`);
}

// ── 테스트 케이스 ────────────────────────────────────────────────

// 1. 2026-08-15 04:30 (양력)
printResult(
  '2026-08-15 04:30 (양력)',
  calculateSaju({ year: 2026, month: 8, day: 15, hour: 4 })
);

// 2. 시간 없음 (hour=null)
printResult(
  '2026-08-15 시간 모름',
  calculateSaju({ year: 2026, month: 8, day: 15, hour: null })
);

// 3. 2000-01-01 12:00
printResult(
  '2000-01-01 12:00 (양력)',
  calculateSaju({ year: 2000, month: 1, day: 1, hour: 12 })
);

// 4. getElement 보조 함수 검증
console.log(`\n${'─'.repeat(52)}`);
console.log('🔍 getElement 검증');
console.log(`${'─'.repeat(52)}`);
const checks = [
  ['甲','木'],['丁','火'],['戊','土'],['辛','金'],['壬','水'],
  ['子','水'],['寅','木'],['午','火'],['申','金'],['辰','土'],
];
let pass = 0;
for (const [char, expected] of checks) {
  const got = getElement(char);
  const ok  = got === expected;
  if (ok) pass++;
  console.log(`  ${ok ? '✅' : '❌'} getElement('${char}') = ${got}  (기대: ${expected})`);
}
console.log(`\n결과: ${pass}/${checks.length} 통과`);

console.log('\n✅ test-saju.js 완료\n');

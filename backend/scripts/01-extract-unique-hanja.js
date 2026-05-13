// ─────────────────────────────────────────────────────────
// 01-extract-unique-hanja.js
// names_db.json에서 실제 사용되는 고유 한자를 모두 추출
// 출력: backend/data/unique_hanja.json
// ─────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAMES_DB_PATH = path.join(__dirname, '..', 'data', 'names_db.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'unique_hanja.json');

console.log('📂 names_db.json 로드 중...');
const raw = JSON.parse(readFileSync(NAMES_DB_PATH, 'utf-8'));
const names = raw.names || [];
console.log(`   ✅ 이름 ${names.length}개 로드`);

// 한자 1글자만 골라내기 (CJK Unified Ideographs 범위)
const isHanja = (ch) => /[一-鿿]/.test(ch);

const hanjaCounter = new Map(); // 한자 → 사용 빈도

for (const n of names) {
  if (!n.hanja) continue;
  for (const ch of n.hanja) {
    if (!isHanja(ch)) continue;
    hanjaCounter.set(ch, (hanjaCounter.get(ch) || 0) + 1);
  }
}

// 사용 빈도 높은 순으로 정렬
const sorted = [...hanjaCounter.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([char, count]) => ({ char, count }));

console.log(`\n📊 고유 한자 ${sorted.length}자 추출 완료\n`);

// 상위 20자 미리보기
console.log('🔝 가장 많이 쓰인 한자 TOP 20:');
sorted.slice(0, 20).forEach((it, i) => {
  console.log(`   ${(i + 1).toString().padStart(2, ' ')}. ${it.char}  (${it.count}회)`);
});

// 저장
const output = {
  meta: {
    source: 'names_db.json',
    total_names: names.length,
    unique_hanja_count: sorted.length,
    extracted_at: new Date().toISOString(),
  },
  hanja: sorted.map(s => s.char), // 빈도순 한자 배열
  with_count: sorted, // 빈도 정보 포함
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
console.log(`\n💾 저장 완료: ${OUTPUT_PATH}`);
console.log(`   총 ${sorted.length}자`);

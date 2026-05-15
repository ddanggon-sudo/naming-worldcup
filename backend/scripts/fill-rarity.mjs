/**
 * 1회성 마이그레이션: ddanggon@gmail.com의 naming_list 중
 * rarity가 null인 항목에 희귀도를 채워넣습니다.
 *
 * 실행: node backend/scripts/fill-rarity.mjs <SERVICE_ROLE_KEY>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://lsrlwmwtxaggmcahdhez.supabase.co';
const TARGET_EMAIL = 'ddanggon@gmail.com';

const SERVICE_ROLE_KEY = process.argv[2];
if (!SERVICE_ROLE_KEY) {
  console.error('사용법: node backend/scripts/fill-rarity.mjs <SERVICE_ROLE_KEY>');
  process.exit(1);
}

// ── 로컬 names_db.json 로드 ──────────────────────────────
const _namesDB = (() => {
  const dataPath = path.join(__dirname, '..', 'data', 'names_db.json');
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  return Array.isArray(raw) ? raw : (raw.names || []);
})();

const TIER_TO_RARITY = {
  '🔥매우인기': '매우 흔함',
  '⭐인기':    '흔한 편',
  '✨적당':    '보통',
  '💎개성':   '희귀',
  '🌙희귀':   '매우 희귀',
};

function lookupRarity(name, gender) {
  const found = _namesDB.find(n => n.name === name && n.gender === gender);
  if (found) {
    return {
      rarity: TIER_TO_RARITY[found.tier] || '보통',
      estimated_population: found.count,
      data_year: null,
    };
  }
  return { rarity: '매우 희귀', estimated_population: null, data_year: null };
}

// ── Supabase REST 헬퍼 ────────────────────────────────────
async function sb(path, opts = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.method && opts.method !== 'GET') headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── 관리자 API로 이메일 → user_id 조회 ───────────────────
async function findUserIdByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Auth admin API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const user = data.users?.find(u => u.email === email);
  if (!user) throw new Error(`${email} 사용자를 찾을 수 없습니다.`);
  return user.id;
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  console.log(`[1/4] ${TARGET_EMAIL} user_id 조회 중...`);
  const userId = await findUserIdByEmail(TARGET_EMAIL);
  console.log(`      user_id: ${userId}`);

  console.log('[2/4] profiles에서 family_id 조회 중...');
  const profiles = await sb(`/profiles?id=eq.${userId}&select=family_id`);
  const familyId = profiles?.[0]?.family_id;
  if (!familyId) throw new Error('family_id를 찾을 수 없습니다.');
  console.log(`      family_id: ${familyId}`);

  console.log('[3/4] rarity가 null인 naming_list 항목 조회 중...');
  const rows = await sb(`/naming_list?family_id=eq.${familyId}&rarity=is.null&select=id,name,gender`);
  console.log(`      대상 ${rows.length}건`);
  if (rows.length === 0) { console.log('처리할 항목이 없습니다.'); return; }

  console.log('[4/4] 희귀도 채워넣기...');
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      const r = lookupRarity(row.name, row.gender);
      await sb(`/naming_list?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          rarity: r.rarity,
          estimated_population: r.estimated_population,
          data_year: r.data_year,
        }),
      });
      console.log(`  ✓ ${row.name}(${row.gender}) → ${r.rarity} / ${r.estimated_population ?? '20명 미만'}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${row.name}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n완료: 성공 ${ok}건 / 실패 ${fail}건`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

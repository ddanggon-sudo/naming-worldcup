import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf-8').split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map(s => s.trim()))
);

const SUPABASE_URL = 'https://lsrlwmwtxaggmcahdhez.supabase.co';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

const TARGET_USER_ID = '2840ff4a-e32c-49b3-893a-785154284f92';
const TARGET_FAMILY_ID = 'fbc58abd-e7f5-42fd-b2c2-9acdea6b393a';
const INVITE_CODE = 'DDANGGON';

async function main() {
  console.log('=== DB 마이그레이션 시작 ===\n');

  // 1. families 테이블에 family 생성 (upsert)
  console.log(`1. families 테이블에 family 생성 (id=${TARGET_FAMILY_ID})`);
  const family = await sb('/families', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ id: TARGET_FAMILY_ID, invite_code: INVITE_CODE }),
  }).catch(async (e) => {
    // 이미 존재하는 경우(23505) 기존 것 조회
    if (e.message.includes('23505') || e.message.includes('duplicate')) {
      console.log('  → 이미 존재, 기존 family 사용');
      return sb(`/families?id=eq.${TARGET_FAMILY_ID}`);
    }
    throw e;
  });
  console.log('  → family:', JSON.stringify(family));

  // 2. profiles 테이블에 profile 생성 (upsert)
  console.log(`\n2. profiles 테이블에 profile 생성 (user=${TARGET_USER_ID})`);
  const profile = await sb('/profiles', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ id: TARGET_USER_ID, family_id: TARGET_FAMILY_ID, role: '아빠' }),
  }).catch(async (e) => {
    // 이미 존재하는 경우 update
    if (e.message.includes('23505') || e.message.includes('duplicate')) {
      console.log('  → 이미 존재, family_id/role 업데이트');
      return sb(`/profiles?id=eq.${TARGET_USER_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ family_id: TARGET_FAMILY_ID, role: '아빠' }),
      });
    }
    throw e;
  });
  console.log('  → profile:', JSON.stringify(profile));

  // 3. family_id가 null인 naming_list 항목 수정
  console.log('\n3. family_id=null 인 naming_list 항목 수정');
  const nullFixed = await sb(`/naming_list?family_id=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ family_id: TARGET_FAMILY_ID }),
  });
  console.log('  → 수정된 항목:', JSON.stringify(nullFixed));

  // 4. 다른 family_id(9e7c8a4e-...)인 naming_list 항목도 이동
  const OTHER_FAMILY_ID = '9e7c8a4e-0526-4307-8208-d2d37a7c3dec';
  console.log(`\n4. family_id=${OTHER_FAMILY_ID} 인 naming_list 항목 이동`);
  const otherFixed = await sb(`/naming_list?family_id=eq.${OTHER_FAMILY_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ family_id: TARGET_FAMILY_ID }),
  });
  console.log('  → 수정된 항목:', JSON.stringify(otherFixed));

  // 5. 최종 확인
  console.log('\n5. 최종 확인');
  const finalNames = await sb('/naming_list?select=family_id&limit=1000');
  const byFamily = {};
  for (const n of finalNames) {
    const k = n.family_id || 'NULL';
    byFamily[k] = (byFamily[k] || 0) + 1;
  }
  console.log('  naming_list family_id별 개수:', byFamily);

  const finalProfile = await sb(`/profiles?id=eq.${TARGET_USER_ID}`);
  console.log('  profile:', JSON.stringify(finalProfile));

  const finalFamily = await sb(`/families?id=eq.${TARGET_FAMILY_ID}`);
  console.log('  family:', JSON.stringify(finalFamily));

  console.log('\n=== 마이그레이션 완료 ===');
}

main().catch(console.error);

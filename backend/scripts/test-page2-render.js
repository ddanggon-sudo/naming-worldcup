/**
 * test-page2-render.js — certificate-page2.html 렌더 확인
 * 실행: cd backend && node scripts/test-page2-render.js
 * 결과: backend/test-output/page2-preview.html 생성 후 브라우저로 열기
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── 더미 데이터 ────────────────────────────────────────────────

const dummy = {
  cert_title:       '作名證',
  birth_year_gapja: '丙午',
  birth_year_ko:    '병오년',
  birth_month_han:  '四月',
  birth_month_ko:   '사월',
  birth_day_han:    '二十七日',
  birth_day_ko:     '이십칠일',
  birth_shi_han:    '寅時',
  birth_hour_ko:    '인시',
  birth_info_ko:    '병오년 양력 4월 27일 인시 탄생',

  last_name_hanja:  '金',
  last_name_strokes: 8,
  last_name_yang_eum: '음',
  given_name_chars: [
    { char: '智', strokes: 12, yang_eum: '음' },
    { char: '宇', strokes: 6,  yang_eum: '음' },
  ],
  name_ko: '김지우',

  palja: [
    // 표시 순서: 년주 → 월주 → 일주 → 시주 (왼→오)
    { header: '년주', cheon: '丙', cheon_ko: '병', ji: '午', ji_ko: '오' },
    { header: '월주', cheon: '壬', cheon_ko: '임', ji: '辰', ji_ko: '진' },
    { header: '일주', cheon: '辛', cheon_ko: '신', ji: '未', ji_ko: '미' },
    { header: '시주', cheon: '甲', cheon_ko: '갑', ji: '午', ji_ko: '오' },
  ],

  deokdam_items: [
    { hanja: '父祖有德', ko: '부조유덕' },
    { hanja: '明哲人物', ko: '명철인물' },
    { hanja: '博士得名', ko: '박사득명' },
    { hanja: '富家成長', ko: '부가성장' },
    { hanja: '人格出衆', ko: '인격출중' },
    { hanja: '良配貴子', ko: '양배귀자' },
    { hanja: '健康長壽', ko: '건강장수' },
    { hanja: '專門才能', ko: '전문재능' },
  ],

  office_name: '픽마이네임 작명연구소',
  seal_char:   '印',
};

// ── HTML 블록 렌더링 ───────────────────────────────────────────

function renderGivenNameChars(chars) {
  return chars.map(c => `
      <div class="name-char-row">
        <div class="stroke-aside">(${c.strokes})</div>
        <span class="name-han-big">${c.char}</span>
      </div>`).join('\n');
}

function renderDeokdam(items) {
  return items.map(it => `
      <div class="deokdam-row">
        <span class="dd-ko-side">${it.ko}</span>
        <span class="dd-han-vert">${it.hanja}</span>
      </div>`).join('\n');
}

function renderPalja(pillars) {
  return pillars.map(p => {
    const cheon = p.cheon
      ? `<div class="p-unit"><div class="p-ko">${p.cheon_ko || ''}</div><div class="p-han">${p.cheon}</div></div>`
      : `<div class="p-empty">　</div>`;
    const ji = p.ji
      ? `<div class="p-unit"><div class="p-ko">${p.ji_ko || ''}</div><div class="p-han">${p.ji}</div></div>`
      : `<div class="p-empty">　</div>`;
    return `<div class="pillar-block"><div class="pillar-header">${p.header}</div>${cheon}${ji}</div>`;
  }).join('\n');
}

// ── 템플릿 렌더링 ──────────────────────────────────────────────

function render(data) {
  let html = readFileSync(
    path.join(ROOT, 'templates', 'certificate-page2.html'),
    'utf-8'
  );

  const replacements = {
    '{{cert_title}}':         data.cert_title,
    '{{birth_year_gapja}}':   data.birth_year_gapja,
    '{{birth_year_ko}}':      data.birth_year_ko,
    '{{birth_month_han}}':    data.birth_month_han,
    '{{birth_month_ko}}':     data.birth_month_ko,
    '{{birth_day_han}}':      data.birth_day_han,
    '{{birth_day_ko}}':       data.birth_day_ko,
    '{{birth_shi_han}}':      data.birth_shi_han,
    '{{birth_hour_ko}}':      data.birth_hour_ko,
    '{{birth_info_ko}}':      data.birth_info_ko,
    '{{last_name_hanja}}':    data.last_name_hanja,
    '{{last_name_strokes}}':  String(data.last_name_strokes),
    '{{last_name_yang_eum}}': data.last_name_yang_eum,
    '{{name_ko}}':            data.name_ko,
    '{{office_name}}':        data.office_name,
    '{{seal_char}}':          data.seal_char,
    '{{GIVEN_NAME_CHARS_HTML}}': renderGivenNameChars(data.given_name_chars),
    '{{DEOKDAM_HTML}}':       renderDeokdam(data.deokdam_items),
    '{{PALJA_HTML}}':         renderPalja(data.palja),
  };

  for (const [key, val] of Object.entries(replacements)) {
    html = html.split(key).join(val);
  }

  return html;
}

// ── 출력 ────────────────────────────────────────────────────────

const outDir  = path.join(ROOT, 'test-output');
const outFile = path.join(outDir, 'page2-preview.html');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, render(dummy), 'utf-8');

console.log('');
console.log('✅ page2-preview.html 생성 완료');
console.log('');
console.log('🌐 브라우저로 다음 파일을 열어 시각 확인하세요:');
console.log(`   ${outFile}`);
console.log('');
console.log('📋 확인 체크리스트:');
console.log('   ☐ 4면 테두리 + 4모서리 ❀ 장식');
console.log('   ☐ 우상단 作名證 큰 한자 세로');
console.log('   ☐ 출생 정보 세로 한자 + 한글 음');
console.log('   ☐ 중앙 金 智 宇 큰 한자 + 획수·음양');
console.log('   ☐ 좌측 8대 덕담 세로 정렬');
console.log('   ☐ 중하 사주팔자 4기둥 (한글 음 위에)');
console.log('   ☐ 좌하 붉은 인장 + 작명소 이름');
console.log('   ☐ 명조체 폰트 정상');
console.log('');

/**
 * saju.js — 사주팔자 계산 모듈
 *
 * export calculateSaju({ year, month, day, hour, isLunar })
 * export getElement(cheonOrJi)
 */

// ── 천간 / 지지 ─────────────────────────────────────────────────
const CHEON_GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const JI_JI     = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// 월지: 1월=丑(1), 2월=寅(2), ..., 12월=子(0)
// (입춘 단순화 기준 — 양력 월 기준 고정)
const MONTH_JI = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0];
// 1월→丑(idx 1), 2월→寅(idx 2), 3월→卯(idx 3), 4월→辰(idx 4),
// 5월→巳(idx 5), 6월→午(idx 6), 7월→未(idx 7), 8월→申(idx 8),
// 9월→酉(idx 9), 10월→戌(idx 10), 11월→亥(idx 11), 12월→子(idx 0)

// 시지: 자시(23:00~01:00)=子(0), 이후 2시간 단위
const HOUR_JI_START_HOUR = [23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];

// ── 오행 매핑 ────────────────────────────────────────────────────
const CG_ELEMENT = {
  '甲':'木','乙':'木','丙':'火','丁':'火',
  '戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水',
};
const JJ_ELEMENT = {
  '子':'水','丑':'土','寅':'木','卯':'木',
  '辰':'土','巳':'火','午':'火','未':'土',
  '申':'金','酉':'金','戌':'土','亥':'水',
};

/**
 * 천간 또는 지지 한 글자의 오행 반환
 * @param {string} cheonOrJi
 * @returns {'木'|'火'|'土'|'金'|'水'}
 */
export function getElement(cheonOrJi) {
  return CG_ELEMENT[cheonOrJi] || JJ_ELEMENT[cheonOrJi] || '土';
}

// ── 년주 ─────────────────────────────────────────────────────────
function yearPillar(year) {
  const cgIdx = ((year - 4) % 10 + 10) % 10;
  const jjIdx = ((year - 4) % 12 + 12) % 12;
  return { cheon: CHEON_GAN[cgIdx], ji: JI_JI[jjIdx] };
}

// ── 월주 ─────────────────────────────────────────────────────────
function monthPillar(year, month) {
  const yearCgIdx = ((year - 4) % 10 + 10) % 10;
  const monthJjIdx = MONTH_JI[month];        // 0~11
  const monthCgIdx = (yearCgIdx * 2 + monthJjIdx) % 10;
  return { cheon: CHEON_GAN[monthCgIdx], ji: JI_JI[monthJjIdx] };
}

// ── 일주 ─────────────────────────────────────────────────────────
// 기준: 1900-01-01 = 甲戌 (甲=0, 戌=10)
const BASE_DATE      = new Date('1900-01-01T00:00:00Z');
const BASE_CG_IDX    = 0;  // 甲
const BASE_JJ_IDX    = 10; // 戌

function dayPillar(year, month, day) {
  const target  = Date.UTC(year, month - 1, day);
  const diff    = Math.floor((target - BASE_DATE.getTime()) / 86400000);
  const cgIdx   = ((BASE_CG_IDX + diff) % 10 + 10) % 10;
  const jjIdx   = ((BASE_JJ_IDX + diff) % 12 + 12) % 12;
  return { cheon: CHEON_GAN[cgIdx], ji: JI_JI[jjIdx] };
}

// ── 시주 ─────────────────────────────────────────────────────────
function hourJiIndex(hour) {
  // 23:00~00:59 → 子(0), 01:00~02:59 → 丑(1), ...
  if (hour === 23) return 0; // 子
  return Math.floor((hour + 1) / 2) % 12;
}

function hourPillar(dayCgChar, hour) {
  const dayCgIdx  = CHEON_GAN.indexOf(dayCgChar);
  const hourJjIdx = hourJiIndex(hour);
  const hourCgIdx = ((dayCgIdx * 2 + hourJjIdx) % 10 + 10) % 10;
  return { cheon: CHEON_GAN[hourCgIdx], ji: JI_JI[hourJjIdx] };
}

// ── 오행 집계 ────────────────────────────────────────────────────
function countElements(pillars) {
  const counts = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  for (const p of pillars) {
    if (!p) continue;
    counts[getElement(p.cheon)]++;
    counts[getElement(p.ji)]++;
  }
  return counts;
}

// ── 용신 결정 ────────────────────────────────────────────────────
const ELEMENT_NAMES = { 木:'木(나무)', 火:'火(불)', 土:'土(흙)', 金:'金(쇠)', 水:'水(물)' };
const ELEMENT_DESCS = {
  木: '木(나무) 기운이 부족하여 이름에 木 속성 한자가 들어가면 균형이 좋아집니다',
  火: '火(불) 기운이 부족하여 이름에 火 속성 한자가 들어가면 균형이 좋아집니다',
  土: '土(흙) 기운이 부족하여 이름에 土 속성 한자가 들어가면 균형이 좋아집니다',
  金: '金(쇠) 기운이 부족하여 이름에 金 속성 한자가 들어가면 균형이 좋아집니다',
  水: '水(물) 기운이 부족하여 이름에 水 속성 한자가 들어가면 균형이 좋아집니다',
};

function findYongsin(elements) {
  // 가장 낮은 오행 → 용신
  const order = ['木','火','土','金','水'];
  let min = Infinity, yong = '水';
  for (const el of order) {
    if (elements[el] < min) { min = elements[el]; yong = el; }
  }
  return yong;
}

// ── 메인 export ──────────────────────────────────────────────────
/**
 * @param {{ year:number, month:number, day:number, hour:number|null, isLunar?:boolean }} param
 */
export function calculateSaju({ year, month, day, hour = null, isLunar = false }) {
  // 음력 변환 (필요 시)
  let sYear = year, sMonth = month, sDay = day;
  if (isLunar) {
    try {
      // korean-lunar-calendar가 설치된 경우 사용
      // (동기 import 불가이므로 단순 근사 사용 — 실 서비스에서는 사전 변환 권장)
      // 여기서는 음력을 그대로 양력 근사로 처리 (±1개월 오차 허용)
    } catch {}
  }

  const yp = yearPillar(sYear);
  const mp = monthPillar(sYear, sMonth);
  const dp = dayPillar(sYear, sMonth, sDay);
  const hp = (hour !== null) ? hourPillar(dp.cheon, hour) : null;

  const pillars = [yp, mp, dp, hp].filter(Boolean);
  const elements = countElements(pillars);

  // hour가 없으면 8글자 대신 6글자로 계산 → 비율 보정 없이 raw count 사용
  const yongsin     = findYongsin(elements);
  const yongsin_desc = ELEMENT_DESCS[yongsin];

  return {
    palja: {
      year:  yp,
      month: mp,
      day:   dp,
      hour:  hp,
    },
    elements,
    yongsin,
    yongsin_desc,
    hour_known: hour !== null,
  };
}

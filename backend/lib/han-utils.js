/**
 * han-utils.js — 숫자·날짜·시간을 한자 표기로 변환
 */

const CHEON_GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const JI_JI     = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const HAN_DIGITS = ['','一','二','三','四','五','六','七','八','九'];
const HAN_UNITS  = ['','十','百','千'];

/**
 * 아라비아 숫자 → 한자 수 표기
 * 예) 27 → "二十七", 2026 → "二千二十六"
 */
export function arabicToHan(num) {
  if (num === 0) return '零';
  const str = String(num);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const d = parseInt(str[i]);
    const unit = str.length - 1 - i;
    if (d === 0) continue;
    // 10~19에서 십의 자리 1은 一 생략 (十二, 十三 ...)
    if (unit === 1 && d === 1 && str.length === 2) {
      result += HAN_UNITS[1];
    } else {
      result += HAN_DIGITS[d] + HAN_UNITS[unit];
    }
  }
  return result;
}

/** 1~12 → "一月"~"十二月" */
export function monthToHan(m) {
  return arabicToHan(m) + '月';
}

/** 1~31 → "一日"~"三十一日" */
export function dayToHan(d) {
  return arabicToHan(d) + '日';
}

/**
 * 0~23 시 → 시진 한자 (子時~亥時)
 * 경계: 23~01=子, 01~03=丑, 03~05=寅, 05~07=卯,
 *       07~09=辰, 09~11=巳, 11~13=午, 13~15=未,
 *       15~17=申, 17~19=酉, 19~21=戌, 21~23=亥
 * null/undefined → "時不知"
 */
export function hourToShi(h) {
  if (h === null || h === undefined) return '時不知';
  const idx = h === 23 ? 0 : Math.floor((h + 1) / 2) % 12;
  return JI_JI[idx] + '時';
}

/**
 * 연도 → 60갑자 2글자 한자
 * 기준: 1984 = 甲子, (year-4)%10 → 천간, (year-4)%12 → 지지
 */
export function getYearGapja(year) {
  const cgIdx = ((year - 4) % 10 + 10) % 10;
  const jjIdx = ((year - 4) % 12 + 12) % 12;
  return CHEON_GAN[cgIdx] + JI_JI[jjIdx];
}

/** 획수 → 음양. 홀수="양", 짝수="음" */
export function strokesToYangEum(strokes) {
  return strokes % 2 === 0 ? '음' : '양';
}

const CHEON_GAN_KO = ['갑','을','병','정','무','기','경','신','임','계'];
const JI_JI_KO     = ['자','축','인','묘','진','사','오','미','신','유','술','해'];

/** 천간/지지 한자 → 한글 음. 예) 丙→병, 午→오 */
export function getHanKoreanReading(char) {
  const cgIdx = CHEON_GAN.indexOf(char);
  if (cgIdx !== -1) return CHEON_GAN_KO[cgIdx];
  const jjIdx = JI_JI.indexOf(char);
  if (jjIdx !== -1) return JI_JI_KO[jjIdx];
  return '';
}

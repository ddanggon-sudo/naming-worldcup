/**
 * suri.js — 81수리 5격 계산 모듈
 *
 * export calculateSuri(lastNameHanja, givenNameHanja)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { strokesToYangEum } from './han-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const suri81     = JSON.parse(readFileSync(path.join(__dirname, '../data/suri_81.json'), 'utf-8'));
const hanjaDB    = JSON.parse(readFileSync(path.join(__dirname, '../data/hanja_db.json'), 'utf-8'));
const strokesExt = JSON.parse(readFileSync(path.join(__dirname, '../data/strokes_ext.json'), 'utf-8'));

function getStrokes(char) {
  return hanjaDB[char]?.strokes ?? strokesExt[char] ?? 0;
}

function lookupSuri(num) {
  const idx = ((num - 1) % 81) + 1;
  const entry = suri81[String(idx)];
  return { num, ...(entry ?? { level: '中', label: '미분류', desc: '' }) };
}

/**
 * 5격 계산
 * @param {string} lastNameHanja  성씨 한자 (예: "金")
 * @param {string} givenNameHanja 이름 한자 (예: "智宇")
 * @returns {{
 *   chars: Array<{char,strokes,yang_eum}>,
 *   cheon_gyeok, in_gyeok, ji_gyeok, oe_gyeok, chong_gyeok
 * }}
 */
export function calculateSuri(lastNameHanja, givenNameHanja) {
  const lastChars  = [...lastNameHanja];
  const givenChars = [...givenNameHanja];

  const charObjs = [...lastChars, ...givenChars].map(c => {
    const s = getStrokes(c);
    return { char: c, strokes: s, yang_eum: strokesToYangEum(s) };
  });

  const lastStrokes      = lastChars.reduce((sum, c) => sum + getStrokes(c), 0);
  const givenStrokes     = givenChars.reduce((sum, c) => sum + getStrokes(c), 0);
  const firstGivenStrokes = givenChars.length > 0 ? getStrokes(givenChars[0]) : 0;
  const totalStrokes     = lastStrokes + givenStrokes;

  const cheon = lastStrokes + 1;
  const in_   = lastStrokes + firstGivenStrokes;
  const ji    = givenStrokes;
  const chong = totalStrokes;
  const oe    = chong - in_ + 1;

  return {
    chars:       charObjs,
    cheon_gyeok: lookupSuri(cheon),
    in_gyeok:    lookupSuri(in_),
    ji_gyeok:    lookupSuri(ji),
    oe_gyeok:    lookupSuri(oe),
    chong_gyeok: lookupSuri(chong),
  };
}

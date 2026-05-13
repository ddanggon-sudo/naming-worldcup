'use strict';
/**
 * build-hanja-sound.cjs
 * Unicode Unihan_Readings.txt에서 kHangul(한국어 음) 추출 → data/hanja_sound.json
 * 실행: node scripts/build-hanja-sound.cjs
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const zlib    = require('zlib');
const { Writable } = require('stream');

// AdmZip이 없으면 unzipper 또는 직접 파싱 시도
let AdmZip;
try { AdmZip = require('adm-zip'); } catch(_) {}

const UNIHAN_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip';
const TMP_ZIP    = path.join(__dirname, '../data/_unihan_tmp.zip');
const OUT_FILE   = path.join(__dirname, '../data/hanja_sound.json');
const HANJA_DB   = path.join(__dirname, '../data/hanja_db.json');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (total) process.stdout.write(`\r다운로드 중... ${(received/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log('\n다운로드 완료'); resolve(); });
    }).on('error', reject);
  });
}

function parseReadings(text) {
  const sound = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [cp, field, value] = parts;
    if (field !== 'kHangul') continue;
    // cp 형식: U+XXXX
    const codePoint = parseInt(cp.slice(2), 16);
    const char = String.fromCodePoint(codePoint);
    // kHangul 값: 여러 음이 있으면 공백 구분, 첫 번째만 사용 / "읽기:메타" 형식에서 앞부분만 취함
    const raw = value.trim().split(' ')[0];
    sound[char] = raw.split(':')[0];
  }
  return sound;
}

async function main() {
  // 1. Unihan.zip 다운로드
  if (!fs.existsSync(TMP_ZIP)) {
    console.log('Unihan.zip 다운로드 중...');
    await download(UNIHAN_URL, TMP_ZIP);
  } else {
    console.log('캐시된 Unihan.zip 사용');
  }

  // 2. ZIP에서 Unihan_Readings.txt 추출
  console.log('Unihan_Readings.txt 추출 중...');
  let readingsText;
  if (AdmZip) {
    const zip = new AdmZip(TMP_ZIP);
    const entry = zip.getEntry('Unihan_Readings.txt');
    if (!entry) throw new Error('Unihan_Readings.txt not found in zip');
    readingsText = entry.getData().toString('utf-8');
  } else {
    // adm-zip 없으면 unzipper 시도
    const unzipper = require('unzipper');
    readingsText = await new Promise((resolve, reject) => {
      const chunks = [];
      fs.createReadStream(TMP_ZIP)
        .pipe(unzipper.ParseOne(/Unihan_Readings\.txt/))
        .on('data', c => chunks.push(c))
        .on('finish', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        .on('error', reject);
    });
  }

  // 3. kHangul 파싱
  console.log('kHangul 파싱 중...');
  const sound = parseReadings(readingsText);

  // 4. hanja_db에 이미 있는 글자는 제외 (hanja_db가 더 정확)
  const hanjaDB = JSON.parse(fs.readFileSync(HANJA_DB, 'utf-8'));
  let skipped = 0;
  for (const char of Object.keys(hanjaDB)) {
    if (sound[char]) { delete sound[char]; skipped++; }
  }

  const count = Object.keys(sound).length;
  console.log(`파싱 완료: ${count}자 (hanja_db 중복 ${skipped}자 제거)`);

  // 5. 저장
  fs.writeFileSync(OUT_FILE, JSON.stringify(sound, null, 0));
  const size = fs.statSync(OUT_FILE).size;
  console.log(`저장 완료: ${OUT_FILE} (${(size/1024).toFixed(1)} KB)`);

  // 6. 임시 파일 삭제
  fs.unlinkSync(TMP_ZIP);
  console.log('임시 파일 삭제 완료');
}

main().catch(e => { console.error(e); process.exit(1); });

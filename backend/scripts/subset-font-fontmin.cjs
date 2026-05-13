'use strict';

const Fontmin = require('fontmin');
const path    = require('path');
const fs      = require('fs');

const HANJA_DB       = path.join(__dirname, '../data/hanja_db.json');
const HANJA_META_EXT = path.join(__dirname, '../data/hanja_meta_ext.json');
const HANJA_SOUND    = path.join(__dirname, '../data/hanja_sound.json');
const FONT_PATH      = path.join(__dirname, '../fonts/UNI_HSR.TTF');
const OUT_DIR        = path.join(__dirname, '../fonts/subset_tmp');

const hanjaDB    = JSON.parse(fs.readFileSync(HANJA_DB, 'utf-8'));
const metaExt    = JSON.parse(fs.readFileSync(HANJA_META_EXT, 'utf-8'));
const hanjaSound = JSON.parse(fs.readFileSync(HANJA_SOUND, 'utf-8'));

const FIXED_CHARS = [
  // Birth info labels
  '年月日時陽曆誕生',
  // arabicToHan output chars (0~31 range covers months/days)
  '零一二三四五六七八九十百千',
  // hourToShi null case
  '不知',
  // 作名證 title
  '作名證',
  // Heavenly stems
  '甲乙丙丁戊己庚辛壬癸',
  // Earthly branches
  '子丑寅卯辰巳午未申酉戌亥',
  // Virtues / misc fixed chars
  '仁義禮智信勇孝悌忠廉恥耻德才福壽富貴吉祥瑞泰',
  // FIXED_DEOKDAM all hanja chars
  '富家成長父祖有德人格出衆明哲物專門才能博士得健康良配',
  // Common surnames
  '金李朴崔鄭趙姜張林韓吳徐申盧劉高安梁洪黃全柳許南邊丁曺孫白余太薛夏陳嚴羅沈睦卞呂蔡秋魯葛秦都龍苟',
  // Misc cert chars
  '氏家族代號堂',
  // Common name hanja NOT in hanja_db (령/영/준/아 등 자주 쓰이나 DB 미수록)
  '令齡齊齋齣齦齧齪齬齭齮令玲靈鈴笭伶昤泠炤炴珑瓴苓聆羚翎蛉袊軨醽鈴鉦鈴霝頲飪',
  '俊埈峻晙樽浚焌畯竣罇蠢駿鵔鐏',
  '熙羲僖憙憘曦欷熺爔禧',
  '宣宜善嬋嫺璿瑄',
  '朗亮晾',
].join('');

const allChars = new Set([
  ...Object.keys(hanjaDB),
  ...Object.keys(metaExt),
  ...Object.keys(hanjaSound),
  ...FIXED_CHARS,
]);

const text = [...allChars].join('');
console.log(`Subsetting ${allChars.size} unique characters...`);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const fontmin = new Fontmin()
  .src(FONT_PATH)
  .use(Fontmin.glyph({ text, hinting: false }))
  .dest(OUT_DIR);

fontmin.run((err, files) => {
  if (err) {
    console.error('Fontmin error:', err.message);
    process.exit(1);
  }

  const tmpFile = path.join(OUT_DIR, 'UNI_HSR.TTF');
  const outFile = path.join(__dirname, '../fonts/UNI_HSR_subset.ttf');

  if (!fs.existsSync(tmpFile)) {
    console.error('Output file not found:', tmpFile);
    process.exit(1);
  }

  fs.copyFileSync(tmpFile, outFile);
  fs.rmSync(OUT_DIR, { recursive: true });

  const size = fs.statSync(outFile).size;
  console.log(`Done! Output: ${outFile}`);
  console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
});

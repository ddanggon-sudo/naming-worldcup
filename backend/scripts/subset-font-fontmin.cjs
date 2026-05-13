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
  // 한글(Hangul) — 훈/음/레이블 등 증명서에 쓰이는 글자 (data 파일에서 추출)
  '첫째둘셋장정다섯여일곱덟아홉열들소범토끼용뱀말양거듭닭개돼지쇠자두순박할높을나라이름생강베풀수천검죽편안보클누를온전버허락남녘가무리손흰쑥갓엄벌릴잠길화목성씨칡도읍옳울노래더집운옥패굳셀공경치사서벼슬빛날계시냇물절구멍너그러꿸넓은오랠별홀궁뿌부런복기터즐녹침붉바통달깊못동마룻대한막등큰덕난초밝고연꽃매신령록슴낚싯줄린만득새글월결비눈썹하늘잣호타어푸향로받봉우황유모상뽕펼주석돌착흴빼숨맑때벽삼갈믿궐담싹랑해뜨는곳제칠읊찰필깨왕솟깃벗산근원위넉멀드진실윤택밤땅댈쁠귀질불줏씩곧조짐루종준걸금뜻배단깔형뛰넘충풍학합행살활반추햇희쌍국격식재능선얻좋짝룰있람증볕책력닐알영넷백예효청렴끄흙봄겨민첩함현명혜쁨움웅법칙율미빈중인애음술평태색채많규세칭찬돕흐란철광휘쪽따낌본느림솔직스승탄건작혁의설른훌륭훈업적숲임김환후송감씀언올큼으뜸파악카끗셈려헌옴방완야욱앎둥긂크떨저번창겸컷섭같응춘혼르교육병권총요차분찌심묘맹굽홍문처균련북데밭참됨녀붓렬특잎뭇엽레없룩탕발렵존각례흔숙망논론내속맡징극료쓰뒤킴샘니맺춤항변않젊힘역량협관머끌당랍퀴익낮탁간꿈몽판헤습포웃굿닒묾섬쟁뻗몸체냄귐류빠히긍휼빌흠삭뇌칼표께뭍륜회뚝면콩취밀코네과녁암솜품꿀콤투족님틀얼굴씻융옷앙닻숭축퍼메풂접까딧립낭군낙겉척곤먼앞늬숯털갖외끎견빽늙옹좌뇨돋잔릇곶핍괴볼십측잉흘급휴점녕퉁괄궤탈촉쉬왜릉게탑최첨농억뢰롱흉입팔륙엔염멱빙냉늠출겁쇄랄획핵늑갑닉삽훼졸잡괘즉액촌폐눌흡와곡객훤끽탐묵톤쾌앵갱퇴붕돈압혐혈굉횡층둔률험폭년곽약팽피념뉴에췌혹녑퍅욕략골탱촬확왈즙귤독친헐몰답륵멸힐폄룡납긴죄맥픽흥훙칩뉵몌갹틈괵흑',
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

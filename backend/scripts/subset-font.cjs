#!/usr/bin/env node
'use strict';

/**
 * UNI_HSR.TTF font subsetter
 * Extracts only the glyphs needed for the 作名證 certificate.
 * Outputs: backend/fonts/UNI_HSR_subset.ttf
 *
 * Strategy:
 * 1. Parse cmap (format 4) to build codepoint→glyphId map
 * 2. Collect needed codepoints (hanja_db keys + fixed chars)
 * 3. Expand composite glyph dependencies
 * 4. Rebuild glyf/loca (keep only needed glyphs, zero others)
 * 5. Rebuild hmtx (keep all entries to preserve glyph indices)
 * 6. Remove HanY and mort tables
 * 7. Recalculate all checksums
 */

const fs = require('fs');
const path = require('path');

const FONT_PATH  = path.join(__dirname, '../fonts/UNI_HSR.TTF');
const OUT_PATH   = path.join(__dirname, '../fonts/UNI_HSR_subset.ttf');
const HANJA_DB   = path.join(__dirname, '../data/hanja_db.json');

// ─── Fixed characters always included ────────────────────────────────────────
const FIXED_CHARS = [
  // Korean birth info labels
  '年','月','日','時','陽','曆','誕','生',
  // 作名證 title
  '作','名','證',
  // Saju heavenly stems
  '甲','乙','丙','丁','戊','己','庚','辛','壬','癸',
  // Saju earthly branches
  '子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥',
  // Deokdam virtues (common set)
  '仁','義','禮','智','信','勇','孝','悌','忠','廉','恥','耻',
  '德','才','福','壽','富','貴','吉','祥','瑞','泰',
  // Common surname hanja
  '金','李','朴','崔','鄭','趙','姜','張','林','韓','吳','徐',
  '申','盧','劉','高','安','梁','洪','黃','全','柳','許','南',
  '邊','丁','曺','孫','白','余','太','薛','夏','陳','嚴','羅',
  '沈','睦','卞','呂','蔡','秋','魯','葛','秦','都','龍','苟',
  // Stroke count digits (used in annotations)
  '一','二','三','四','五','六','七','八','九','十',
  // Misc cert chars
  '氏','家','族','代','號','堂',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const r16  = (b, o) => b.readUInt16BE(o);
const r32  = (b, o) => b.readUInt32BE(o);
const ri16 = (b, o) => b.readInt16BE(o);
const ri32 = (b, o) => b.readInt32BE(o);

function tag(b, o) { return b.slice(o, o+4).toString('ascii'); }

function calcChecksum(buf) {
  let sum = 0;
  const n = Math.floor(buf.length / 4);
  for (let i = 0; i < n; i++) {
    sum = (sum + buf.readUInt32BE(i * 4)) >>> 0;
  }
  // trailing bytes
  const rem = buf.length % 4;
  if (rem) {
    let val = 0;
    for (let i = 0; i < rem; i++) val |= buf[buf.length - rem + i] << ((3 - i) * 8);
    sum = (sum + (val >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function padTo4(buf) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  const pad = Buffer.alloc(4 - rem, 0);
  return Buffer.concat([buf, pad]);
}

// ─── Parse offset table ───────────────────────────────────────────────────────
function parseTables(buf) {
  const numTables = r16(buf, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const t = tag(buf, base);
    tables[t] = {
      checksum: r32(buf, base + 4),
      offset:   r32(buf, base + 8),
      length:   r32(buf, base + 12),
    };
  }
  return tables;
}

// ─── Parse cmap format 4 → Map<codepoint, glyphId> ───────────────────────────
function parseCmap(buf, tables) {
  const cmapOff = tables['cmap'].offset;
  const numSubtables = r16(buf, cmapOff + 2);
  let chosenOffset = null;
  for (let i = 0; i < numSubtables; i++) {
    const base = cmapOff + 4 + i * 8;
    const platformId = r16(buf, base);
    const encodingId = r16(buf, base + 2);
    const off = r32(buf, base + 4);
    // prefer platform=3 (Windows) encoding=1 (BMP Unicode)
    if (platformId === 3 && encodingId === 1) {
      chosenOffset = cmapOff + off;
      break;
    }
    // fallback: platform=0 (Unicode)
    if (platformId === 0 && chosenOffset === null) {
      chosenOffset = cmapOff + off;
    }
  }
  if (chosenOffset === null) throw new Error('No suitable cmap subtable found');

  const fmt = r16(buf, chosenOffset);
  if (fmt !== 4) throw new Error(`Expected cmap format 4, got ${fmt}`);

  const segCount = r16(buf, chosenOffset + 6) / 2;
  const endArray   = chosenOffset + 14;
  const startArray = endArray + 2 + segCount * 2;
  const deltaArray = startArray + segCount * 2;
  const rangeArray = deltaArray + segCount * 2;
  const glyphArray = rangeArray + segCount * 2;

  const cpToGlyph = new Map();
  for (let i = 0; i < segCount; i++) {
    const endCode   = r16(buf, endArray   + i * 2);
    const startCode = r16(buf, startArray + i * 2);
    const delta     = ri16(buf, deltaArray + i * 2);
    const rangeOff  = r16(buf, rangeArray + i * 2);

    if (startCode === 0xFFFF) break;

    for (let cp = startCode; cp <= endCode; cp++) {
      let glyphId;
      if (rangeOff === 0) {
        glyphId = (cp + delta) & 0xFFFF;
      } else {
        const idx = (rangeArray + i * 2) + rangeOff + (cp - startCode) * 2;
        glyphId = r16(buf, idx);
        if (glyphId !== 0) glyphId = (glyphId + delta) & 0xFFFF;
      }
      if (glyphId !== 0) cpToGlyph.set(cp, glyphId);
    }
  }
  return cpToGlyph;
}

// ─── Collect composite glyph component glyphIds ──────────────────────────────
function getCompositeComponents(buf, tables, glyphId, locaOffsets) {
  const glyf = tables['glyf'].offset;
  const glyphOff = glyf + locaOffsets[glyphId];
  const nextOff  = glyf + locaOffsets[glyphId + 1];
  if (nextOff === glyphOff) return []; // empty glyph

  const numContours = ri16(buf, glyphOff);
  if (numContours >= 0) return []; // simple glyph

  // composite glyph
  const components = [];
  let pos = glyphOff + 10;
  let flags;
  do {
    flags = r16(buf, pos);
    const componentGlyph = r16(buf, pos + 2);
    components.push(componentGlyph);
    pos += 4;
    const arg1and2WordFlag = flags & 0x0001;
    const weHaveScaleFlag  = flags & 0x0008;
    const weHaveXYScale    = flags & 0x0040;
    const weHave2x2        = flags & 0x0080;
    if (arg1and2WordFlag) pos += 4; else pos += 2;
    if (weHave2x2)        pos += 8;
    else if (weHaveXYScale) pos += 4;
    else if (weHaveScaleFlag) pos += 2;
  } while (flags & 0x0020); // MORE_COMPONENTS
  return components;
}

// ─── Parse loca table → array of byte offsets (length = numGlyphs+1) ─────────
function parseLoca(buf, tables, numGlyphs, indexToLocFormat) {
  const locaOff = tables['loca'].offset;
  const offsets = [];
  if (indexToLocFormat === 0) {
    // short format: values * 2
    for (let i = 0; i <= numGlyphs; i++) {
      offsets.push(r16(buf, locaOff + i * 2) * 2);
    }
  } else {
    // long format
    for (let i = 0; i <= numGlyphs; i++) {
      offsets.push(r32(buf, locaOff + i * 4));
    }
  }
  return offsets;
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('Reading font file...');
  const buf = fs.readFileSync(FONT_PATH);
  console.log(`Font size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const tables = parseTables(buf);
  console.log('Tables found:', Object.keys(tables).join(', '));

  // Read head table for numGlyphs context
  const headOff = tables['head'].offset;
  const indexToLocFormat = ri16(buf, headOff + 50);
  console.log('indexToLocFormat:', indexToLocFormat);

  const maxpOff = tables['maxp'].offset;
  const numGlyphs = r16(buf, maxpOff + 4);
  console.log('numGlyphs:', numGlyphs);

  // Parse loca
  const locaOffsets = parseLoca(buf, tables, numGlyphs, indexToLocFormat);

  // Parse cmap
  console.log('Parsing cmap...');
  const cpToGlyph = parseCmap(buf, tables);
  console.log(`cmap entries: ${cpToGlyph.size}`);

  // Build needed codepoint set
  const hanjaDB = JSON.parse(fs.readFileSync(HANJA_DB, 'utf-8'));
  const neededCps = new Set();

  // Always include glyph 0 (.notdef)
  const neededGlyphs = new Set([0]);

  // From hanja_db keys
  for (const ch of Object.keys(hanjaDB)) {
    neededCps.add(ch.codePointAt(0));
  }
  // Fixed chars
  for (const ch of FIXED_CHARS) {
    neededCps.add(ch.codePointAt(0));
  }

  console.log(`Needed codepoints: ${neededCps.size}`);

  // Map codepoints → glyphIds
  let found = 0, missing = 0;
  for (const cp of neededCps) {
    const gid = cpToGlyph.get(cp);
    if (gid !== undefined) {
      neededGlyphs.add(gid);
      found++;
    } else {
      missing++;
      // console.log(`  MISSING: U+${cp.toString(16).padStart(4,'0')} = ${String.fromCodePoint(cp)}`);
    }
  }
  console.log(`Glyphs found: ${found}, missing from font: ${missing}`);

  // Expand composite dependencies
  console.log('Expanding composite glyph dependencies...');
  const toExpand = [...neededGlyphs];
  for (const gid of toExpand) {
    const comps = getCompositeComponents(buf, tables, gid, locaOffsets);
    for (const c of comps) {
      if (!neededGlyphs.has(c)) {
        neededGlyphs.add(c);
        toExpand.push(c);
      }
    }
  }
  console.log(`Total glyphs after composite expansion: ${neededGlyphs.size}`);

  // ─── Rebuild glyf table ──────────────────────────────────────────────────
  console.log('Rebuilding glyf table...');
  const gyfOff = tables['glyf'].offset;
  const newGlyfChunks = [];
  const newLocaOffsets = new Array(numGlyphs + 1);
  let glyfCursor = 0;

  for (let i = 0; i < numGlyphs; i++) {
    newLocaOffsets[i] = glyfCursor;
    if (neededGlyphs.has(i)) {
      const start = locaOffsets[i];
      const end   = locaOffsets[i + 1];
      const len   = end - start;
      if (len > 0) {
        const glyphData = padTo4(buf.slice(gyfOff + start, gyfOff + end));
        newGlyfChunks.push(glyphData);
        glyfCursor += glyphData.length;
      }
    }
    // glyphs not needed: zero-length entry (offset stays the same = empty glyph)
  }
  newLocaOffsets[numGlyphs] = glyfCursor;

  const newGlyf = Buffer.concat(newGlyfChunks);
  console.log(`New glyf size: ${(newGlyf.length / 1024 / 1024).toFixed(2)} MB (was ${(tables['glyf'].length / 1024 / 1024).toFixed(2)} MB)`);

  // ─── Rebuild loca table (long format) ───────────────────────────────────
  const newLoca = Buffer.alloc((numGlyphs + 1) * 4);
  for (let i = 0; i <= numGlyphs; i++) {
    newLoca.writeUInt32BE(newLocaOffsets[i], i * 4);
  }

  // ─── Rebuild hmtx (keep all entries, just copy) ──────────────────────────
  // hmtx is already compact, just copy as-is (we're keeping all glyph indices)
  const hmtxData = buf.slice(tables['hmtx'].offset, tables['hmtx'].offset + tables['hmtx'].length);

  // ─── Tables to include (drop HanY, mort) ────────────────────────────────
  const DROP_TABLES = new Set(['HanY', 'mort', 'morx']);
  const keepTableNames = Object.keys(tables).filter(t => !DROP_TABLES.has(t));
  console.log('Dropping tables:', [...DROP_TABLES].filter(t => tables[t]).join(', '));

  // Build updated table data map
  const tableData = {};
  for (const t of keepTableNames) {
    if (t === 'glyf') {
      tableData[t] = newGlyf;
    } else if (t === 'loca') {
      tableData[t] = newLoca;
    } else if (t === 'hmtx') {
      tableData[t] = hmtxData;
    } else if (t === 'head') {
      // Copy head, update indexToLocFormat to 1 (long)
      const headData = Buffer.from(buf.slice(tables[t].offset, tables[t].offset + tables[t].length));
      headData.writeInt16BE(1, 50); // indexToLocFormat = 1 (long)
      // Zero out checksumAdjustment (will be fixed after full font checksum)
      headData.writeUInt32BE(0, 8);
      tableData[t] = headData;
    } else {
      tableData[t] = buf.slice(tables[t].offset, tables[t].offset + tables[t].length);
    }
  }

  // ─── Assemble new font ───────────────────────────────────────────────────
  console.log('Assembling new font...');

  const numKeepTables = keepTableNames.length;
  // Sort tables by tag for offset table
  keepTableNames.sort();

  // Calculate offsets
  const sfntHeaderSize = 12 + numKeepTables * 16;
  // Align each table to 4 bytes
  const tableOffsets = {};
  let currentOffset = sfntHeaderSize;
  for (const t of keepTableNames) {
    tableOffsets[t] = currentOffset;
    currentOffset += padTo4(tableData[t]).length;
  }

  // Build offset table (sfnt header)
  const sfntBuf = Buffer.alloc(sfntHeaderSize);
  // sfVersion = 0x00010000 (TrueType)
  sfntBuf.writeUInt32BE(0x00010000, 0);
  sfntBuf.writeUInt16BE(numKeepTables, 4);

  // searchRange, entrySelector, rangeShift
  const maxPow2 = Math.floor(Math.log2(numKeepTables));
  const searchRange = Math.pow(2, maxPow2) * 16;
  const entrySelector = maxPow2;
  const rangeShift = numKeepTables * 16 - searchRange;
  sfntBuf.writeUInt16BE(searchRange, 6);
  sfntBuf.writeUInt16BE(entrySelector, 8);
  sfntBuf.writeUInt16BE(rangeShift, 10);

  // Table directory entries
  for (let i = 0; i < numKeepTables; i++) {
    const t = keepTableNames[i];
    const base = 12 + i * 16;
    sfntBuf.write(t.padEnd(4, '\0'), base, 4, 'ascii');
    // checksum placeholder (fill after)
    sfntBuf.writeUInt32BE(0, base + 4);
    sfntBuf.writeUInt32BE(tableOffsets[t], base + 8);
    sfntBuf.writeUInt32BE(tableData[t].length, base + 12);
  }

  // Assemble full font buffer
  const parts = [sfntBuf];
  for (const t of keepTableNames) {
    parts.push(padTo4(tableData[t]));
  }
  const fontBuf = Buffer.concat(parts);

  // ─── Fill per-table checksums in directory ───────────────────────────────
  for (let i = 0; i < numKeepTables; i++) {
    const t = keepTableNames[i];
    const base = 12 + i * 16;
    const off = tableOffsets[t];
    const len = tableData[t].length;
    const paddedLen = len + ((4 - len % 4) % 4);
    const cs = calcChecksum(fontBuf.slice(off, off + paddedLen));
    fontBuf.writeUInt32BE(cs, base + 4);
  }

  // ─── Fix head.checksumAdjustment ────────────────────────────────────────
  const wholeChecksum = calcChecksum(fontBuf);
  const checksumAdjustment = (0xB1B0AFBA - wholeChecksum) >>> 0;
  // Find head table offset in fontBuf
  const headIdx = keepTableNames.indexOf('head');
  const headOff2 = tableOffsets['head'];
  fontBuf.writeUInt32BE(checksumAdjustment, headOff2 + 8);
  // Recalculate head table checksum in directory
  {
    const base = 12 + headIdx * 16;
    const len = tableData['head'].length;
    const paddedLen = len + ((4 - len % 4) % 4);
    const cs = calcChecksum(fontBuf.slice(headOff2, headOff2 + paddedLen));
    fontBuf.writeUInt32BE(cs, base + 4);
  }

  // ─── Write output ────────────────────────────────────────────────────────
  fs.writeFileSync(OUT_PATH, fontBuf);
  const outSize = fontBuf.length;
  console.log(`\nOutput: ${OUT_PATH}`);
  console.log(`Output size: ${(outSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('Done!');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

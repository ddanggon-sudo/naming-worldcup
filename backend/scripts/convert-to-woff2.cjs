'use strict';
const fs = require('fs');
const path = require('path');
const ttf2woff2 = require('ttf2woff2').default;

const inFile  = path.join(__dirname, '../fonts/UNI_HSR_subset.ttf');
const outFile = path.join(__dirname, '../fonts/UNI_HSR_subset.woff2');

const ttfData = fs.readFileSync(inFile);
console.log(`Input: ${(ttfData.length/1024).toFixed(0)} KB`);

const woff2Data = ttf2woff2(ttfData);
fs.writeFileSync(outFile, woff2Data);
console.log(`Output: ${(woff2Data.length/1024).toFixed(0)} KB`);
console.log('Done:', outFile);

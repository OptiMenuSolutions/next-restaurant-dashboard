// Export reviewed workbook caches; no projection model is run.
// Usage: node scripts/export-projection-ranges.mjs original.xlsx recalculated.xlsx
// The second workbook must already have been recalculated in LibreOffice.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import ExcelJS from 'exceljs';

const args = process.argv.slice(2);
assert.equal(args.length, 2,
  'Usage: node scripts/export-projection-ranges.mjs original.xlsx recalculated.xlsx');
const [originalPath, recalculatedPath] = args.map(path => resolve(path));
const [originalBytes, recalculatedBytes] = await Promise.all([
  readFile(originalPath), readFile(recalculatedPath),
]);
const source = new ExcelJS.Workbook(), recalculated = new ExcelJS.Workbook();
await Promise.all([source.xlsx.load(originalBytes), recalculated.xlsx.load(recalculatedBytes)]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function value(book, sheetName, row, column) {
  const sheet = book.getWorksheet(sheetName);
  assert.ok(sheet, `Missing worksheet: ${sheetName}`);
  const cell = sheet.getCell(row, column);
  // ExcelJS's formula .value getter omits falsy results. Read .result directly
  // so cached zeroes and false flags are preserved.
  let item = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
  if (item && typeof item === 'object' && !(item instanceof Date)) {
    if (Array.isArray(item.richText)) item = item.richText.map(part => part.text).join('');
  }
  if (item == null || item === '') return null;
  if (item instanceof Date) {
    assert.ok(Number.isFinite(item.getTime()), 'Invalid workbook date.');
    return item;
  }
  assert.ok(['string', 'number', 'boolean'].includes(typeof item),
    `Unsupported value or formula error at ${sheetName}!R${row}C${column}`);
  if (typeof item === 'number') assert.ok(Number.isFinite(item), 'Non-finite workbook number.');
  return item;
}
const number = (book, sheet, row, column) => {
  const item = value(book, sheet, row, column);
  assert.equal(typeof item, 'number', `Missing numeric cache at ${sheet}!R${row}C${column}`);
  return item;
};
const iso = item => {
  assert.ok(item instanceof Date, 'Expected a cached workbook date.');
  return item.toISOString().slice(0, 10);
};
const key = value(source, 'Inputs v4', 108, 2);
assert.equal(typeof key, 'string', 'Missing calibration key.');
for (let row = 6; row <= 677; row++) {
  assert.equal(String(value(recalculated, 'Checked Archive', row, 51)), '4');
  assert.equal(value(recalculated, 'Checked Archive', row, 52), key);
}

const facts = new Map(), eligibility = new Map();
for (let row = 6; row <= 6875; row += 10) {
  const date = iso(value(source, 'Dish Nights', row, 1));
  facts.set(date, Array.from({ length: 10 }, (_, j) => number(source, 'Dish Nights', row + j, 3)));
}
for (let row = 6; row <= 692; row++) {
  eligibility.set(iso(value(source, 'Nightly History', row, 1)), number(source, 'Nightly History', row, 17));
}

const proportions = [], days = [];
for (let row = 6; row <= 677; row += 8) {
  const date = iso(value(source, 'Checked Archive', row, 2));
  const expected = Array.from({ length: 8 }, (_, h) => number(source, 'Checked Archive', row + h, 4));
  assert.ok(expected[0] > 0, 'Stored volume must be positive for factorization.');
  const vector = Array.from({ length: 10 }, (_, j) => number(source, 'Checked Archive', row, 11 + j) / expected[0]);
  let which = proportions.findIndex(p => p.every((item, j) => Math.abs(item - vector[j]) < 1e-14));
  if (which < 0) { which = proportions.length; proportions.push(vector); }
  for (let h = 0; h < 8; h++) {
    for (let j = 0; j < 10; j++) {
      assert.ok(Math.abs(expected[h] * proportions[which][j] - number(source, 'Checked Archive', row + h, 11 + j)) < 1e-10,
        'Stored dish factorization differs from its original cache.');
    }
  }
  const step = (expected[7] - expected[0]) / 7;
  assert.ok(expected.every((item, h) => Math.abs(expected[0] + h * step - item) < 1e-10),
    'Stored volume vector differs from its original cache.');
  assert.ok(facts.has(date) && eligibility.has(date), `Missing source facts for ${date}`);
  days.push([date, number(source, 'Checked Archive', row, 7), eligibility.get(date),
    facts.get(date), [expected[0], step], which]);
}

function caches(book) {
  const rows = (sheet, first, last, columns) => Array.from({ length: last - first + 1 }, (_, i) =>
    Array.from({ length: columns }, (_, j) => value(book, sheet, first + i, j + 1)));
  return {
    volume: rows('Ranges', 6, 13, 12),
    dishes: rows('Ranges', 18, 97, 17),
    bias: rows('Bias Review', 6, 93, 17),
    new: Array.from({ length: 80 }, (_, i) => [Boolean(value(book, 'Dish Model v4', 6 + i, 6)),
      value(book, 'Dish Model v4', 6 + i, 8)]),
  };
}
const payload = {
  original_sha256: sha(originalBytes), recalculated_sha256: sha(recalculatedBytes),
  calibration_key: key, last_complete: iso(value(source, 'Inputs v4', 7, 2)),
  cached_z: number(source, 'Inputs v4', 42, 2),
  proportions, days, default: caches(source), empirical: caches(recalculated),
};
assert.ok(payload.empirical.volume[0][1] > 1, 'Empirical copy has not been recalculated.');
assert.equal(payload.empirical.volume[0][8], 'MEDIAN-CENTRED EMPIRICAL');
const raw = Buffer.from(JSON.stringify(payload));
const packed = brotliCompressSync(raw, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).toString('base64');
const lines = packed.match(/.{1,100}/g).join('\n');
const destination = fileURLToPath(new URL('../tests/fixtures/projection-ranges-v4.js', import.meta.url));
assert.ok(![originalPath, recalculatedPath].includes(resolve(destination)), 'Output cannot replace an input workbook.');
const output = [
  "import { brotliDecompressSync } from 'node:zlib';",
  '',
  '// Cached workbook export; reproduce with scripts/export-projection-ranges.mjs.',
  'const packed = `', lines, '`;',
  "export const rangesV4 = JSON.parse(brotliDecompressSync(Buffer.from(packed.replace(/\\s/g, ''), 'base64')).toString('utf8'));",
  '// Expand the cached archive\'s linear eight-value vectors; no model is run.',
  'rangesV4.days.forEach(row => { const [first, step] = row[4]; row[4] = Array.from({ length: 8 }, (_, h) => first + h * step); });',
  '',
].join('\n');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output, 'utf8');
console.log(JSON.stringify({ fixture: destination, bytes: raw.length, packed: packed.length,
  original_sha256: payload.original_sha256, recalculated_sha256: payload.recalculated_sha256 }, null, 2));
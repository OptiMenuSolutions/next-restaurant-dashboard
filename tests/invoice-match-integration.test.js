import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

function source(path) {
  return readFileSync(
    fileURLToPath(new URL(path, root)),
    'utf8'
  );
}

const parser = source('pages/api/invoices/parse-invoice.js');
const historical = source('lib/historicalInvoiceMatching.js');
const decisions = source('lib/invoiceMatchDecisions.js');

test('1. Invoice parser imports the shared decision engine', () => {
  assert.match(
    parser,
    /from\s+['"](?:\.\.\/)+lib\/invoiceMatchDecisions(?:\.js)?['"]/
  );
});

test('2. Invoice parser loads administrator decisions', () => {
  assert.match(
    parser,
    /loadInvoiceMatchDecisions\s*\(/
  );
});

test('3. Invoice parser applies administrator decisions', () => {
  assert.match(
    parser,
    /applyInvoiceMatchDecisions\s*\(/
  );
});

test('4. Invoice parser applies decisions before constructing final invoice lines', () => {
  const matchingPosition = parser.indexOf(
    'applyInvoiceMatchDecisions('
  );

  const outputPosition = parser.indexOf(
    'const lineItemsWithMatches'
  );

  assert.ok(matchingPosition >= 0);
  assert.ok(outputPosition > matchingPosition);
});

test('5. Locked restaurants cannot enter the automatic matching path', () => {
  assert.match(
    parser,
    /if\s*\(!matchingEnabled\)/
  );

  assert.match(
    parser,
    /matchingPolicy\.mode\s*===\s*['"]strict['"]/
  );
});

test('6. Historical matching imports the shared decision engine', () => {
  assert.match(
    historical,
    /from\s+['"]\.\/invoiceMatchDecisions(?:\.js)?['"]/
  );
});

test('7. Historical matching loads supplier-specific decisions', () => {
  assert.match(
    historical,
    /loadInvoiceMatchDecisions\s*\(/
  );

  assert.match(
    historical,
    /\.select\s*\(\s*['"]id,\s*date,\s*supplier['"]\s*\)/
  );
});

test('8. Historical matching applies decisions before selecting the ingredient', () => {
  const applicationPosition = historical.indexOf(
    'applyInvoiceMatchDecisions('
  );

  const ingredientPosition = historical.indexOf(
    'const ingredient = choice.matches[0]'
  );

  assert.ok(applicationPosition >= 0);
  assert.ok(ingredientPosition > applicationPosition);
});

test('9. Historical matching preserves physical-unit protection', () => {
  assert.match(
    historical,
    /historicalUnitCompatible\s*\(\s*line\.unit/
  );

  assert.match(
    historical,
    /choice\.status\s*!==\s*['"]auto['"]/
  );
});

test('10. Historical matching does not overwrite existing links', () => {
  assert.match(
    historical,
    /if\s*\(line\.ingredient_id\)\s*continue/
  );

  assert.match(
    historical,
    /if\s*\(line\.reviewed\)\s*continue/
  );
});

test('11. Administrator approvals are restricted to eligible ingredients', () => {
  assert.match(
    decisions,
    /eligibleIngredients\.has\s*\(\s*approvedId\s*\)/
  );
});

test('12. Administrator rejections take precedence over approvals', () => {
  assert.match(
    decisions,
    /!rejected\s*\(\s*approvedId\s*\)/
  );
});

test('13. Historical matching uses the protected database RPC', () => {
  assert.match(
    historical,
    /db\.rpc\s*\(\s*['"]link_historical_invoice_item['"]/
  );
});
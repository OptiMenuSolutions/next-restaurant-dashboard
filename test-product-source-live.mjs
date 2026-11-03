
import {
  retrieveProductSource,
} from './lib/productSourceRetrieval.js';

import {
  extractProductEvidence,
} from './lib/productEvidenceExtraction.js';

const retrieved = await retrieveProductSource(
  'https://www.knousefoodservice.com/products/strawberry-glaze-120-oz/'
);

const invoiceProduct = {
  name: 'Glaze Strawberry',
  brand: null,
  sku: '74135',
  packageCount: 3,
  containerUnit: 'can',
};

const evidence = extractProductEvidence(
  invoiceProduct,
  retrieved
);

console.log(JSON.stringify({
  retrievalStatus: retrieved.status,
  fetchRequests: retrieved.fetchRequests ?? 0,
  structuredFindings: retrieved.findings ?? null,
  source: retrieved.source ?? null,
  evidenceStatus: evidence.status,
  evidenceReason: evidence.reason,
  packageComparison: evidence.package,
  identityMatches: evidence.identityMatches ?? false,
  conversionApproved: evidence.conversionApproved,
}, null, 2));

const sourceText = retrieved.sourceDocument?.text ?? '';

const lines = sourceText.split('\n');

const relevantLines = lines
  .map((text, index) => ({ index, text: text.trim() }))
  .filter(({ text }) =>
    /FFPFR6030LKL01|2850030063|120 oz|pack size|case pack|strawberry glaze/i.test(text)
  )
  .slice(0, 30);

console.log('[source evidence]', JSON.stringify({
  sourceAvailable: Boolean(sourceText),
  sourceLength: sourceText.length,
  relevantLines,
}, null, 2));
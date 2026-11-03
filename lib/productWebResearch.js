
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL =
  process.env.PRODUCT_RESEARCH_CLAUDE_MODEL ||
  'claude-haiku-4-5-20251001';

const VALID_UNITS = new Set([
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'ml', 'l', 'gal',
  'each',
]);

export function parseResearchJSON(text) {
  const raw = String(text || '').trim();

  // Prefer a fenced JSON object when Claude includes commentary.
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);

  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through to extracting the JSON object.
    }
  }

  // Accept a response containing only JSON.
  try {
    return JSON.parse(raw);
  } catch {
    // Claude may include text before or after the JSON.
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}


export function classifyProductResearch(raw, sources = []) {
  const empty = {
    status: 'needs_review',
    reason: 'Research did not provide verifiable product details',
    product: null,
    measurement: null,
    sources,
  };

  if (!raw || typeof raw !== 'object') return empty;

  if (raw.match_status === 'not_found') {
    return {
      ...empty,
      status: 'not_found',
      reason: raw.reason || 'Product not found',
    };
  }

  const product = {
    name: raw.product_name || null,
    brand: raw.brand || null,
    manufacturerSku: raw.manufacturer_sku || null,
    supplierSku: raw.supplier_sku || null,
    packageCount: raw.package_count ?? null,
  };

  const quantity = Number(raw.net_quantity);
  const unit = String(raw.net_unit || '').trim().toLowerCase();

  const measurementValid =
    raw.net_quantity !== null &&
    raw.net_quantity !== undefined &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    VALID_UNITS.has(unit) &&
    raw.measurement_scope === 'per_container';

  const measurement = measurementValid
    ? {
        quantity,
        unit,
        scope: 'per_container',
      }
    : null;

  const exactMatch =
    raw.match_status === 'exact_match' &&
    raw.identity_evidence === 'exact_identifier' &&
    Boolean(product.name) &&
    Boolean(product.brand) &&
    Boolean(
      product.manufacturerSku || product.supplierSku
    ) &&
    Number.isSafeInteger(Number(product.packageCount)) &&
    Number(product.packageCount) > 0;

  if (!exactMatch || !measurement || sources.length === 0) {
    return {
      status: 'needs_review',
      reason: raw.reason ||
        'Exact product, measurement, or cited source is missing',
      product,
      measurement: null,
      proposedMeasurement: measurement,
      sources,
    };
  }

  return {
    status: 'verified_candidate',
    reason: 'Exact product and measurement reported with citations',
    product,
    measurement,
    sources,
  };
}


export function extractProductResearchSources(blocks = []) {
  const sources = [];
  const searchResults = [];

  const addSource = (item) => {
    if (
      typeof item?.url !== 'string' ||
      !/^https?:\/\//i.test(item.url)
    ) {
      return;
    }

    if (!sources.some((source) => source.url === item.url)) {
      sources.push({
        url: item.url,
        title: item.title || null,
      });
    }
  };

  for (const block of blocks) {
    if (block.type === 'web_search_tool_result') {
      for (const result of block.content || []) {
        if (result.type !== 'web_search_result') continue;

        if (
          typeof result.url !== 'string' ||
          !/^https?:\/\//i.test(result.url)
        ) {
          continue;
        }

        if (!searchResults.some((item) => item.url === result.url)) {
          searchResults.push({
            url: result.url,
            title: result.title || null,
            pageAge: result.page_age || null,
          });
        }
      }
    }

    if (block.type === 'text') {
      for (const citation of block.citations || []) {
        addSource(citation);
      }
    }
  }

  return { sources, searchResults };
}

export async function researchProductOnline(product) {
  const {
    name,
    brand,
    sku,
    supplier,
    packageSize,
  } = product || {};

  if (!name || !packageSize) {
    return {
      status: 'needs_review',
      reason: 'Missing product name or package size',
      product: null,
      measurement: null,
      sources: [],
      searchesUsed: 0,
    };
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1600,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    }],
    messages: [{
      role: 'user',
      content: [
        'Research this foodservice product using web search.',
        'Search manufacturer and distributor specifications.',
        'A distributor SKU may differ from a manufacturer SKU.',
        'Only treat them as equivalent with explicit evidence.',
        'Do not substitute similar products.',
        'Do not infer net weight or volume from #10 can labels.',
        'Distinguish weight from fluid volume.',
        'Determine the net measurement PER INDIVIDUAL CONTAINER.',
        'If only a case total is available, do not assume',
        'the quantity per container without reliable evidence.',
        '',
        `Product: ${name}`,
        `Brand: ${brand || 'Unknown'}`,
        `Supplier: ${supplier || 'Unknown'}`,
        `Supplier SKU: ${sku || 'Unknown'}`,
        `Package: ${packageSize}`,
        '',
        'Return ONLY one JSON object with these fields:',
        '{',
        '  "match_status": "exact_match | uncertain | not_found",',
        '  "identity_evidence": "exact_identifier | descriptive_only | none",',
        '  "product_name": null,',
        '  "brand": null,',
        '  "manufacturer_sku": null,',
        '  "supplier_sku": null,',
        '  "package_count": null,',
        '  "net_quantity": null,',
        '  "net_unit": null,',
        '  "measurement_scope": "per_container | per_case | unknown",',
        '  "reason": ""',
        '}',
        '',
        'Use numeric values for package_count and net_quantity.',
        'Use oz, lb, g, kg for weight.',
        'Use fl oz, ml, l, gal for liquid volume.',
        'Use each for a verified item count.',
        'Use null for unknown measurements.',
        'Only report exact_match when product identity is',
        'supported by a manufacturer or distributor identifier.',
        'Cite the source supporting the measurement.',
        'Do not include explanatory text outside the JSON.',
      ].join('\n'),
    }],
  });

  const findings = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const { sources, searchResults } =
    extractProductResearchSources(response.content);

  console.log(
    '[product-research] first search result:',
    JSON.stringify(
      response.content
        .find((block) => block.type === 'web_search_tool_result')
        ?.content?.find((item) => item.type === 'web_search_result') ?? null,
      null,
      2
    )
  );

  const classified = classifyProductResearch(
    parseResearchJSON(findings),
    sources
  );

  return {
    ...classified,
    findings,
    searchResults,
    searchesUsed:
      response.usage?.server_tool_use?.web_search_requests ?? 0,
  };
}

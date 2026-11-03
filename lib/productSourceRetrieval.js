
import Anthropic from '@anthropic-ai/sdk';
import { parseResearchJSON } from './productWebResearch.js';
import { extractFetchedSourceDocument } from './productSourceDocument.js';

const MODEL =
  process.env.PRODUCT_RESEARCH_CLAUDE_MODEL ||
  'claude-haiku-4-5-20251001';

export function validateProductSourceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname
    ) {
      return {
        valid: false,
        reason: 'Source URL is not approved for retrieval',
      };
    }

    const host = url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.test') ||
      host.endsWith('.invalid') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.includes(':')
    ) {
      return {
        valid: false,
        reason: 'Private or unsupported source hostname',
      };
    }

    return {
      valid: true,
      url: url.toString(),
    };
  } catch {
    return {
      valid: false,
      reason: 'Invalid source URL',
    };
  }
}

export async function retrieveProductSource(rawUrl) {
  const validated = validateProductSourceUrl(rawUrl);

  if (!validated.valid) {
    return {
      status: 'blocked',
      reason: validated.reason,
      url: null,
      content: null,
    };
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      tools: [{
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: 1,
      }],
      messages: [{
        role: 'user',
        content: [
          'Fetch the following product source URL.',
          'You MUST use the web_fetch tool.',
          'Do not use memory or substitute another webpage.',
          '',
          validated.url,
          '',
          'Extract only product information explicitly stated',
          'on the fetched webpage.',
          'Do not infer measurements from container names.',
          'Do not substitute similar products.',
          'Do not invent identifiers or package quantities.',
          'Distinguish net weight from fluid volume.',
          'Return ONLY a JSON object with these fields:',
          '{',
          '  "product_name": null,',
          '  "brand": null,',
          '  "manufacturer_sku": null,',
          '  "supplier_sku": null,',
          '  "package_count": null,',
          '  "net_quantity": null,',
          '  "net_unit": null,',
          '  "measurement_scope": "per_container | per_case | unknown"',
          '}',
          'Use numeric quantities when explicitly documented.',
          'Use oz, lb, g, kg, fl oz, ml, l, gal, or each.',
          'Use null for missing information.',
          'If retrieval fails, return null values.',
        ].join('\n'),
      }],
    });

    const fetchBlocks = response.content.filter(
      (block) => block.type === 'web_fetch_tool_result'
    );

        const fetchedDocument = response.content
      .filter((block) => block.type === 'web_fetch_tool_result')
      .map((block) => block.content)
      .find((item) => item?.type === 'web_fetch_result');

    const findings = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const fetchRequests =
      response.usage?.server_tool_use?.web_fetch_requests ?? 0;

    if (fetchRequests === 0 || fetchBlocks.length === 0) {
      return {
        status: 'unavailable',
        reason: 'No webpage fetch result returned',
        url: validated.url,
        content: null,
        fetchRequests,
      };
    }

    const hasFetchedContent = fetchBlocks.some(
      (block) =>
        block.content?.type === 'web_fetch_result' &&
        block.content?.content?.type === 'document' &&
        block.content?.url === validated.url
    );

    if (!hasFetchedContent) {
      return {
        status: 'unavailable',
        reason: 'Webpage fetch did not return usable content',
        url: validated.url,
        content: null,
        fetchRequests,
      };
    }

    const retrievedDocument = fetchBlocks
      .map((block) => block.content)
      .find(
        (item) =>
          item?.type === 'web_fetch_result' &&
          item?.content?.type === 'document' &&
          item.url === validated.url
      );

    const parsedFindings = parseResearchJSON(findings);

    const structuredFindings =
      parsedFindings &&
      typeof parsedFindings === 'object' &&
      !Array.isArray(parsedFindings)
        ? parsedFindings
        : null;

    const sourceDocument = extractFetchedSourceDocument(
      response,
      validated.url
    );

    return {
      status: 'retrieved',
      url: validated.url,
      content: findings,
      contentOrigin: 'claude_summary',
      findings: structuredFindings,
      sourceDocument,
      source: {
        url: retrievedDocument.url,
        title: retrievedDocument.content.title ?? null,
        retrievedAt: retrievedDocument.retrieved_at ?? null,
        documentType: retrievedDocument.content.type,
        originalContentAvailable: Boolean(sourceDocument),
      },
      fetchRequests,
      verificationStatus: 'unverified',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error.message || 'Webpage fetch failed',
      url: validated.url,
      content: null,
    };
  }
}

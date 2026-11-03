
import {
  extractProductEvidence,
} from './productEvidenceExtraction.js';

import {
  evaluateProductResearch,
} from './productResearchEvidence.js';

import {
  decideProductVerification,
} from './productVerificationDecision.js';

/**
 * Research an invoice product, retrieve one cited source,
 * and evaluate the resulting evidence.
 *
 * Dependencies can be supplied for offline testing.
 *
 * This pipeline never approves a conversion.
 */
export async function researchInvoiceProduct(
  invoiceProduct,
  dependencies = {}
) {
  const review = (reason, extra = {}) => ({
    status: 'needs_review',
    reason,
    research: null,
    researchScreening: null,
    retrieval: null,
    evidence: null,
    verificationDecision: null,
    verificationStatus: 'unverified',
    conversionApproved: false,
    ...extra,
  });

  if (
    !invoiceProduct ||
    !invoiceProduct.name ||
    !invoiceProduct.packageSize
  ) {
    return review('Invoice product information is incomplete');
  }

  try {
    const researchProduct =
      dependencies.researchProductOnline ??
      (await import('./productWebResearch.js'))
        .researchProductOnline;

    const retrieveSource =
      dependencies.retrieveProductSource ??
      (await import('./productSourceRetrieval.js'))
        .retrieveProductSource;

    const research = await researchProduct(invoiceProduct);

    if (
      !research ||
      !research.findings ||
      typeof research.findings !== 'object' ||
      Array.isArray(research.findings)
    ) {
      return review(
        'Research did not return structured product findings',
        { research }
      );
    }

    
    const findings = research.findings;

    // Translate Claude's research schema into the preliminary
    // screening schema. This is not independent verification.
    const researchScreening = evaluateProductResearch(
      invoiceProduct,
      {
        brand: findings.brand,
        sku: findings.supplier_sku ??
          findings.manufacturer_sku,
        packageCount: findings.package_count,
        netQuantity: findings.net_quantity,
        netUnit: findings.net_unit,
        measurementScope: findings.measurement_scope,
        sourceType: null,
        sourceUrl: null,
        evidenceText: null,
        skuCrossReference:
          findings.supplier_sku &&
          findings.manufacturer_sku
            ? {
                supplierSku: findings.supplier_sku,
                manufacturerSku: findings.manufacturer_sku,
              }
            : null,
      }
    );

    // Use a cited research source, not an arbitrary
    // search result or URL invented by Claude.
    const candidateSource = (research.sources ?? [])
      .find(
        (source) =>
          typeof source?.url === 'string' &&
          source.url.startsWith('https://')
      );

    if (!candidateSource) {
      return review(
        'Research did not provide an HTTPS cited source',
        { research, researchScreening }
      );
    }

    const retrieval = await retrieveSource(candidateSource.url);

    if (
      retrieval?.status !== 'retrieved' ||
      !retrieval.sourceDocument ||
      retrieval.sourceDocument.origin !== 'anthropic_web_fetch' ||
      retrieval.sourceDocument.url !== candidateSource.url
    ) {
      return review(
        'Cited source could not be independently retrieved',
        { research, researchScreening, retrieval }
      );
    }

    const evidence = extractProductEvidence(
      invoiceProduct,
      {
        findings: research.findings,
        source: {
          url: candidateSource.url,
          title: candidateSource.title ?? null,
        },
      },
      retrieval.sourceDocument
    );

    const verificationDecision =
      decideProductVerification(evidence);

    return {
      status: verificationDecision.status,
      reason: verificationDecision.reason,
      research,
      researchScreening,
      retrieval,
      evidence,
      verificationDecision,
      verificationStatus: 'unverified',
      conversionApproved: false,
    };
  } catch (error) {
    return review(
      'Product research pipeline failed',
      {
        error: error instanceof Error
          ? error.message
          : 'Unknown error',
      }
    );
  }
}

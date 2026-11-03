
import {
  extractProductEvidence,
} from './productEvidenceExtraction.js';

import {
  evaluateProductResearch,
} from './productResearchEvidence.js';

import {
  decideProductVerification,
} from './productVerificationDecision.js';

import {
  verifyDirectSupplierProduct,
} from './productDirectSupplierVerification.js';

import {
  TRUSTED_PRODUCT_SUPPLIERS,
} from './productTrustedSuppliers.js';

import {
  evaluateProductSourceConsensus,
} from './productSourceConsensus.js';

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


    // Evaluate distinct cited HTTPS sources independently.
    // Bound retrieval to avoid uncontrolled API usage.
    const candidates = [
      ...new Map(
        (research.sources ?? [])
          .filter((source) => {
            if (typeof source?.url !== 'string') return false;

            try {
              const url = new URL(source.url);
              return (
                url.protocol === 'https:' &&
                !url.username &&
                !url.password &&
                !url.port
              );
            } catch {
              return false;
            }
          })
          .map((source) => [source.url, source])
      ).values(),
    ];

    if (candidates.length === 0) {
      return review(
        'Research did not provide an HTTPS cited source',
        { research, researchScreening }
      );
    }

    // Fail closed if research exceeds the evaluation limit.
    // Do not approve based on an incomplete source set.
    if (candidates.length > 5) {
      return review(
        'More than five cited sources require evaluation',
        { research, researchScreening }
      );
    }

    const sourceResults = [];

    for (const candidate of candidates) {
      let retrieval;

      try {
        retrieval = await retrieveSource(candidate.url);
      } catch (error) {
        retrieval = {
          status: 'unavailable',
          reason: error instanceof Error
            ? error.message
            : 'Source retrieval failed',
        };
      }

      const validDocument =
        retrieval?.status === 'retrieved' &&
        retrieval.sourceDocument?.origin ===
          'anthropic_web_fetch' &&
        retrieval.sourceDocument.url === candidate.url &&
        typeof retrieval.sourceDocument.text === 'string' &&
        retrieval.sourceDocument.text.trim();

      if (!validDocument) {
        sourceResults.push({
          url: candidate.url,
          retrieval,
          evidence: null,
          preliminaryDecision: null,
          directSupplierDecision: null,
        });
        continue;
      }

      const evidence = extractProductEvidence(
        invoiceProduct,
        {
          findings: research.findings,
          source: {
            url: candidate.url,
            title: candidate.title ?? null,
          },
        },
        retrieval.sourceDocument
      );

      const preliminaryDecision =
        decideProductVerification(evidence);

      const directSupplierDecision =
        verifyDirectSupplierProduct({
          invoiceProduct,
          evidence,
          sourceDocument: retrieval.sourceDocument,
          trustedSuppliers: TRUSTED_PRODUCT_SUPPLIERS,
        });

      sourceResults.push({
        url: candidate.url,
        retrieval,
        evidence,
        preliminaryDecision,
        directSupplierDecision,
      });
    }

    const consensus = evaluateProductSourceConsensus({
      invoiceProduct,
      sources: sourceResults,
      trustedSuppliers: TRUSTED_PRODUCT_SUPPLIERS,
    });

    const first = sourceResults[0];

    // Preserve the original single-source fields.
    const verificationDecision =
      consensus.conversionApproved
        ? consensus
        : first?.preliminaryDecision ?? {
            status: 'needs_review',
            reason: consensus.reason,
            conversionApproved: false,
            conversion: null,
          };

    return {
      status: consensus.status,
      reason: consensus.reason,
      research,
      researchScreening,
      retrieval: first?.retrieval ?? null,
      evidence: first?.evidence ?? null,
      verificationDecision,
      directSupplierDecision:
        first?.directSupplierDecision ?? null,
      sourceResults,
      sourceConsensus: consensus,
      verificationStatus:
        consensus.conversionApproved
          ? 'verified'
          : 'unverified',
      conversionApproved:
        consensus.conversionApproved === true,
      conversion:
        consensus.conversionApproved
          ? consensus.conversion
          : null,
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

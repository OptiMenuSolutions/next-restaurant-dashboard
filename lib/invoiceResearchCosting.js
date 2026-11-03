
import { parseNumberedCanPack } from './invoicePackageSize.js';
import { calculateVerifiedInvoiceCost } from './verifiedInvoiceCosting.js';

export async function resolveInvoiceResearchCost(
  item,
  supplier,
  {
    enabled = false,
    researchProduct = null,
  } = {}
) {
  const numberedCan =
    !item.catch_weight &&
    parseNumberedCanPack(item.pack_size_raw);

  // Ordinary products retain their existing calculation.
  if (!numberedCan) {
    return calculateVerifiedInvoiceCost(item);
  }

  const unresolved = () =>
    calculateVerifiedInvoiceCost(item);

  // Do not research or approve anything without explicit
  // server-side enablement.
  if (!enabled) return unresolved();

  const sku = String(
    item.supplier_sku ??
    item.sku ??
    item.item_code ??
    ''
  ).trim();

  const brand = String(item.brand ?? '').trim();
  const name = String(
    item.item_name_normalized ??
    item.item_name ??
    ''
  ).trim();

  const supplierName = String(supplier ?? '').trim();

  if (!sku || !brand || !name || !supplierName) {
    return unresolved();
  }

  const invoiceProduct = {
    name,
    supplier: supplierName,
    sku,
    brand,
    packageSize: item.pack_size_raw,
    packageCount: numberedCan.pack,
    containerUnit: 'can',
  };

  try {
    const research = researchProduct ??
      (await import('./productResearchPipeline.js'))
        .researchInvoiceProduct;

    // This result is created on the server.
    // Never use item.conversion, item.verificationStatus,
    // or item.conversionApproved as authorization.
    const result = await research(invoiceProduct);

    if (
      result?.status !== 'verified' ||
      result?.verificationStatus !== 'verified' ||
      result?.conversionApproved !== true ||
      result?.sourceConsensus?.conversionApproved !== true
    ) {
      return unresolved();
    }

    return calculateVerifiedInvoiceCost(item, result);
  } catch {
    // Research failure must never invent a package quantity.
    return unresolved();
  }
}

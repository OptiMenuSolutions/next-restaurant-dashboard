// pages/api/invoices/confirm-invoice.js
// Auto-save invoice data after parse — no longer requires user confirmation.
// Writes to: invoices, invoice_items, ingredients.
// Stores original_quantity / original_price so the admin review screen can
// show what Claude parsed vs what was manually corrected.

import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import {
  processInvoiceCalculations,
} from '../../../lib/admin/processInvoiceCalculations.js';
import {
  prepareInvoiceSourceEvidence,
  saveInvoiceSourceEvidence,
} from '../../../lib/invoiceSourceEvidenceStorage.js';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';
import {
  calculateStandardizedCost,
} from '../../../lib/standardizedUnits';
import {
  safeInvoiceStandardPrice,
} from '../../../lib/safeInvoicePricing';
import {
  getInvoiceEffectiveDate,
  isDeliveredInvoice,
  isManuallyApprovedPrice,
} from '../../../lib/invoiceRepricing';
import { isInternalCall } from '../../../lib/scannerAuth';
import { parseNumberedCanPack } from '../../../lib/invoicePackageSize';
import {
  validateConfirmedInvoiceSource,
} from '../../../lib/invoiceSourceConfirmation.js';
import {
  getInvoiceDocumentFingerprint,
} from '../../../lib/invoiceSourceDocument.js';
import {
  resolveInvoiceResearchCost,
} from '../../../lib/invoiceResearchCosting';
import {
  buildInvoicePurchasePricing,
} from '../../../lib/invoicePurchasePricing.js';
import {
  getProgressiveInvoiceMatchingPolicy,
  findStrictDirectMatch,
} from '../../../lib/progressiveInvoiceMatching';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function createConfirmInvoiceHandler({
  db = supabase,
  resolveCost = resolveInvoiceResearchCost,
  recompute = recomputeMenuCosts,
  rebuild = rebuildCurrentInventory,
  processCalculations = processInvoiceCalculations,
  scheduleCalculations = waitUntil,
  verifyAccess = async (req, restaurantId) =>
    import('../../../lib/withRestaurantAuth')
      .then(m => m.verifyRestaurantAccess(req, restaurantId)),
} = {}) {
  return async function handler(req, res) {
    const supabase = db;
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const {
    restaurant_id,
    invoice,
    line_items,
    file_urls,
    file_url,
    ocr_text,
    append_to_invoice_id,
    confirmation_request_id,
  } = body;

  // Support both old single file_url and new file_urls array
  const allFileUrls = file_urls?.length
    ? file_urls
    : file_url ? [file_url] : [];

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!invoice)       return res.status(400).json({ error: 'invoice data is required' });

  // Request identity is informational until the new
  // transactional confirmation workflow is activated.
  // Never use it to authorize an invoice or pricing change.

  if (
    confirmation_request_id !== undefined &&
    (
      typeof confirmation_request_id !== 'string' ||
      confirmation_request_id.length < 16 ||
      confirmation_request_id.length > 128
    )
  ) {
    return res.status(400).json({
      error: 'Invalid confirmation request ID.',
    });
  }

  // Verify the calling user owns this restaurant. Scanner photos come from
  // /api/scanner/process, which has already checked the scanner.
  if (!isInternalCall(req)) {
    const { error: authError, status: authStatus } =
      await verifyAccess(req, restaurant_id);
    if (authError) return res.status(authStatus).json({ error: authError });
  }

  let matchingPolicy;

  try {
    matchingPolicy = await getProgressiveInvoiceMatchingPolicy(
      supabase,
      restaurant_id
    );
  } catch (error) {
    console.error('[confirm-invoice] Matching policy:', error);

    return res.status(503).json({
      error: 'Invoice matching controls are unavailable. Please retry.',
    });
  }

  const matchingEnabled = matchingPolicy.matching_enabled;

  // Normalize recognized numbered-can packages before any ingredient
  // pricing, inventory quantity, or invoice line calculations.
  // This applies to every restaurant and supplier.
  const activeItems = (line_items || [])
    .filter(i => !i.dismissed)
    .map(item => {
      const parsedPack = parseNumberedCanPack(item.pack_size_raw);

      if (!parsedPack) return item;

      // Catch-weight products follow their own weight-based accounting.
      if (item.catch_weight) return item;

      // A numbered-can designation describes the container, not
      // its fluid volume. Preserve the original raw package text.
      return {
        ...item,
        pack: parsedPack.pack,
        size: parsedPack.size,
        size_unit: parsedPack.size_unit,
      };
    });
    
  // Explicit server-side feature flag.
  // Disabled by default: no research calls or automatic approvals.
  const researchEnabled =
    process.env.INVOICE_VERIFIED_RESEARCH_ENABLED === 'true';

  // Resolve costs once per invoice line so ingredient pricing
  // and invoice history use exactly the same calculation.
  // These results are never taken from client approval fields.
  const resolvedCosts = await Promise.all(
    activeItems.map(item =>
      resolveCost(
        item,
        invoice.supplier,
        { enabled: researchEnabled }
      )
    )
  );

    // Diagnose unresolved invoice costs without changing pricing behavior.
  activeItems.forEach((item, index) => {
    const result = resolvedCosts[index];

    if (result?.unit_cost != null) return;

    console.warn('[invoice-cost-diagnostic]', {
      invoice_number: invoice.invoice_number,
      item_name: item.item_name_normalized || item.item_name_raw,
      pack_size_raw: item.pack_size_raw ?? null,
      quantity_shipped: item.quantity_shipped ?? null,
      pack: item.pack ?? null,
      size: item.size ?? null,
      size_unit: item.size_unit ?? null,
      invoice_price: item.invoice_price ?? null,
      line_total: item.line_total ?? null,
      pricing_status: result?.pricingStatus ?? null,
    });
  });

  const costByItem = new Map(
    activeItems.map((item, index) => [
      item,
      resolvedCosts[index],
    ])
  );

  const resolvedCost = (item) =>
    costByItem.get(item);

  // Finding #020: Authenticate source-supported pricing.
  //
  // This stage validates evidence only.
  //
  // It does not write evidence records, approve prices,
  // or modify the existing ingredient repricing rules.
  //
  // Evidence persistence will be enabled only after
  // the database migration and safeguards are complete.

  // ============================================================
  // Finding #020: Independent document verification
  // ============================================================
  //
  // Source proofs authenticate the extraction values.
  // This additional step independently authenticates
  // the original document from private Supabase Storage.
  //
  // Do not accept document fingerprints from the browser.
  //
  // Evidence persistence and invoice-supported repricing
  // remain disabled until their safeguards are complete.

  const sourceProofSecret =
    process.env.INVOICE_SOURCE_PROOF_SECRET;

  const sourceEvidenceResults = new Map();

  const hasSubmittedSourceProof = activeItems.some(
    item => Boolean(item.invoice_source_proof)
  );

  const signingConfigured = Boolean(
    sourceProofSecret &&
    sourceProofSecret.length >= 32
  );

  let documentVerification = {
    verified: false,
    reason: 'verification_not_requested',
    fingerprint: null,
  };

  if (signingConfigured && hasSubmittedSourceProof) {
    documentVerification =
      await getInvoiceDocumentFingerprint({
        db: supabase,
        restaurantId: restaurant_id,
        filePaths: allFileUrls,
      });
  }

  if (
    signingConfigured &&
    documentVerification.verified
  ) {
    for (const item of activeItems) {
      const result = validateConfirmedInvoiceSource({
        item,
        resolvedCost: resolvedCost(item),
        restaurantId: restaurant_id,
        invoiceNumber: String(
          invoice.invoice_number || ''
        ).trim(),
        documentFingerprint:
          documentVerification.fingerprint,
        secret: sourceProofSecret,
      });

      sourceEvidenceResults.set(item, result);
    }
  }

  const acceptedSourceEvidence = [
    ...sourceEvidenceResults.values(),
  ].filter(result => result.accepted).length;

  const rejectedSourceEvidence = [
    ...sourceEvidenceResults.values(),
  ].filter(
    result =>
      !result.accepted &&
      result.reason !== 'missing_proof'
  ).length;

  console.info('[invoice-source-confirmation]', {
    restaurantId: restaurant_id,
    invoiceNumber: invoice.invoice_number || null,
    signingConfigured,
    documentVerified: documentVerification.verified,
    documentVerificationReason:
      documentVerification.reason,
    acceptedSourceEvidence,
    rejectedSourceEvidence,
    evidencePersistenceEnabled: false,
  });

  // Preserve the original invoice date separately from
  // the operational delivery date.
  //
  // Never use the upload date to invent a delivery date.
  const validInvoiceDate = (value) => {
    if (value == null || value === '') return null;

    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return null;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    ) ? value : null;
  };

  const originalInvoiceDate = validInvoiceDate(
    invoice.invoice_date
  );

  const submittedDeliveryDate = validInvoiceDate(
    invoice.delivery_date
  );

  if (
    (invoice.invoice_date != null &&
      invoice.invoice_date !== '' &&
      !originalInvoiceDate) ||
    (invoice.delivery_date != null &&
      invoice.delivery_date !== '' &&
      !submittedDeliveryDate)
  ) {
    return res.status(422).json({
      error: 'Invoice or delivery date is invalid.',
    });
  }

  const deliveryDateStatus = invoice.delivery_date_status;

  if (
    deliveryDateStatus != null &&
    (
      !['explicit', 'not_printed'].includes(deliveryDateStatus) ||
      (
        deliveryDateStatus === 'explicit' &&
        !submittedDeliveryDate
      )
    )
  ) {
    return res.status(422).json({
      error:
        'The delivery date needs review before this invoice can be saved.',
      code: 'DELIVERY_DATE_REVIEW_REQUIRED',
    });
  }

  const deliveryDate =
    submittedDeliveryDate || originalInvoiceDate;

  // Existing calculation pathways still use invoiceDate
  // until delivery-date processing is updated in Step 22.4.
  const invoiceDate =
    originalInvoiceDate ||
    new Date().toISOString().split('T')[0];

  const appendMode = !!append_to_invoice_id;
  let purchaseDate = deliveryDate;
  const pricingAsOfDate = new Date().toISOString().slice(0, 10);

  // Verify ownership independently of the invoice parser.
  // Client-submitted ingredient IDs cannot expand matching eligibility.

  const requestedIngredientIds = matchingEnabled
    ? [...new Set(
        activeItems
          .map(item => item.selected_ingredient_id)
          .filter(Boolean)
      )]
    : [];

  const ownedIngredients = new Map();

  if (requestedIngredientIds.length) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, unit')
      .eq('restaurant_id', restaurant_id)
      .in('id', requestedIngredientIds);

    if (error) {
      return res.status(503).json({
        error: 'Could not verify ingredient ownership.',
      });
    }

    for (const ingredient of data || []) {
      ownedIngredients.set(ingredient.id, ingredient);
    }

    if (ownedIngredients.size !== requestedIngredientIds.length) {
      return res.status(400).json({
        error: 'An invoice ingredient does not belong to this restaurant.',
      });
    }
  }

  let strictEligibleIngredients = [];

  if (matchingPolicy.mode === 'strict') {
    const eligibleIds = [
      ...matchingPolicy.eligibleIngredientIds,
    ];

    if (eligibleIds.length) {
      const { data, error } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .eq('restaurant_id', restaurant_id)
        .in('id', eligibleIds);

      if (error) {
        return res.status(503).json({
          error: 'Could not verify confirmed recipe ingredients.',
        });
      }

      strictEligibleIngredients = data || [];

      if (
        strictEligibleIngredients.length !== eligibleIds.length
      ) {
        return res.status(503).json({
          error: 'Confirmed recipe ingredient references are incomplete.',
        });
      }
    }
  }

  const permittedIngredientId = item => {
    if (!matchingEnabled) return null;

    const requestedId = item.selected_ingredient_id;

    if (
      !requestedId ||
      !ownedIngredients.has(requestedId)
    ) {
      return null;
    }

    if (matchingPolicy.mode !== 'strict') {
      return requestedId;
    }

    // Recompute the direct match on the server.
    // Never accept a submitted ID merely because it belongs
    // to a restaurant or appeared in the browser's candidates.
    const result = findStrictDirectMatch(
      item.item_name_normalized ||
        item.item_name_raw ||
        item.item_name,
      strictEligibleIngredients
    );

    if (
      result.status !== 'auto' ||
      result.matches[0]?.id !== requestedId
    ) {
      return null;
    }

    return requestedId;
  };

  const results = {
    invoice_id:           null,
    items_saved:          0,
    ingredients_created:  0,
    ingredients_updated:  0,
    errors:               [],
  };

  // Transactional evidence persistence requires both:
  // 1. An explicit global feature flag.
  // 2. An exact restaurant allowlist match.
  //
  // A missing or empty allowlist fails closed.
  // All other restaurants retain legacy confirmation.

  const evidencePersistenceAllowedRestaurantId =
    (
      process.env
        .INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID ||
      ''
    ).trim();

  const evidencePersistenceEnabled =
    process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_ENABLED === 'true' &&
    evidencePersistenceAllowedRestaurantId.length > 0 &&
    restaurant_id === evidencePersistenceAllowedRestaurantId;

  // Legacy invoice confirmation remains unchanged.
  // The transactional pathway requires a stable request identity.

  if (
    evidencePersistenceEnabled &&
    (
      !confirmation_request_id ||
      typeof confirmation_request_id !== 'string' ||
      confirmation_request_id.length < 16 ||
      confirmation_request_id.length > 128
    )
  ) {
    return res.status(400).json({
      error: 'A valid confirmation request ID is required.',
    });
  }

  if (
    evidencePersistenceEnabled &&
    (!sourceProofSecret || sourceProofSecret.length < 32)
  ) {
    return res.status(503).json({
      error: 'Invoice evidence authentication is not configured.',
    });
  }

  try {
    // ── Step 1: Prepare or create the invoice record ──────────────────────────

    let invoiceRecord;

    if (evidencePersistenceEnabled) {

      // The new pathway generates the identity without
      // creating a database record yet.
      //
      // The transactional RPC will create or lock
      // the actual parent invoice.

      invoiceRecord = {
        id: appendMode
          ? append_to_invoice_id
          : randomUUID(),
      };

      results.invoice_id = invoiceRecord.id;

    } else if (appendMode) {
      const { data: existingInvoice, error: existingInvoiceError } =
        await supabase
          .from('invoices')
          .select('id, restaurant_id, date, delivery_date')
          .eq('id', append_to_invoice_id)
          .eq('restaurant_id', restaurant_id)
          .maybeSingle();

      if (existingInvoiceError) {
        throw new Error(
          'Could not verify the invoice being appended.'
        );
      }

      if (!existingInvoice) {
        return res.status(404).json({
          error: 'Invoice not found for this restaurant.',
        });
      }

      const parentDeliveryDate =
        existingInvoice.delivery_date ??
        existingInvoice.date ??
        null;

      if (
        submittedDeliveryDate &&
        deliveryDateStatus !== 'not_printed' &&
        submittedDeliveryDate !== parentDeliveryDate
      ) {
        return res.status(409).json({
          success: false,
          code: 'APPEND_DELIVERY_DATE_CONFLICT',
          error:
            'This page has a different delivery date from the saved invoice. Review the dates before appending it.',
        });
      }

      purchaseDate = getInvoiceEffectiveDate(existingInvoice);
      invoiceRecord = { id: existingInvoice.id };
      results.invoice_id = existingInvoice.id;

      console.log(
        `[confirm-invoice] Append mode — adding to invoice ${existingInvoice.id}`
      );
      // Bug fix: this branch never saved the new page's file reference at
      // all — only the non-append branch below did. A merged multi-page
      // invoice would silently lose every page's photo after the first,
      // and "View original" would only ever show page 1. Continue the
      // page numbering from whatever's already attached to this invoice,
      // rather than always starting at 1 (which would collide with an
      // existing page 1).
      if (allFileUrls.length > 0) {
        const { data: existingFiles } = await supabase
          .from('invoice_files')
          .select('page_number')
          .eq('invoice_id', append_to_invoice_id)
          .order('page_number', { ascending: false })
          .limit(1);
        const nextPageStart = (existingFiles?.[0]?.page_number || 0) + 1;

        const filesToInsert = allFileUrls.map((url, idx) => ({
          invoice_id:  append_to_invoice_id,
          file_url:    url,
          page_number: nextPageStart + idx,
        }));
        const { error: filesError } = await supabase
          .from('invoice_files')
          .insert(filesToInsert);
        if (filesError) {
          results.errors.push('Failed to save file URLs: ' + filesError.message);
        }
      }
    } else {
      const { data, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          restaurant_id,
          supplier:   invoice.supplier       || null,
          number:     invoice.invoice_number || null,
          date:       originalInvoiceDate,
          delivery_date: deliveryDate,
          amount:     invoice.total_amount   || null,
          non_food_total: invoice.non_food_total ?? null,
          tax_amount:     invoice.tax_amount     ?? null,
          fees_amount:    invoice.fees_amount    ?? null,
          file_url:   allFileUrls[0]         || null, // keep for backwards compat
          ocr_text:   ocr_text               || null,
          reviewed:   false,
          is_sample:  false,
        })
        .select('id')
        .single();

      if (invoiceError) {
        return res.status(500).json({ error: 'Failed to create invoice: ' + invoiceError.message });
      }
      invoiceRecord      = data;
      results.invoice_id = data.id;

      // Insert all file URLs into invoice_files
      if (allFileUrls.length > 0) {
        const filesToInsert = allFileUrls.map((url, idx) => ({
          invoice_id:  data.id,
          file_url:    url,
          page_number: idx + 1,
        }));
        const { error: filesError } = await supabase
          .from('invoice_files')
          .insert(filesToInsert);
        if (filesError) {
          results.errors.push('Failed to save file URLs: ' + filesError.message);
        }
      }
    }

    // ── Step 2: Ingredient creation is recipe-owned ───────────────────────────
    // Invoice lines can only reference previously validated ingredients.

    // ── Step 3: Preserve existing ingredient pricing ─────────────────────────
    //
    // New invoice lines are initially unverified.
    // Mathematical unit compatibility alone is not sufficient
    // evidence to update an ingredient's financial cost.
    //
    // The verified-price workflow will populate provenance
    // and subsequently reprice eligible ingredients.
    //
    // Until then, existing ingredient prices are preserved.

    const ingredientUpdates = {};
    const deliveredForPricing = isDeliveredInvoice(
      { delivery_date: purchaseDate },
      pricingAsOfDate
    );

    for (const item of activeItems) {
      const ingredientId = permittedIngredientId(item);
      if (!ingredientId || !deliveredForPricing) continue;

      const cost = resolvedCost(item);
      const verification = cost?.priceVerification;

      // Only trusted server-side verification results
      // can authorize automatic ingredient repricing.
      if (
        cost?.pricingStatus !== 'verified' ||
        verification?.status !== 'verified' ||
        verification?.source !== 'authenticated_supplier_record' ||
        !verification?.evidence
      ) {
        continue;
      }

      const standardized = safeInvoiceStandardPrice(
        cost.unit_cost,
        cost.unit
      );

      if (!standardized) continue;

      ingredientUpdates[ingredientId] = {
        last_price: standardized.price,
        unit: standardized.unit,
        standard_unit: standardized.unit,
        last_ordered_at: purchaseDate,
        is_estimated: false,
        price_status: 'invoice',
      };
    }

    // Never roll ingredient prices back to an older date.
    const updateIds = Object.keys(ingredientUpdates);

    if (updateIds.length) {
      const { data: current, error: currentError } =
        await supabase
          .from('ingredients')
          .select('id, last_ordered_at, price_status, price_approved_at')
          .in('id', updateIds)
          .eq('restaurant_id', restaurant_id);

      if (currentError) throw currentError;

      for (const ingredient of current || []) {
        if (
          isManuallyApprovedPrice(ingredient) ||
          (
            ingredient.last_ordered_at &&
            String(ingredient.last_ordered_at).slice(0, 10) >
              String(purchaseDate).slice(0, 10)
          )
        ) {
          delete ingredientUpdates[ingredient.id];
        }
      }
    }

    // ── Step 4: Batch-insert all invoice_items ────────────────────────────────
    // Store original_quantity / original_price so the admin review screen can
    // highlight values that were changed vs what Claude originally parsed.
    // Finding #020:
    // Assign IDs before insertion so each source proof can
    // be associated with its exact saved invoice item.
    //
    // The IDs are generated by the server, not the browser.

    const invoiceItemIds = activeItems.map(() => randomUUID());

    const invoiceItemsToInsert = activeItems.map((item, index) => {
      const ingredientId = permittedIngredientId(item);

      const {
        quantity: totalQty,
        unit,
        unit_cost,
      } = resolvedCost(item);

      const purchasePricing = buildInvoicePurchasePricing(
        item,
        resolvedCost(item)
      );

      return {
        ...purchasePricing,
        id:                         invoiceItemIds[index],
        invoice_id:                 invoiceRecord.id,
        item_name:                  item.item_name_normalized || item.item_name,
        quantity:                   totalQty,
        unit:                       unit,
        unit_cost:                  unit_cost,
        amount:                     item.line_total ?? null,
        ingredient_name_normalized: normalizeName(item.item_name_normalized || item.item_name),
        category:                   item.category || null,
        ingredient_id:              ingredientId,
        reviewed:                   false,
        original_quantity:          totalQty,
        original_price:             unit_cost,

        // Invoice parsing is not supplier authentication.
        // Never trust client-submitted verification fields.
        price_verification_status:
          resolvedCost(item)?.priceVerification?.status === 'verified'
            ? 'verified'
            : 'unknown',

        price_verification_source:
          resolvedCost(item)?.priceVerification?.source || null,

        price_verified_at:
          resolvedCost(item)?.priceVerification?.verifiedAt || null,

        price_verified_by: null,

        price_verification_evidence:
          resolvedCost(item)?.priceVerification?.evidence || null,
        // The matcher's best guesses for a line it was unsure about, shown as
        // one-tap choices when linking. Only kept on lines left unlinked.
        match_candidates:
          matchingEnabled &&
          !ingredientId &&
          Array.isArray(item.match_candidates) &&
          item.match_candidates.length
            ? item.match_candidates
                .slice(0, 3)
                .filter(candidate =>
                  candidate &&
                  candidate.id &&
                  candidate.name
                )
                .map(candidate => ({
                  id: candidate.id,
                  name: candidate.name,
                }))
            : null,
      };
    });

    // ============================================================
    // Finding #020: Transactional invoice persistence
    // ============================================================
    //
    // Disabled by default.
    //
    // When enabled, invoice lines and authenticated source
    // evidence are inserted together through one PostgreSQL
    // transaction.
    //
    // When disabled, the existing invoice insertion behavior
    // remains unchanged.
    //
    // Invoice-supported ingredient repricing is NOT enabled.

    if (evidencePersistenceEnabled) {

      // ----------------------------------------------------------
      // 1. Verify evidence authentication configuration
      // ----------------------------------------------------------

      if (
        !sourceProofSecret ||
        sourceProofSecret.length < 32
      ) {
        return res.status(503).json({
          success: false,
          invoice_id: results.invoice_id,
          error:
            'Invoice evidence authentication is not configured.',
        });
      }

      // A submitted proof must have passed independent
      // server-side document verification.

      if (
        hasSubmittedSourceProof &&
        !documentVerification.verified
      ) {
        return res.status(422).json({
          success: false,
          invoice_id: results.invoice_id,
          error:
            'The original invoice document could not be authenticated.',
        });
      }

      // Reject any submitted proof that did not pass
      // cryptographic and costing validation.

      if (
        hasSubmittedSourceProof &&
        rejectedSourceEvidence > 0
      ) {
        return res.status(422).json({
          success: false,
          invoice_id: results.invoice_id,
          error:
            'One or more invoice source proofs failed authentication.',
        });
      }

      // ----------------------------------------------------------
      // 2. Prepare evidence for the exact invoice-item IDs
      // ----------------------------------------------------------

      const authenticatedEvidenceRecords = [];

      for (
        let index = 0;
        index < activeItems.length;
        index++
      ) {
        const item = activeItems[index];

        const confirmation =
          sourceEvidenceResults.get(item);

        // Unsupported invoice lines can still be saved,
        // but never receive authenticated evidence.

        if (!confirmation?.accepted) {
          continue;
        }

        const savedLine = {
          ...invoiceItemsToInsert[index],
          restaurant_id,
        };

        const prepared = prepareInvoiceSourceEvidence({
          savedLine,
          invoiceId: invoiceRecord.id,
          restaurantId: restaurant_id,
          confirmation,
          proof: item.invoice_source_proof,
        });

        if (!prepared.accepted) {
          return res.status(422).json({
            success: false,
            invoice_id: results.invoice_id,
            error:
              'Authenticated invoice evidence does not match its saved pricing.',
          });
        }

        authenticatedEvidenceRecords.push(
          prepared.record
        );
      }

      // Every submitted proof must correspond to exactly
      // one authenticated evidence record.

      const submittedProofCount = activeItems.filter(
        item => Boolean(item.invoice_source_proof)
      ).length;

      if (
        authenticatedEvidenceRecords.length !==
        submittedProofCount
      ) {
        return res.status(422).json({
          success: false,
          invoice_id: results.invoice_id,
          error:
            'Invoice source evidence is incomplete.',
        });
      }

      // ----------------------------------------------------------
      // 3. Prepare the complete invoice confirmation payload
      // ----------------------------------------------------------

      const invoicePayload = {
        id: invoiceRecord.id,
        supplier: invoice.supplier || null,
        number: invoice.invoice_number || null,
        date: originalInvoiceDate,
        delivery_date: deliveryDate,
        delivery_date_status:
          deliveryDateStatus ??
          (submittedDeliveryDate ? 'explicit' : 'not_printed'),
        amount: invoice.total_amount ?? null,
        non_food_total: invoice.non_food_total ?? null,
        tax_amount: invoice.tax_amount ?? null,
        fees_amount: invoice.fees_amount ?? null,
        file_url: allFileUrls[0] || null,
        ocr_text: ocr_text || null,
      };

      // The confirmation fingerprint must not depend
      // on freshly generated invoice or line-item UUIDs.
      //
      // A retry of the same submitted content must
      // produce the same fingerprint.

      const confirmationFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            version: 1,
            restaurant_id,
            request_id: confirmation_request_id,
            append_to_invoice_id:
              append_to_invoice_id || null,
            invoice: {
              ...invoicePayload,
              id: null,
            },
            files: allFileUrls,
            lines: invoiceItemsToInsert.map(
              ({ id, invoice_id, ...line }) => line
            ),
            source_proofs: activeItems.map(
              item => item.invoice_source_proof || null
            ),
          })
        )
        .digest('hex');

      // Supplier-verified ingredient updates currently
      // occur outside this PostgreSQL transaction.
      //
      // Do not silently skip them or permit a partially
      // transactional save until that path is integrated.

      // ----------------------------------------------------------
      // 4. Save the complete invoice atomically
      // ----------------------------------------------------------

      const {
        data: transactionResult,
        error: transactionError,
      } = await supabase.rpc(
        'save_invoice_confirmation_transactional',
        {
          p_restaurant_id: restaurant_id,
          p_request_id: confirmation_request_id,
          p_request_fingerprint: confirmationFingerprint,
          p_append_to_invoice_id:
            appendMode ? append_to_invoice_id : null,
          p_invoice: invoicePayload,
          p_files: allFileUrls,
          p_lines: invoiceItemsToInsert,
          p_evidence: authenticatedEvidenceRecords,

          // Queue recalculation in the same database
          // transaction as invoice persistence.
          //
          // Locked restaurants cannot trigger linked
          // ingredient or inventory processing.

          p_queue_calculations:
            matchingEnabled &&
            invoiceItemsToInsert.some(
              item => Boolean(item.ingredient_id)
            ),
        }
      );

      if (transactionError) {
        console.error(
          '[confirm-invoice] Atomic confirmation failed:',
          transactionError
        );

        const fingerprintMismatch =
          /reused with different contents/i.test(
            transactionError.message || ''
          );

        const appendDateConflict =
          /Append delivery date conflicts with parent invoice/i.test(
            transactionError.message || ''
          );

        if (appendDateConflict) {
          return res.status(409).json({
            success: false,
            code: 'APPEND_DELIVERY_DATE_CONFLICT',
            error:
              'This page has a different delivery date from the saved invoice. Review the dates before appending it.',
          });
        }

        return res.status(
          fingerprintMismatch ? 409 : 500
        ).json({
          success: false,
          error: fingerprintMismatch
            ? 'This confirmation request was already used for different invoice contents.'
            : 'The invoice could not be saved transactionally.',
        });
      }

      if (
        transactionResult?.success !== true ||
        !transactionResult.invoice_id ||
        transactionResult.lines_saved !==
          invoiceItemsToInsert.length ||
        transactionResult.evidence_saved !==
          authenticatedEvidenceRecords.length
      ) {
        return res.status(500).json({
          success: false,
          error:
            'The invoice transaction returned an unexpected result.',
        });
      }

      // The database is authoritative for the invoice ID.
      // This is particularly important for successful retries.

      results.invoice_id = transactionResult.invoice_id;
      results.items_saved = transactionResult.lines_saved;

      // ----------------------------------------------------------
      // 5. Handle successful retries
      // ----------------------------------------------------------

      if (transactionResult.replayed === true) {
        console.info(
          '[invoice-confirmation-idempotent-replay]',
          {
            restaurantId: restaurant_id,
            requestId: confirmation_request_id,
            invoiceId: transactionResult.invoice_id,
          }
        );

        return res.status(200).json({
          success: true,
          invoice_id: transactionResult.invoice_id,
          items_saved: transactionResult.lines_saved,
          ingredients_created: 0,
          ingredients_updated: 0,
          errors: [],
          replayed: true,
        });
      }

      // The invoice and durable calculation job have
      // already been committed atomically.
      //
      // Attempt processing immediately after confirmation.
      // If scheduling or processing fails, the queued job
      // remains available for recovery.
      if (
        matchingEnabled &&
        invoiceItemsToInsert.some(
          item => Boolean(item.ingredient_id)
        )
      ) {
        try {
          scheduleCalculations(
            Promise.resolve()
              .then(() =>
                processCalculations(
                  supabase,
                  restaurant_id
                )
              )
              .catch(error => {
                console.error(
                  '[confirm-invoice calculations]',
                  restaurant_id,
                  error
                );
              })
          );
        } catch (error) {
          console.error(
            '[confirm-invoice scheduling]',
            restaurant_id,
            error
          );
        }
      }

      console.info(
        '[invoice-confirmation-transactional]',
        {
          restaurantId: restaurant_id,
          invoiceId: results.invoice_id,
          linesSaved: results.items_saved,
          filesSaved: transactionResult.files_saved,
          evidenceSaved: transactionResult.evidence_saved,
          replayed: false,
        }
      );

    } else {

      // ----------------------------------------------------------
      // Legacy safe persistence
      // ----------------------------------------------------------
      //
      // Preserve existing behavior until the transactional
      // workflow passes production-readiness validation.

      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(invoiceItemsToInsert);

      if (itemsError) {
        results.errors.push(
          'Failed to batch-insert invoice items: ' +
          itemsError.message
        );

        return res.status(500).json({
          success: false,
          invoice_id: results.invoice_id,
          items_saved: 0,
          ingredients_created: 0,
          ingredients_updated: 0,
          errors: results.errors,
        });
      }

      results.items_saved =
        invoiceItemsToInsert.length;
    }

    // Legacy confirmation updates supplier-verified ingredient
    // prices after saving invoice lines.
    //
    // Transactional confirmation must not perform separate
    // ingredient writes after the invoice transaction commits.
    // Its queued calculation job handles ingredient repricing.
    if (
      !evidencePersistenceEnabled &&
      matchingEnabled &&
      results.items_saved > 0
    ) {
      const updatePromises = Object.entries(ingredientUpdates).map(
        ([ingId, updates]) =>
          supabase
            .from('ingredients')
            .update(updates)
            .eq('id', ingId)
            .eq('restaurant_id', restaurant_id)
            .then(({ error }) => {
              if (error) {
                results.errors.push(
                  `Failed to update ingredient ${ingId}: ${error.message}`
                );
              } else {
                results.ingredients_updated++;
              }
            })
      );

      await Promise.all(updatePromises);
    }

    // Do not recalculate costs or inventory when ingredient pricing failed.
    // The invoice lines remain saved for later review or recovery.
    if (results.errors.length > 0) {
      return res.status(500).json({
        success: false,
        invoice_id: results.invoice_id,
        items_saved: results.items_saved,
        ingredients_created: 0,
        ingredients_updated: results.ingredients_updated,
        errors: results.errors,
      });
    }

    // ── Step 5: Recompute only when matching is enabled ───────────────────────
    // Locked restaurants retain invoice data without modifying ingredient
    // prices, recipe costs, or ingredient-linked inventory.

    if (
      !evidencePersistenceEnabled &&
      matchingEnabled &&
      results.items_saved > 0 &&
      Object.keys(ingredientUpdates).length > 0
    ) {
      try {
        await recompute(
          supabase,
          restaurant_id,
          Object.keys(ingredientUpdates),
          { effectiveDate: invoiceDate }
        );
      } catch (err) {
        results.errors.push(
          'Could not recompute dish costs: ' + err.message
        );
      }
    }

    // An invoice with permitted ingredient links may change inventory.
    // Never rebuild inventory for a locked restaurant.

    if (
      !evidencePersistenceEnabled &&
      matchingEnabled &&
      results.items_saved > 0 &&
      invoiceItemsToInsert.some(item => item.ingredient_id)
    ) {
      try {
        await rebuild(supabase, restaurant_id);
      } catch (err) {
        console.error(
          '[confirm-invoice] current_inventory rebuild failed:',
          err.message
        );
      }
    }

    return res.status(200).json({
      success:              true,
      invoice_id:           results.invoice_id,
      items_saved:          results.items_saved,
      ingredients_created:  results.ingredients_created,
      ingredients_updated:  results.ingredients_updated,
      errors:               results.errors,
    });

  } catch (err) {
    console.error('[confirm-invoice] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save invoice' });
  }
}
}

export default createConfirmInvoiceHandler();
import { loadRestaurantTimezone, restaurantLocalDate } from '../../../lib/restaurantTime.js';
import { ingredientPurchaseUnitCost } from '../../../lib/ingredientPurchasing.js';
import { isInvoiceSupportedRepricingEnabled } from '../../../lib/invoiceSupportedRepricingFlag.js';

export function createPurchaseHistoryHandler({ db, verifyOwner } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const services = !db || !verifyOwner
        ? await import('../../../lib/scannerAuth')
        : null;
      const database = db || services.admin;
      const auth = await (verifyOwner || services.requireOwner)(req);
      if (auth.error) {
        return res.status(auth.status || 401).json({ error: auth.error });
      }
      const restaurantId = auth.restaurant?.id;
      if (!restaurantId) return res.status(401).json({ error: 'Please sign in again.' });
      const today = restaurantLocalDate(await loadRestaurantTimezone(database, restaurantId));
      const readAll = async (make) => {
        const out = [];
        for (let from = 0; ; ) {
          const { data, error } = await make().range(from, from + 499);
          if (error) throw new Error(error.message);
          if (!Array.isArray(data)) throw new Error('Invalid database response.');
          if (!data.length) return out;
          out.push(...data);
          from += data.length;
        }
      };
      const allowSupported = isInvoiceSupportedRepricingEnabled(restaurantId);
      const [ingredients, items, evidence] = await Promise.all([
        readAll(() => database.from('ingredients')
          .select('id, restaurant_id, unit')
          .eq('restaurant_id', restaurantId).order('id')),
        readAll(() => database.from('invoice_items')
          .select('id, invoice_id, ingredient_id, item_name, quantity, amount, unit, unit_cost, price_verification_status, price_verification_source, price_verified_at, price_verification_evidence, invoices!invoice_items_invoice_id_fkey!inner(id, date, delivery_date, created_at, supplier, number, restaurant_id)')
          .not('ingredient_id', 'is', null)
          .eq('invoices.restaurant_id', restaurantId).order('id')),
        allowSupported
          ? readAll(() => database.from('invoice_supported_price_evidence')
              .select('id, invoice_item_id, invoice_id, restaurant_id, source_type, validation_status, evidence_version, invalidated_at, invalidation_reason, evidence')
              .eq('restaurant_id', restaurantId)
              .is('invalidated_at', null).order('id'))
          : [],
      ]);
      const byIngredient = new Map(ingredients.map((g) => [g.id, g]));
      const byLine = new Map(evidence.map((e) => [e.invoice_item_id, e]));
      return res.status(200).json({
        restaurantId,
        today,
        items: items.filter((r) =>
          r.invoices?.restaurant_id === restaurantId && byIngredient.has(r.ingredient_id)
        ).map((r) => ({
          id: r.id,
          invoice_id: r.invoice_id,
          ingredient_id: r.ingredient_id,
          quantity: r.quantity,
          amount: r.amount,
          unit: r.unit,
          unit_cost: r.unit_cost,
          invoices: r.invoices,
          display_unit_cost: ingredientPurchaseUnitCost(
            { ...r, restaurant_id: restaurantId },
            byIngredient.get(r.ingredient_id),
            byLine.get(r.id) || null
          ),
        })),
      });
    } catch (error) {
      console.error('[ingredients/purchase-history]', error.message);
      return res.status(503).json({
        error: 'Could not load ingredient purchase history or the restaurant local date. Please retry.',
      });
    }
  };
}

export default createPurchaseHistoryHandler();

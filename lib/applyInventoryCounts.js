import { isProtein } from './shelfLife';
import { getInvoiceEffectiveDate } from './invoiceRepricing';
import { restaurantLocalDate } from './restaurantTime';
import {
  buildDishIngredientMap,
  computeWasteRisk,
} from './computeWasteRisk';
import {
  convertIngredientQuantity,
} from './ingredientUnitConversions';

const key = (value) => String(value || '').trim().toLowerCase();

const confirmationDay = (timestamp, timeZone) => {
  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid inventory confirmation timestamp.');
  }

  return restaurantLocalDate(timeZone, date);
};

// Replay physical counts, deliveries, POS usage and confirmed
// adjustments in chronological order.
export function applyInventoryCounts(
  base,
  inputs,
  counts,
  throughDate
) {
  const {
    invoiceItems,
    invoices,
    posSales,
    menuItems,
    freezeSettings,
    keptItemIds,
    learnedShelfLives,
    confirmationEvents = [],
    timeZone,
  } = inputs;

  if (!counts.length && !confirmationEvents.length) {
    return base;
  }

  const groups = new Map();
  const invoiceItemsById = new Map(
    invoiceItems.map((item) => [item.id, item])
  );

  const deliveryDayFor = (item) => getInvoiceEffectiveDate({
    ...invoices.find(invoice => invoice.id === item.invoice_id),
    ...item.invoices,
  });

  for (const line of counts) {
    const group = groups.get(line.ingredient_id) || [];
    group.push(line);
    groups.set(line.ingredient_id, group);
  }

  const confirmationsByIngredient = new Map();

  for (const confirmation of confirmationEvents) {
    const day = confirmationDay(confirmation.confirmed_at, timeZone);

    // Historical inventory must not depend on confirmations
    // that had not occurred by the requested cutoff.
    if (day > throughDate) continue;

    const item = invoiceItemsById.get(
      confirmation.invoice_item_id
    );

    if (!item) {
      throw new Error(
        'Inventory confirmation references an unavailable invoice line.'
      );
    }

    const deliveryDay = deliveryDayFor(item);

    if (
      !deliveryDay ||
      deliveryDay > throughDate ||
      day < deliveryDay
    ) {
      continue;
    }

    const ingredientId =
      item.ingredient_id || item.ingredients?.id;

    if (!ingredientId) {
      throw new Error(
        'Inventory confirmation references an unlinked ingredient.'
      );
    }

    const events =
      confirmationsByIngredient.get(ingredientId) || [];

    events.push({
      ...confirmation,
      day,
    });

    confirmationsByIngredient.set(ingredientId, events);

    if (!groups.has(ingredientId)) {
      groups.set(ingredientId, []);
    }
  }

  const result = base.filter(
    (row) => !groups.has(row.ingredientId)
  );

  const recipes = buildDishIngredientMap(menuItems);

  for (const [ingredientId, lines] of groups) {
    const invoiceIngredient = invoiceItems.find(
      (item) =>
        (item.ingredient_id || item.ingredients?.id) ===
        ingredientId
    )?.ingredients;

    const ingredient =
      invoiceIngredient || lines[0]?.ingredients;

    const name = ingredient?.name;
    const unit = ingredient?.unit;

    if (!name || !unit) {
      throw new Error(
        'An inventory ingredient is missing its name or unit.'
      );
    }

    const events = [];
    const batches = [];
    let latestCount = null;
    let latestPhysicalCountDay = null;

    for (const line of lines) {
      const converted = convertIngredientQuantity(
        Number(line.quantity),
        line.unit,
        unit,
        line.ingredients || ingredient
      );

      if (
        !converted ||
        !Number.isFinite(converted.quantity) ||
        converted.quantity < 0
      ) {
        throw new Error(
          `Cannot convert the saved count for ${name} ` +
          `from ${line.unit} to ${unit}.`
        );
      }

      const quantity = converted.quantity;

      events.push({
        day: line.effective_date,
        order: line.count_timing === 'before_opening' ? 0 : 3,
        id: line.id,
        line,
        quantity,
      });
    }

    for (const item of invoiceItems) {
      if (
        (item.ingredient_id || item.ingredients?.id) !== ingredientId
      ) {
        continue;
      }

      const day = deliveryDayFor(item);

      if (!day || day > throughDate) continue;

      const [row] = computeWasteRisk(
        [item],
        invoices,
        [],
        [],
        new Date(`${day}T12:00:00`),
        freezeSettings,
        keptItemIds,
        learnedShelfLives
      );

      if (
        !row ||
        row.unit !== unit ||
        !Number.isFinite(row.invoicedQty) ||
        row.invoicedQty < 0 ||
        !Number.isFinite(row.unitCost) ||
        row.unitCost < 0
      ) {
        throw new Error(
          `Cannot safely rebuild an invoice delivery for ${name}. Check its quantity and unit.`
        );
      }

      events.push({
        day,
        order: 1,
        id: item.id,
        row,
      });
    }

    for (const sale of posSales) {
      const day = String(sale.sale_date || '').slice(0, 10);

      if (!day || day > throughDate) continue;

      const sold =
        Number(sale.quantity_sold || 0) +
        Number(sale.refunds || 0);

      if (!Number.isFinite(sold) || sold < 0) {
        throw new Error('Invalid POS consumption quantity.');
      }

      let quantity = 0;

      for (const part of recipes.get(key(sale.item_name)) || []) {
        if (part.ingredientId !== ingredientId) continue;

        const converted = convertIngredientQuantity(
          part.quantity,
          part.recipeUnit,
          unit,
          part.ingredient || ingredient
        );

        if (
          !converted ||
          !Number.isFinite(converted.quantity) ||
          converted.quantity < 0
        ) {
          throw new Error(
            `Cannot convert the recipe quantity for ${name} ` +
            `from ${part.recipeUnit} to ${unit}.`
          );
        }

        quantity += sold * converted.quantity;
      }

      if (quantity) {
        events.push({
          day,
          order: 2,
          id: sale.id,
          quantity,
        });
      }
    }

        for (
      const confirmation of
      confirmationsByIngredient.get(ingredientId) || []
    ) {
      const quantity = Number(confirmation.adjustment_qty);

      if (
        !Number.isFinite(quantity) ||
        quantity < 0
      ) {
        throw new Error(
          `Invalid confirmation adjustment for ${name}.`
        );
      }

      events.push({
        day: confirmation.day,
        // After daily POS consumption, before closing counts.
        order: 2.5,
        id: confirmation.id,
        confirmation,
        quantity,
      });
    }

    events.sort((a, b) =>
      a.day.localeCompare(b.day) ||
      a.order - b.order ||
      (Date.parse(a.line?.submitted_at) || 0) -
        (Date.parse(b.line?.submitted_at) || 0) ||
      String(a.id).localeCompare(String(b.id))
    );

    // Estimated expiration alone does not remove a batch from inventory.
    // Physical counts and confirmed disposal must determine corrections.
    const active = (batch, day) =>
      batch.stockSource === 'count' ||
      (batch.deliveryDate != null && day >= batch.deliveryDate);

    const drain = (quantity, day) => {
      for (const batch of batches) {
        if (quantity <= 0) break;
        if (!active(batch, day)) continue;

        const used = Math.min(quantity, batch.remainingQty);

        batch.remainingQty = Math.max(
          0,
          batch.remainingQty - used
        );

        quantity -= used;
      }
    };

    for (const event of events) {
      if (event.day > throughDate) continue;

      if (event.row) {
        batches.push({
          ...event.row,
          stockSource: 'invoice',
          confirmed: false,
        });
      } else if (event.line) {
        latestCount = event.line.id;
        latestPhysicalCountDay = event.day;

        const available = batches.filter(
          (batch) => active(batch, event.day)
        );

        const total = available.reduce(
          (sum, batch) => sum + batch.remainingQty,
          0
        );

        if (total > event.quantity) {
          drain(total - event.quantity, event.day);
        }

        for (const batch of available) {
          if (batch.remainingQty > 0) {
            batch.confirmed = true;
          }
        }

        if (event.quantity > total) {
          batches.push({
            name,
            ingredientId,
            unit,
            stockSource: 'count',
            countLineId: event.line.id,
            invoiceId: null,
            invoiceItemId: null,
            deliveryDate: null,
            shelfLife: null,
            invoicedQty: null,
            unitCost: null,
            remainingQty: event.quantity - total,
            protein: isProtein(name),
            confirmed: true,
          });
        }
      } else if (event.confirmation) {
        const target = batches.find(
          (batch) =>
            batch.stockSource === 'invoice' &&
            batch.invoiceItemId ===
              event.confirmation.invoice_item_id
        );

        if (!target) {
          throw new Error(
            `Cannot find the confirmed delivery for ${name}.`
          );
        }

        // A physical count taken after this delivery has already
        // reconciled the ingredient's estimated balance.
        //
        // Because the confirmation does not record the actual
        // disposal time, applying it after that count could
        // deduct the same missing stock twice.
        //
        // Treat such confirmations as informational only.
        const reconciledByPhysicalCount =
          latestPhysicalCountDay != null &&
          target.deliveryDate != null &&
          latestPhysicalCountDay >= target.deliveryDate;

        if (!reconciledByPhysicalCount) {
          // Never deduct more than this specific delivery's
          // remaining modeled balance.
          const deduction = Math.min(
            event.quantity,
            Math.max(0, target.remainingQty)
          );

          target.remainingQty = Math.max(
            0,
            target.remainingQty - deduction
          );
        }

      } else {
        drain(event.quantity, event.day);
      }
    }

    for (const batch of batches) {
      if (!active(batch, throughDate)) continue;

      const age = batch.deliveryDate == null
        ? null
        : Math.round(
            (
              Date.parse(`${throughDate}T00:00:00Z`) -
              Date.parse(`${batch.deliveryDate}T00:00:00Z`)
            ) / 86400000
          );

      result.push({
        ...batch,
        inventoryCountLineId: latestCount,
        daysSinceDelivery: age,
        daysLeft: age == null ? null : batch.shelfLife - age,
        totalValue: batch.unitCost == null
          ? null
          : batch.remainingQty * batch.unitCost,
      });
    }
  }

  return result;
}
import { isProtein } from './shelfLife';
import {
  buildDishIngredientMap,
  computeWasteRisk,
  convertQuantity,
} from './computeWasteRisk';

const key = (value) => String(value || '').trim().toLowerCase();

const plusDays = (date, days) =>
  new Date(
    Date.parse(`${date}T00:00:00Z`) + days * 86400000
  ).toISOString().slice(0, 10);

// Replay physical counts, deliveries and daily recipe usage in date order.
// Counts replace a total; they are never added to the existing total.
export function applyInventoryCounts(
  base,
  inputs,
  counts,
  throughDate
) {
  if (!counts.length) return base;

  const {
    invoiceItems,
    invoices,
    posSales,
    menuItems,
    freezeSettings,
    keptItemIds,
    learnedShelfLives,
  } = inputs;

  const groups = new Map();

  for (const line of counts) {
    const group = groups.get(line.ingredient_id) || [];
    group.push(line);
    groups.set(line.ingredient_id, group);
  }

  const result = base.filter(
    (row) => !groups.has(row.ingredientId)
  );

  const recipes = buildDishIngredientMap(menuItems);

  for (const [ingredientId, lines] of groups) {
    const ingredient = lines[0].ingredients;
    const name = ingredient?.name;
    const unit = ingredient?.unit;

    if (!name || !unit) {
      throw new Error(
        'A counted ingredient is missing its name or unit.'
      );
    }

    const events = [];
    const batches = [];
    let latestCount = null;

    for (const line of lines) {
      const quantity = convertQuantity(
        Number(line.quantity),
        line.unit,
        unit,
        name
      );

      if (
        quantity == null ||
        !Number.isFinite(quantity) ||
        quantity < 0
      ) {
        throw new Error(
          `Cannot convert the saved count for ${name} from ${line.unit} to ${unit}.`
        );
      }

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

      const day = String(
        item.invoices?.date ||
        invoices.find((invoice) => invoice.id === item.invoice_id)?.date ||
        ''
      ).slice(0, 10);

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

        const converted = convertQuantity(
          part.quantity,
          part.recipeUnit,
          unit,
          name
        );

        if (
          converted == null ||
          !Number.isFinite(converted) ||
          converted < 0
        ) {
          throw new Error(
            `Cannot convert the recipe quantity for ${name} to ${unit}.`
          );
        }

        quantity += sold * converted;
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

    events.sort((a, b) =>
      a.day.localeCompare(b.day) ||
      a.order - b.order ||
      (Date.parse(a.line?.submitted_at) || 0) -
        (Date.parse(b.line?.submitted_at) || 0) ||
      String(a.id).localeCompare(String(b.id))
    );

    const active = (batch, day) =>
      batch.stockSource === 'count' ||
      keptItemIds.has(batch.invoiceItemId) ||
      day <= plusDays(batch.deliveryDate, batch.shelfLife + 3);

    const drain = (quantity, day, physicalCorrection) => {
      for (const batch of batches) {
        if (quantity <= 0) break;
        if (!active(batch, day)) continue;

        if (
          !physicalCorrection &&
          !batch.confirmed &&
          batch.stockSource !== 'count' &&
          !keptItemIds.has(batch.invoiceItemId) &&
          day > plusDays(batch.deliveryDate, batch.shelfLife)
        ) {
          continue;
        }

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

        const available = batches.filter(
          (batch) => active(batch, event.day)
        );

        const total = available.reduce(
          (sum, batch) => sum + batch.remainingQty,
          0
        );

        if (total > event.quantity) {
          drain(total - event.quantity, event.day, true);
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
      } else {
        drain(event.quantity, event.day, false);
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
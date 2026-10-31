import { calculateVerifiedIngredientCost } from '../verifiedIngredientCost';
import { TOUR_RESTAURANT_ID } from './requireAdmin';

const DAY_MS = 86400000;

function ageInDays(value, today) {
  if (!value) return null;
  const date = Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(date) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - date) / DAY_MS));
}

function coverage(part, total) {
  return total > 0 ? Math.min(1, part / total) : 0;
}

function check(id, label, weight, fraction, detail, action) {
  const score = Math.round(weight * fraction);
  return {
    id,
    label,
    weight,
    score,
    status: fraction >= 0.8
      ? 'ready'
      : fraction > 0
        ? 'partial'
        : 'missing',
    detail,
    action,
  };
}

async function readAll(query, label) {
  const rows = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query()
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`${label}: ${error.message}`);

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) return rows;
  }
}

export async function getRestaurantDataReadiness(
  supabase,
  restaurantId,
  today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  })
) {
  const [menu, invoices, sales, connections] = await Promise.all([
    readAll(
      () => supabase
        .from('menu_items')
        .select(`
          id, name, price,
          menu_item_components (
            component_ingredients (
              quantity, unit,
              ingredients:ingredient_id (
                id, name, unit, last_price, is_estimated, price_approved_at,
                ingredient_unit_conversions (
                  id, ingredient_id, from_unit, to_unit, factor, basis, evidence
                ),
                ingredient_conversion_default_links (
                  ingredient_conversion_defaults (
                    id, label, from_unit, to_unit, factor, basis, evidence, source_url
                  )
                )
              )
            )
          )
        `)
        .eq('restaurant_id', restaurantId)
        .is('archived_at', null)
        .order('id', { ascending: true }),
      'Menu'
    ),
    supabase
      .from('invoices')
      .select('date')
      .eq('restaurant_id', restaurantId)
      .not('date', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
    supabase
      .from('pos_sales')
      .select('sale_date')
      .eq('restaurant_id', restaurantId)
      .not('sale_date', 'is', null)
      .order('sale_date', { ascending: false })
      .limit(1),
    supabase
      .from('pos_connections')
      .select('provider, status, last_synced_at')
      .eq('restaurant_id', restaurantId)
      .limit(1),
  ]);

  if (invoices.error) throw invoices.error;
  if (sales.error) throw sales.error;
  if (connections.error) throw connections.error;

  const active = menu.filter(item =>
    item.name && Number(item.price) > 0
  );

  let withRecipes = 0;
  let withApprovedPrices = 0;

  const missingRecipes = [];
  const unverifiedRecipes = [];

  for (const item of active) {
    const lines = (item.menu_item_components || [])
      .flatMap(component => component.component_ingredients || []);

    if (!lines.length) {
      missingRecipes.push({
        id: item.id,
        name: item.name,
      });
      continue;
    }

    withRecipes++;

    const reasons = new Set();
    const affectedIngredients = new Set();

    for (const line of lines) {
      const ingredient = line.ingredients;

      if (!ingredient) {
        reasons.add('Missing ingredient mapping');
        continue;
      }

      const approved =
        ingredient.is_estimated === false ||
        Boolean(ingredient.price_approved_at);

      if (!approved) {
        reasons.add('Unapproved ingredient price');
        affectedIngredients.add(ingredient.name || 'Unnamed ingredient');
      }

      const lineCost = calculateVerifiedIngredientCost(
        line.quantity,
        line.unit,
        ingredient
      );

      if (lineCost === null) {
        reasons.add('Missing or unverified cost conversion');
        affectedIngredients.add(ingredient.name || 'Unnamed ingredient');
      }
    }

    if (reasons.size === 0) {
      withApprovedPrices++;
    } else {
      unverifiedRecipes.push({
        id: item.id,
        name: item.name,
        reasons: [...reasons],
        ingredients: [...affectedIngredients],
      });
    }
  }

  const latestInvoice = invoices.data?.[0]?.date || null;
  const latestSale = sales.data?.[0]?.sale_date || null;

  const invoiceAge = ageInDays(latestInvoice, today);
  const salesAge = ageInDays(latestSale, today);

  const connection = connections.data?.[0] || null;
  const connected = connection?.status === 'connected';

  const salesFreshness = salesAge == null
    ? 0
    : salesAge <= 2
      ? 1
      : salesAge <= 7
        ? 0.5
        : 0;

  // Sales freshness and live integration are separate signals.
  // Imported or demo sales can be useful without a live connection.
  const posFreshness = salesFreshness;
  const connectionScore = connected ? 1 : 0;

  const checks = [
    check(
      'menu',
      'Menu availability',
      20,
      active.length > 0 ? 1 : 0,
      `${active.length} active, priced menu items`,
      'Import or update the menu'
    ),
    check(
      'recipes',
      'Recipe ingredient coverage',
      25,
      coverage(withRecipes, active.length),
      `${withRecipes} of ${active.length} dishes have recipe ingredients`,
      'Complete missing recipes'
    ),
    check(
      'costs',
      'Verified recipe costing',
      30,
      coverage(withApprovedPrices, active.length),
      `${withApprovedPrices} of ${active.length} dishes have verified ingredient costs and conversions`,
      'Review ingredient prices and conversions'
    ),
    check(
      'pos',
      'POS data freshness',
      15,
      posFreshness,
      salesAge == null
        ? 'No POS sales recorded'
        : `Latest POS sales: ${salesAge} day${salesAge === 1 ? '' : 's'} ago`,
      'Check POS sales synchronization'
    ),
    check(
      'pos_connection',
      'POS connection health',
      10,
      connectionScore,
      connected
        ? `${connection.provider || 'POS'} connection is active`
        : connection
          ? `${connection.provider || 'POS'} connection: ${connection.status}`
          : 'No POS integration connected',
      'Reconnect or configure the POS integration'
    ),
  ];

  const score = checks.reduce((sum, item) => sum + item.score, 0);

    const actions = [];

  if (active.length === 0) {
    actions.push({
      id: 'missing-menu',
      priority: 'critical',
      owner: 'Admin / Restaurant',
      title: 'No usable menu is available',
      detail: 'No active menu items with valid selling prices were found.',
      impact: 'OptiMenu cannot reliably analyze menu profitability or generate menu-based Tonight’s Dish recommendations.',
      fix: 'Import or relaunch the restaurant menu, then verify dish names and selling prices.',
      href: `/admin/restaurants/${restaurantId}?tab=Menu`,
    });
  }

  if (unverifiedRecipes.length > 0) {
    actions.push({
      id: 'unverified-costs',
      priority: 'high',
      owner: 'Admin',
      title: 'Recipe costs require verification',
      detail: `${unverifiedRecipes.length} dishes have unverified ingredient costs or conversions.`,
      impact: 'These dishes cannot be trusted for margin calculations and may be excluded from margin-based Tonight’s Dish recommendations. Menu profitability analysis may also be incomplete.',
      fix: 'Review the affected dishes, approve ingredient prices where supported, and resolve missing or estimated unit conversions.',
      href: `/admin/restaurants/${restaurantId}?tab=Menu`,
      affected: unverifiedRecipes,
    });
  }

  if (missingRecipes.length > 0) {
    actions.push({
      id: 'missing-recipes',
      priority: 'medium',
      owner: 'Admin / Restaurant',
      title: 'Menu items are missing recipes',
      detail: `${missingRecipes.length} dishes have no ingredient lines.`,
      impact: 'OptiMenu cannot calculate ingredient costs, margins, or ingredient-based inventory exposure for these dishes.',
      fix: 'Open each affected dish and complete its recipe ingredient mapping.',
      href: `/admin/restaurants/${restaurantId}?tab=Menu`,
      affected: missingRecipes,
    });
  }

  if (!connected) {
    actions.push({
      id: 'pos-disconnected',
      priority: 'high',
      owner: 'Admin',
      title: connection
        ? 'POS integration is not connected'
        : 'No POS integration is connected',
      detail: connection
        ? `${connection.provider || 'POS'} connection status: ${connection.status}.`
        : 'No configured POS connection was found.',
      impact: 'Automatic sales synchronization may not be working. Sales trends, demand analysis, and sales-driven Tonight’s Dish recommendations could become outdated.',
      fix: connection
        ? 'Inspect the integration error, restore the connection if necessary, and verify that a new synchronization completes.'
        : 'Configure the restaurant’s POS integration and verify its first successful synchronization.',
      href: `/admin/restaurants/${restaurantId}`,
    });
  }

  if (salesAge === null || salesAge > 7) {
    actions.push({
      id: 'stale-sales',
      priority: 'high',
      owner: 'Admin',
      title: salesAge === null
        ? 'No POS sales history found'
        : 'POS sales data is outdated',
      detail: salesAge === null
        ? 'No sales records were found.'
        : `The latest recorded sale is ${salesAge} days old.`,
      impact: 'OptiMenu lacks dependable recent sales activity for demand trends and sales-based recommendations.',
      fix: 'Verify POS synchronization or import the missing sales history, then confirm that recent transactions are available.',
      href: `/admin/restaurants/${restaurantId}`,
    });
  }

  if (invoiceAge === null || invoiceAge > 30) {
    actions.push({
      id: 'invoice-freshness',
      priority: 'medium',
      owner: 'Admin / Restaurant',
      title: invoiceAge === null
        ? 'No invoice history found'
        : 'Invoice history may be outdated',
      detail: invoiceAge === null
        ? 'No dated invoice records were found.'
        : `The most recent dated invoice is ${invoiceAge} days old.`,
      impact: 'Ingredient price movements may not reflect recent supplier costs. Previously verified prices are not automatically invalidated.',
      fix: 'Confirm whether newer supplier invoices exist, upload missing invoices, and review any ingredient price changes.',
      href: `/admin/restaurants/${restaurantId}?tab=Invoices`,
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2 };

  actions.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  return {
    restaurantId,
    assessedDate: today,
    isDemo: restaurantId === TOUR_RESTAURANT_ID,
    actions,
    score,
    status: score >= 80
      ? 'ready'
      : score >= 40
        ? 'partial'
        : 'limited',
    checks,
    metrics: {
      activeMenuItems: active.length,
      dishesWithRecipes: withRecipes,
      dishesWithApprovedPrices: withApprovedPrices,
    },
    invoice: {
      latestDate: latestInvoice,
      ageDays: invoiceAge,
      status: invoiceAge == null
        ? 'missing'
        : invoiceAge <= 30
          ? 'recent'
          : 'stale',
    },
    pos: {
      latestSaleDate: latestSale,
      ageDays: salesAge,
      connectionStatus: connection?.status || 'not_connected',
      provider: connection?.provider || null,
      lastSyncedAt: connection?.last_synced_at || null,
      hasLiveConnection: connected,
      dataSource: connected
        ? 'Connected POS'
        : latestSale
          ? 'Sales recorded without an active POS connection'
          : 'No POS sales recorded',
    },
  };
}

import { createHash } from 'node:crypto';
import { validateProjectionSettings } from './settings.js';
import { requireRestaurantTimezone } from '../restaurantTime.js';
import {
  projectionInstant,
  projectionBusinessDate,
  projectionNightWindow,
} from './businessTime.js';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function list(value, name) {
  if (!Array.isArray(value)) {
    fail('PROJECTION_SOURCE_INVALID', `${name} must be an array.`);
  }

  return value;
}

function id(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('PROJECTION_SOURCE_INVALID', 'A source identifier is missing.');
  }

  return value;
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

// Preserve source decimal quantities without rounding them or accumulating
// binary noise.
function decimal(value) {
  const raw = String(value);
  const m = raw.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);

  if (!m || !Number.isFinite(Number(raw))) {
    fail('PROJECTION_SOURCE_INVALID', 'Invalid dish quantity.');
  }

  const fraction = m[3] || '';
  const exponent = Number(m[4] || 0) - fraction.length;

  let n = BigInt(m[2] + fraction) * (m[1] ? -1n : 1n);
  let scale = Math.max(0, -exponent);

  if (exponent > 0) {
    n *= 10n ** BigInt(exponent);
  }

  while (scale && n % 10n === 0n) {
    n /= 10n;
    scale--;
  }

  return { n, scale };
}

function add(a, b) {
  const scale = Math.max(a.scale, b.scale);

  return {
    n:
      a.n * 10n ** BigInt(scale - a.scale) +
      b.n * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

function text(a) {
  const sign = a.n < 0n ? '-' : '';
  const digits = (a.n < 0n ? -a.n : a.n)
    .toString()
    .padStart(a.scale + 1, '0');

  const value = a.scale
    ? `${digits.slice(0, -a.scale)}.${digits.slice(-a.scale)}`
    : digits;

  return sign + (
    value.includes('.')
      ? value.replace(/0+$/, '').replace(/\.$/, '')
      : value
  );
}

const zero = () => ({ n: 0n, scale: 0 });

export function buildProjectionNight(context, snapshot, now) {
  const restaurantId = id(context.restaurant_id);
  const date = context.business_date;
  const zone = requireRestaurantTimezone(context.timezone);
  const settings = validateProjectionSettings(context.settings);
  const observed = projectionInstant(snapshot?.observed_at);
  const actualNow = projectionInstant(now);

  if (snapshot.restaurant_id !== restaurantId) {
    fail(
      'PROJECTION_TENANT_MISMATCH',
      'POS snapshot belongs to another restaurant.'
    );
  }

  if (observed > actualNow) {
    fail('PROJECTION_SOURCE_INVALID', 'POS observation is in the future.');
  }

  if (
    date > projectionBusinessDate(
      now,
      zone,
      settings.business_day_cutoff_minutes
    )
  ) {
    fail(
      'PROJECTION_SOURCE_INVALID',
      'A future business night cannot be ingested.'
    );
  }

  const window = projectionNightWindow(
    date,
    zone,
    settings.business_day_cutoff_minutes
  );

  const from = projectionInstant(window.from);
  const to = projectionInstant(window.to);

  if (
    (context.window_from &&
      projectionInstant(context.window_from) !== from) ||
    (context.window_to &&
      projectionInstant(context.window_to) !== to)
  ) {
    fail(
      'PROJECTION_CONTEXT_INVALID',
      'Database and JavaScript business boundaries disagree.'
    );
  }

  const owned = rows => list(rows, 'Context rows').map(row => {
    if (row.restaurant_id !== restaurantId) {
      fail(
        'PROJECTION_TENANT_MISMATCH',
        'Ingestion context crosses restaurants.'
      );
    }

    return row;
  });

  const dishes = new Map(
    owned(context.dishes).map(row => [row.id, row])
  );

  const periods = owned(context.availability);
  const active = new Set();

  for (const dish of dishes.values()) {
    if (!dish.forecastable) continue;

    const history = periods.filter(p => p.dish_id === dish.id);

    if (
      !history.length &&
      dish.removed_date &&
      dish.removed_date <= date
    ) {
      continue;
    }

    if (!history.length && (dish.is_returning || !dish.launch_date)) {
      fail(
        'PROJECTION_MENU_HISTORY_REQUIRED',
        'Forecastable dishes require explicit menu availability history.'
      );
    }

    const intervals = history.length ? history : [{
      valid_from: dish.launch_date,
      valid_until: dish.removed_date,
    }];

    if (intervals.some(p =>
      p.valid_from <= date &&
      (!p.valid_until || date < p.valid_until)
    )) {
      active.add(dish.id);
    }
  }

  if (!active.size) {
    fail(
      'PROJECTION_BASELINE_REQUIRED',
      'No forecastable dishes are available on this business night.'
    );
  }

  const mappings = new Map();

  for (const map of owned(context.mappings)) {
    if (
      map.valid_from > date ||
      (map.valid_until && date >= map.valid_until)
    ) {
      continue;
    }

    const key = JSON.stringify([
      map.pos_system,
      map.external_item_id,
    ]);

    if (mappings.has(key)) {
      fail('PROJECTION_SOURCE_INVALID', 'POS mappings overlap.');
    }

    if (!dishes.has(map.dish_id)) {
      fail(
        'PROJECTION_TENANT_MISMATCH',
        'Mapped dish is outside this restaurant.'
      );
    }

    mappings.set(key, map.dish_id);
  }

  const connections = new Map(
    owned(context.connections).map(row => [row.id, row])
  );

  if (!connections.size) {
    fail(
      'PROJECTION_SOURCE_UNAVAILABLE',
      'No timestamped POS source is configured.'
    );
  }

  const sources = list(snapshot.sources, 'POS sources');
  const seenSources = new Set();
  const seenTickets = new Set();
  const seenLines = new Set();
  const events = [];
  const unmapped = new Map();

  const totals = new Map(
    [...active].map(dish => [dish, zero()])
  );

  let open = 0;
  let future = 0;
  let closedOut = true;

  for (const source of sources) {
    const connection = connections.get(source.connection_id);

    if (
      !connection ||
      source.provider !== connection.provider ||
      seenSources.has(source.connection_id)
    ) {
      fail(
        'PROJECTION_SOURCE_INVALID',
        'Missing, duplicate or unrelated POS source.'
      );
    }

    seenSources.add(source.connection_id);

    if (
      connection.status !== 'connected' ||
      source.complete !== true ||
      projectionInstant(source.coverage_from) > from ||
      projectionInstant(source.coverage_to) < to
    ) {
      fail(
        'PROJECTION_SOURCE_UNAVAILABLE',
        'POS source does not confirm complete night coverage.'
      );
    }

    closedOut &&= source.closed_out === true;

    for (const ticket of list(source.tickets, 'POS tickets')) {
      const ticketKey = JSON.stringify([
        source.connection_id,
        id(ticket.id),
      ]);

      if (seenTickets.has(ticketKey)) {
        fail('PROJECTION_SOURCE_INVALID', 'Duplicate POS ticket.');
      }

      seenTickets.add(ticketKey);

      if (!['closed', 'open', 'void'].includes(ticket.state)) {
        fail('PROJECTION_SOURCE_INVALID', 'Unknown POS ticket state.');
      }

      if (
        ticket.restaurant_id != null &&
        ticket.restaurant_id !== restaurantId
      ) {
        fail('PROJECTION_TENANT_MISMATCH', 'Foreign POS ticket.');
      }

      const lines = list(ticket.lines, 'POS lines');

      if (!lines.length && ticket.state === 'open') {
        const at = projectionInstant(ticket.opened_at);

        if (at >= from && at < to && at <= observed) {
          open++;

          events.push([
            source.connection_id,
            ticket.id,
            'empty',
            at,
            ticket.state,
          ]);
        }
      }

      for (const line of lines) {
        const key = JSON.stringify([ticketKey, id(line.id)]);

        if (seenLines.has(key)) {
          fail('PROJECTION_SOURCE_INVALID', 'Duplicate POS line.');
        }

        seenLines.add(key);

        const at = projectionInstant(line.at);

        if (at > observed) {
          future++;
          continue;
        }

        if (at < from || at >= to) continue;

        if (line.non_sales_revenue === true) {
          events.push([
            source.connection_id,
            ticket.id,
            line.id,
            at,
            ticket.state,
            'non_sales_revenue',
          ]);

          if (ticket.state === 'open') open++;

          continue;
        }

        if (!['sale', 'comp', 'refund', 'void'].includes(line.kind)) {
          fail('PROJECTION_SOURCE_INVALID', 'Unknown POS line type.');
        }

        const quantity = decimal(line.quantity);

        if (line.kind === 'refund') {
          quantity.n = -(quantity.n < 0n ? -quantity.n : quantity.n);
        } else if (quantity.n < 0n) {
          fail(
            'PROJECTION_SOURCE_INVALID',
            'A sale has a negative quantity.'
          );
        }

        const parts = line.components == null
          ? null
          : list(line.components, 'Combo components');

        // Component quantities are per one parent combo.
        const selected = parts?.length
          ? parts.map(part => {
              const component = decimal(part.quantity);

              if (component.n < 0n) {
                fail(
                  'PROJECTION_SOURCE_INVALID',
                  'A combo component has a negative quantity.'
                );
              }

              return {
                item_id: id(part.item_id),
                quantity: {
                  n: quantity.n * component.n,
                  scale: quantity.scale + component.scale,
                },
              };
            })
          : [{ item_id: id(line.item_id), quantity }];

        const canonicalParts = selected
          .map(p => [p.item_id, text(p.quantity)])
          .sort((a, b) =>
            a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
          );

        events.push([
          source.connection_id,
          ticket.id,
          line.id,
          at,
          ticket.state,
          line.kind,
          line.non_sales_revenue === true,
          canonicalParts,
        ]);

        if (ticket.state === 'open') {
          open++;
          continue;
        }

        if (
          ticket.state === 'void' ||
          line.kind === 'void' ||
          line.non_sales_revenue === true
        ) {
          continue;
        }

        for (const part of selected) {
          const dishId = mappings.get(JSON.stringify([
            source.provider,
            part.item_id,
          ]));

          if (!dishId) {
            const k = JSON.stringify([
              source.provider,
              part.item_id,
            ]);

            unmapped.set(
              k,
              add(unmapped.get(k) || zero(), part.quantity)
            );

            continue;
          }

          if (!dishes.get(dishId).forecastable) continue;

          if (!active.has(dishId)) {
            fail(
              'PROJECTION_MENU_HISTORY_REQUIRED',
              'A mapped sale conflicts with menu availability.'
            );
          }

          totals.set(
            dishId,
            add(totals.get(dishId), part.quantity)
          );
        }
      }
    }
  }

  if (seenSources.size !== connections.size) {
    fail(
      'PROJECTION_SOURCE_UNAVAILABLE',
      'A configured POS source is missing.'
    );
  }

  events.sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b)
      ? -1
      : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0
  );

  const sourceDigest = digest({
    sources: [...connections.values()]
      .map(c => [c.id, c.provider])
      .sort(([a], [b]) => a < b ? -1 : 1),
    events,
  });

  const changedAt =
    context.state?.transaction_digest === sourceDigest
      ? context.state.changed_at
      : snapshot.observed_at;

  const quietFrom = Math.max(
    to,
    projectionInstant(changedAt)
  );

  const readyAt =
    quietFrom + settings.sync_buffer_minutes * 60000;

  const facts = [...totals]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([dish_id, units]) => ({
      dish_id,
      units: text(units),
    }));

  const total = text(
    [...totals.values()].reduce(add, zero())
  );

  const negative = [...totals.values()].some(x => x.n < 0n);

  const complete =
    !open &&
    !negative &&
    observed >= to &&
    (closedOut || observed >= readyAt);

  return {
    mode: 'success',
    observed_at: snapshot.observed_at,
    transaction_digest: sourceDigest,
    changed_at: changedAt,
    complete,
    total_units: total,
    facts,
    diagnostics: {
      open_lines: open,
      negative_units: negative,
      future_lines_excluded: future,
      quiet_ready_at: new Date(readyAt).toISOString(),
      daily_closeout: closedOut,
      unmapped_items: [...unmapped]
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([key, quantity]) => ({
          provider: JSON.parse(key)[0],
          item_id: JSON.parse(key)[1],
          units: text(quantity),
        })),
    },
  };
}

function result(response) {
  if (!response || typeof response !== 'object') {
    fail(
      'PROJECTION_RESPONSE_INVALID',
      'Invalid projection ingestion response.'
    );
  }

  if (response.error) {
    const error = new Error(response.error.message);
    error.code = response.error.code;
    throw error;
  }

  if (
    !response.data ||
    typeof response.data !== 'object' ||
    Array.isArray(response.data)
  ) {
    fail(
      'PROJECTION_RESPONSE_INVALID',
      'Invalid projection ingestion response.'
    );
  }

  return response.data;
}

// readSource must finish every provider page and return the canonical receipt
// contract. The nightly orchestrator connects this function in Step 10.
export async function ingestProjectionNight(
  db,
  { restaurantId, businessDate, readSource }
) {
  const context = result(await db.rpc(
    'projection_ingestion_context',
    {
      p_restaurant_id: restaurantId,
      p_business_date: businessDate,
    }
  ));

  if (
    context.restaurant_id !== restaurantId ||
    context.business_date !== businessDate
  ) {
    fail(
      'PROJECTION_TENANT_MISMATCH',
      'Unexpected ingestion context.'
    );
  }

  const args = {
    p_restaurant_id: restaurantId,
    p_business_date: businessDate,
    p_context_digest: context.context_digest,
    p_expected_generation: context.state?.generation ?? 0,
  };

  let payload;

  try {
    payload = buildProjectionNight(
      context,
      await readSource(context),
      new Date().toISOString()
    );
  } catch (error) {
    try {
      result(await db.rpc('projection_commit_night', {
        ...args,
        p_payload: {
          mode: 'failure',
          observed_at: new Date().toISOString(),
          error_code: 'PROJECTION_SOURCE_UNAVAILABLE',
        },
      }));
    } catch (recordingError) {
      error.recording_error =
        recordingError.code || 'PROJECTION_RECORD_FAILED';
    }

    throw error;
  }

  const saved = result(await db.rpc(
    'projection_commit_night',
    { ...args, p_payload: payload }
  ));

  if (
    saved.restaurant_id !== restaurantId ||
    saved.business_date !== businessDate ||
    !Number.isSafeInteger(saved.generation) ||
    saved.generation < 1
  ) {
    fail(
      'PROJECTION_RESPONSE_INVALID',
      'Unexpected ingestion commit response.'
    );
  }

  return saved;
}
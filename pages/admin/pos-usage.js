import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminShell, { PageHead, Dialog } from '../../components/admin/AdminShell';
import { MONO } from '../../components/client/ClientChrome';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import Picker from '../../components/client/Picker';

const UNITS = [
  'each', 'slice', 'bunch', 'package',
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'cup', 'pt', 'qt', 'gal',
  'ml', 'l', 'tsp', 'tbsp',
];

const TONES = {
  READY: ['var(--green-tint)', 'var(--green)'],
  ESTIMATED: ['var(--amber-tint)', 'var(--amber)'],
  'NEEDS REVIEW': ['var(--red-tint)', 'var(--red)'],
  EXCLUDED: ['var(--panel)', 'var(--muted)'],
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}` : String(value || '—');
}

function formatQty(value) {
  return Number.isFinite(value)
    ? Number(value.toFixed(4)).toLocaleString('en-US', {
        maximumFractionDigits: 4,
      })
    : '—';
}

function rowStatus(row) {
  if (row.status === 'blocked') return 'NEEDS REVIEW';
  if (row.status === 'excluded') return 'EXCLUDED';
  return row.estimated ? 'ESTIMATED' : 'READY';
}


const REVIEW_MARKS = {
  dish: ['Which dish is this?', 'var(--red-tint)', 'var(--red)'],
  amount: ['Check this amount', 'var(--amber-tint)', 'var(--amber)'],
  weight: ['Missing a weight', 'var(--accent-tint)', 'var(--accent-deep)'],
  retry: ['Working on it', 'var(--panel)', 'var(--muted)'],
};

// Why a dish needs review, or null when it counts on its own.
// Removals and plain dishes never ask; extras and swaps ask once.
function reviewKind(row) {
  if (row.status === 'excluded') return null;

  if (row.status === 'blocked') {
    if (row.review) return row.review;
    if (row.retryable) return 'retry';
    return /matching OptiMenu dish|dish mapping/i.test(row.reason || '')
      ? 'dish'
      : 'amount';
  }

  const guessed = row.origin !== 'admin' &&
    (row.plan?.operations || []).some((op) => op.action !== 'remove');

  return guessed ? 'amount' : null;
}

function requestList(row) {
  const modifiers = row.instructions?.modifiers || [];
  return [
    ...modifiers.map((modifier) => modifier.name),
    ...(row.instructions?.requests || []),
    ...modifiers.flatMap((modifier) => modifier.requests || []),
  ].filter((value) => value && String(value).trim());
}

// What the plan did, in recipe units, one sentence per change.
function planLines(row, ingredients) {
  const name = (id) =>
    ingredients.find((ingredient) => ingredient.id === id)?.name || 'Unknown ingredient';
  const base = row.base || [];

  return (row.plan?.operations || []).map((op) => {
    if (op.action === 'remove') {
      return base.some((part) => part.id === op.ingredient_id)
        ? `Removed ${name(op.ingredient_id)}`
        : null;
    }

    if (op.action === 'replace') {
      const amount = ['equal_weight', 'equal_volume'].includes(op.basis)
        ? 'the same amount'
        : `${formatQty(op.quantity)} ${op.unit || ''}`.trim();
      return `Swapped ${name(op.ingredient_id)} for ${amount} of ${name(op.target_id)}`;
    }

    const had = base.some((part) => part.id === op.ingredient_id);
    return `${had ? 'Set' : 'Added'} ${formatQty(op.quantity)} ${op.unit || ''} of ${name(op.ingredient_id)}`
      .replace(/\s+/g, ' ');
  }).filter(Boolean);
}

function longDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value || '—');
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const menuWords = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 2);

// Up to three menu dishes sharing the most words with the POS name.
function closestMenus(name, menus) {
  const words = new Set(menuWords(name));
  return menus
    .map((menu) => ({
      menu,
      score: menuWords(menu.name).filter((word) => words.has(word)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.menu.name.localeCompare(b.menu.name))
    .slice(0, 3)
    .map((entry) => entry.menu);
}

// Base recipe next to this order's adjusted recipe, one line per ingredient.
function ingredientRows(row) {
  const base = row.base || [];
  const ids = [...new Set(
    [...base, ...(row.adjusted || [])].map((part) => part.id)
  )];
  const touched = new Set(
    (row.plan?.operations || [])
      .flatMap((op) => [op.ingredient_id, op.target_id])
      .filter(Boolean)
  );

  return ids.map((id) => {
    const originals = base.filter((part) => part.id === id);
    const adjusted = row.adjusted?.find((part) => part.id === id);
    const first = adjusted || originals[0];
    const sameUnit = originals.every((part) => part.unit === first.unit);

    const before = originals.length && sameUnit
      ? originals.reduce((sum, part) => sum + Number(part.quantity || 0), 0)
      : null;

    const quantity = adjusted
      ? adjusted.quantity
      : row.adjusted ? 0 : before;

    return {
      ...first,
      before,
      before_label: originals.length
        ? originals.map((part) =>
            `${formatQty(part.quantity)} ${part.unit || ''}`.trim()
          ).join(' + ')
        : '—',
      quantity,
      added: !originals.length,
      // Only ingredients the plan changed; a unit conversion alone is not a change.
      changed: Boolean(
        row.adjusted && (
          !originals.length ||
          !adjusted ||
          (row.plan?.replace_all
            ? sameUnit &&
              originals[0].unit === adjusted.unit &&
              Math.abs(adjusted.quantity - before) > 1e-9
            : touched.has(id))
        )
      ),
    };
  });
}

function changeText(part) {
  if (part.quantity === 0) return 'Removed';
  if (part.added) return `Added ${formatQty(part.quantity)} ${part.unit || ''}`.trim();
  return `${formatQty(part.quantity)} ${part.unit || ''}`.trim();
}

function Tag({ status }) {
  const [bg, fg] = TONES[status];
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', borderRadius: 5, padding: '3px 7px', whiteSpace: 'nowrap', background: bg, color: fg }}>
      {status}
    </span>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="pu-seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Kicker({ children, style }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)', ...style }}>
      {children}
    </div>
  );
}

export default function PosUsage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const isPhone = useIsPhone();

  const restaurantId = typeof router.query.restaurant === 'string'
    ? router.query.restaurant
    : '';

  const [restaurants, setRestaurants] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState('2026-10-24');
  const [editing, setEditing] = useState(null);
  const [portions, setPortions] = useState([]);
  const [addId, setAddId] = useState('');
  const [view, setView] = useState('review');
  const [reviewDay, setReviewDay] = useState('all');
  const [doneDay, setDoneDay] = useState('');
  const [openKey, setOpenKey] = useState('');
  const [match, setMatch] = useState({});
  const [fixes, setFixes] = useState({});
  const [conversion, setConversion] = useState({
    ingredientId: '',
    fromUnit: 'each',
    factor: '',
    basis: 'estimated',
    evidence: '',
  });

  const report = data?.result?.report || [];
  const sorted = [...report].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.ticket ?? '').localeCompare(String(b.ticket ?? ''), undefined, { numeric: true }) ||
    String(a.line_key || '').localeCompare(String(b.line_key || '')) ||
    (a.unit_index || 0) - (b.unit_index || 0)
  );

  // Needs review: one group per dish with the same requests, oldest first.
  const reviewGroups = [];
  const groupIndex = new Map();

  for (const row of sorted) {
    const kind = reviewKind(row);
    if (!kind) continue;

    const key = row.context_key
      ? `${kind}:${row.context_key}`
      : `${kind}:${row.item_ref}:${row.dish}:${row.reason || ''}`;

    if (!groupIndex.has(key)) {
      const group = { key, kind, row, sales: [] };
      groupIndex.set(key, group);
      reviewGroups.push(group);
    }

    groupIndex.get(key).sales.push(row);
  }

  const days = [...new Set(sorted.map((row) => row.date).filter(Boolean))];
  const visibleGroups = reviewDay === 'all'
    ? reviewGroups
    : reviewGroups.filter((group) =>
        group.sales.some((sale) => sale.date === reviewDay)
      );

  // Done: every counted dish on one day, one line per ticket line.
  const shownDay = days.includes(doneDay) ? doneDay : days[days.length - 1] || '';
  const dayIndex = days.indexOf(shownDay);
  const doneLines = [];
  const lineIndex = new Map();

  for (const row of sorted) {
    if (row.date !== shownDay || reviewKind(row)) continue;

    if (!lineIndex.has(row.line_key)) {
      const line = { row, count: 0 };
      lineIndex.set(row.line_key, line);
      doneLines.push(line);
    }

    lineIndex.get(row.line_key).count++;
  }

  const waitingToday = new Set(
    sorted
      .filter((row) => row.date === shownDay && reviewKind(row))
      .map((row) => row.line_key)
  ).size;

  const typedMissing = report.some((row) =>
    row.instructions && row.typed_requests_available === false
  );
  const applied = Boolean(
    data?.settings?.enabled &&
    data?.result?.publication_id &&
    data?.job?.applied_publication_id === data.result.publication_id
  );

  function setQuery(changes, replace = false) {
    const query = { ...router.query, ...changes };
    Object.keys(query).forEach((key) => {
      if (!query[key]) delete query[key];
    });
    router[replace ? 'replace' : 'push'](
      { pathname: router.pathname, query },
      undefined,
      { shallow: true, scroll: false }
    );
  }

  async function request(url, body) {
    const response = await adminFetch(
      url,
      body
        ? {
            method: 'POST',
            body: JSON.stringify(body),
          }
        : {}
    );

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || 'Request failed');
    }

    return json;
  }

  useEffect(() => {
    let live = true;

    request('/api/admin/pos-usage')
      .then((json) => {
        if (live) setRestaurants(json.restaurants);
      })
      .catch((error) => {
        if (live) setMessage(error.message);
      });

    return () => { live = false; };
  }, [adminFetch]);

  useEffect(() => {
    let live = true;

    setData(null);
    setEditing(null);
    setMessage('');
    setOpenKey('');
    setMatch({});
    setReviewDay('all');
    setDoneDay('');

    let timer;

    const refresh = async () => {
      try {
        const json = await request(
          `/api/admin/pos-usage?restaurantId=${restaurantId}`
        );

        if (live) setData(json);
      } catch (error) {
        if (live) setMessage(error.message);
      } finally {
        if (live) timer = setTimeout(refresh, 15000);
      }
    };

    if (restaurantId) refresh();

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [restaurantId, adminFetch]);

  async function act(action, extra = {}) {
    setBusy(true);
    setMessage('');

    try {
      const result = await request('/api/admin/pos-usage', {
        restaurantId,
        action,
        ...extra,
      });

      setData(await request(
        `/api/admin/pos-usage?restaurantId=${restaurantId}`
      ));

      setMessage(
        action === 'disable'
          ? 'Standard recipes restored.'
          : result.usage?.error
            ? `Saved, but usage processing failed: ${result.usage.error}. The daily inventory job will retry it; you can also use Retry now.`
            : result.usage?.retryPending
              ? 'Saved. Some interpretations still need a retry. Successful servings have been processed.'
              : result.usage?.applied
                ? 'Saved. Prepared servings have been applied to inventory.'
                : result.usage?.skipped
                  ? 'Saved. Usage is already current or another run is processing it.'
                  : 'Saved. Preview updated.'
      );

      setEditing(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function edit(row) {
    const parts = row.adjusted || row.base || [];
    const totals = new Map();

    for (const part of parts) {
      const ingredient = data.ingredients.find((candidate) =>
        candidate.id === part.id
      );

      if (!ingredient) continue;

      const old = totals.get(part.id);
      const known =
        part.unit === ingredient.unit &&
        Number.isFinite(part.quantity);

      totals.set(part.id, {
        id: part.id,
        quantity: known && old?.quantity !== ''
          ? String(Number(old?.quantity || 0) + part.quantity)
          : '',
      });
    }

    setPortions([...totals.values()]);
    setEditing(row);
    setAddId('');
    setFixes({});
    setConversion({
      ingredientId: '',
      fromUnit: 'each',
      factor: '',
      basis: 'estimated',
      evidence: '',
    });
  }

  const selectRestaurant = (
    <select
      aria-label="Restaurant"
      className="om-field"
      value={restaurantId}
      disabled={busy}
      style={{ width: isPhone ? '100%' : 240, minHeight: isPhone ? 44 : 38, borderRadius: isPhone ? 10 : 20 }}
      onChange={(event) => setQuery({ restaurant: event.target.value }, true)}
    >
      <option value="">Choose restaurant</option>
      {restaurants.map((restaurant) => (
        <option key={restaurant.id} value={restaurant.id}>
          {restaurant.name || 'Unnamed restaurant'}
        </option>
      ))}
    </select>
  );

  const actions = data?.settings ? (
    <>
      <button type="button" className="om-btn" disabled={busy} onClick={() => act('prepare')}>
        {busy ? 'Working…' : 'Retry now'}
      </button>
      {data.settings.enabled ? (
        <button type="button" className="om-btn" disabled={busy} onClick={() => act('disable')}>
          {isPhone ? 'Standard recipes' : 'Return to standard recipes'}
        </button>
      ) : (
        <button type="button" className="om-pri" disabled={busy} onClick={() => act('enable')}>
          Use for inventory
        </button>
      )}
    </>
  ) : null;

  function renderDish(row, index) {
    const status = rowStatus(row);
    const ingredients = ingredientRows(row);
    const changes = ingredients.filter((part) => part.changed);
    const modifiers = row.instructions?.modifiers || [];
    const requests = [
      ...(row.instructions?.requests || []),
      ...modifiers.flatMap((modifier) => modifier.requests || []),
    ].filter((text) => text && text.trim());
    const indent = isPhone ? 0 : 40;
    const servingLabel = Number(row.quantity) > 1 && row.unit_index
      ? `serving ${row.unit_index} of ${row.quantity}`
      : Number(row.quantity) > 1 ? `×${row.quantity}` : '×1';
    const reasonBg = status === 'ESTIMATED' ? 'var(--amber-tint)' : 'var(--red-tint)';
    const reason = row.reason || '';
    const table = (
      <div style={{ border: '1px solid var(--line-soft)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'minmax(0, 1fr) 70px 92px' : 'minmax(0, 1fr) 100px 110px', gap: 10, padding: '7px 12px', background: 'var(--panel)', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>
          <span>INGREDIENT</span>
          <span style={{ textAlign: 'right' }}>RECIPE</span>
          <span style={{ textAlign: 'right' }}>{row.status === 'ready' ? 'THIS ORDER' : 'BASE'}</span>
        </div>
        {ingredients.map((part) => (
          <div key={part.id} style={{ display: 'grid', gridTemplateColumns: isPhone ? 'minmax(0, 1fr) 70px 92px' : 'minmax(0, 1fr) 100px 110px', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--line-soft)', fontSize: 13, alignItems: 'baseline' }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: part.quantity === 0 ? 'var(--muted)' : 'var(--text)', textDecoration: part.quantity === 0 ? 'line-through' : 'none' }}>{part.name}</span>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{part.before_label}</span>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12, fontWeight: part.changed ? 700 : 600, color: part.changed ? 'var(--accent-deep)' : 'var(--text)' }}>
              {Number.isFinite(part.quantity) ? `${formatQty(part.quantity)} ${part.unit || ''}` : '—'}
            </span>
          </div>
        ))}
      </div>
    );

    return (
      <article style={{ border: '1px solid var(--line)', borderRadius: 10, padding: isPhone ? 14 : '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--shell)', minWidth: 0, overflowWrap: 'anywhere' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {!isPhone && (
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
              {String(index + 1).padStart(2, '0')}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>
                {row.dish}{' '}
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: 'var(--muted)' }}>{servingLabel}</span>
              </h3>
              <Tag status={status} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {modifiers.map((modifier, i) => (
                <span key={`m${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>
                  {modifier.name}
                </span>
              ))}
              {requests.map((text, i) => (
                <span key={`r${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid var(--amber)', color: 'var(--amber)' }}>
                  TYPED · {text}
                </span>
              ))}
              {!modifiers.length && !requests.length && (
                <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--panel)', color: 'var(--muted)' }}>
                  Standard order
                </span>
              )}
            </div>
          </div>
        </div>

        {status === 'READY' && !changes.length && (
          <div style={{ paddingLeft: indent, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
            Standard recipe · {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'}
          </div>
        )}

        {status === 'EXCLUDED' && (
          <div style={{ paddingLeft: indent, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
            {row.reason || 'No tracked food · skipped'}
          </div>
        )}

        {row.status === 'ready' && changes.length > 0 && (
          <div style={{ paddingLeft: indent, paddingTop: 10, borderTop: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {changes.map((part) => (
              <div key={part.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 13.5 }}>
                <strong style={{ fontWeight: 700 }}>{part.name}</strong>
                {!part.added && part.quantity !== 0 && (
                  <>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{part.before_label}</span>
                    <span aria-hidden="true" style={{ color: 'var(--faint)' }}>→</span>
                  </>
                )}
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: part.quantity === 0 ? 'var(--red)' : status === 'ESTIMATED' ? 'var(--amber)' : 'var(--accent-deep)' }}>
                  {changeText(part)}
                </span>
              </div>
            ))}
          </div>
        )}

        {row.status === 'blocked' && ingredients.length > 0 && (
          <div style={{ marginLeft: indent }}>{table}</div>
        )}

        {status !== 'EXCLUDED' && reason && (
          <div style={{ marginLeft: indent, background: reasonBg, borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.55 }}>
            {reason}
          </div>
        )}

        {row.reason === 'Choose the matching OptiMenu dish' && (
          <div style={{ marginLeft: indent, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              aria-label={`Match recipe for ${row.dish}`}
              className="om-field"
              style={{ flex: '1 1 200px', width: 'auto', minWidth: 0 }}
              disabled={busy}
              defaultValue=""
              onChange={(event) =>
                event.target.value && act('map', {
                  itemRef: row.item_ref,
                  menuId: event.target.value,
                })
              }
            >
              <option value="">Choose the matching dish</option>
              {data.menus.map((menu) => (
                <option key={menu.id} value={menu.id}>{menu.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="om-btn"
              disabled={busy}
              onClick={() => act('map', { itemRef: row.item_ref, menuId: '__exclude__' })}
            >
              Not food · exclude
            </button>
          </div>
        )}

        {row.rule_available && row.status === 'blocked' && (
          <div style={{ marginLeft: indent, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="om-pri"
              disabled={busy}
              onClick={() => edit(row)}
            >
              {row.status === 'blocked' ? 'Set portions' : 'Confirm or change portion'}
            </button>
          </div>
        )}

        {row.status === 'ready' && (ingredients.length > 0 || row.plan?.explanation) && (
          <details style={{ marginLeft: indent }}>
            <summary style={{ cursor: 'pointer', color: 'var(--accent-deep)', fontSize: 12.5, fontWeight: 700, padding: '4px 0' }}>
              Ingredients &amp; calculation
            </summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ingredients.length > 0 && table}
              {row.plan?.explanation && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>{row.plan.explanation}</p>
              )}
              {row.instructions && (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
                  {row.typed_requests_available
                    ? 'Typed requests were read for this dish.'
                    : 'Typed requests were not available for this dish.'}
                </p>
              )}
              {row.rule_available && (
                <button
                  type="button"
                  className="om-btn"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={busy}
                  onClick={() => edit(row)}
                >
                  Edit portions
                </button>
              )}
            </div>
          </details>
        )}
      </article>
    );
  }

  function renderReview(group) {
    const { row, kind, sales } = group;
    const [label, bg, fg] = REVIEW_MARKS[kind];
    const open = openKey === group.key;
    const requests = requestList(row);
    const first = sales[0];
    const last = sales[sales.length - 1];
    const options = kind === 'dish' ? closestMenus(row.dish, data.menus) : [];
    const pick = match[group.key] ?? options[0]?.id ?? '';
    const picked = data.menus.find((menu) => menu.id === pick);
    const counted = planLines(row, data.ingredients);
    const when = sales.length > 1
      ? `${shortDate(first.date)}${first.date === last.date ? '' : ` – ${shortDate(last.date)}`} · ${sales.length} SALES`
      : `${shortDate(first.date)} · #${first.ticket || '—'}`;

    return (
      <article key={group.key} className="pu-card" data-open={open ? '' : undefined}>
        <button
          type="button"
          className="pu-head"
          aria-expanded={open}
          onClick={() => setOpenKey(open ? '' : group.key)}
        >
          <span className="pu-mark" style={{ background: bg, color: fg }}>{label}</span>
          <span className="pu-title">
            <strong>
              {kind === 'dish' ? `“${row.dish}”` : row.dish}
              {sales.length > 1 && <span className="pu-count">×{sales.length}</span>}
            </strong>
            <span>
              {kind === 'dish'
                ? 'POS button with no matching dish'
                : requests.length ? requests.join(' · ') : 'No requests'}
            </span>
          </span>
          <span className="pu-when">{when}</span>
        </button>

        {open && (
          <div className="pu-body">
            {sales.length > 1 && (
              <div className="pu-sales">
                {sales.map((sale) => (
                  <span key={`${sale.line_key}:${sale.unit_index || 0}`}>
                    {shortDate(sale.date)} · #{sale.ticket || '—'}
                  </span>
                ))}
              </div>
            )}

            {kind === 'dish' && (
              <>
                {options.length > 0 && (
                  <>
                    <span className="pu-label">Closest dishes on the menu</span>
                    <div className="pu-choices">
                      {options.map((menu) => (
                        <button
                          key={menu.id}
                          type="button"
                          aria-pressed={pick === menu.id}
                          onClick={() => setMatch({ ...match, [group.key]: menu.id })}
                        >
                          {menu.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <Picker
                  value={options.some((menu) => menu.id === pick) ? '' : pick}
                  search
                  placeholder="Search all dishes"
                  ariaLabel={`Search dishes for ${row.dish}`}
                  disabled={busy}
                  options={[...data.menus]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((menu) => ({ value: menu.id, label: menu.name }))}
                  onChange={(id) => {
                    if (id) setMatch({ ...match, [group.key]: id });
                  }}
                />
                <div className="pu-buttons">
                  <button
                    type="button"
                    className="om-pri"
                    disabled={busy || !picked}
                    onClick={() => act('map', { itemRef: row.item_ref, menuId: pick })}
                  >
                    {picked ? `Confirm ${picked.name}` : 'Choose a dish'}
                  </button>
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy}
                    onClick={() => act('map', { itemRef: row.item_ref, menuId: '__exclude__' })}
                  >
                    Not food, skip it
                  </button>
                </div>
                <p className="pu-note">
                  Nothing changes until you confirm. Every past and future sale of this button then counts as that dish.
                </p>
              </>
            )}

            {kind === 'amount' && row.status === 'ready' && (
              <>
                <div className="pu-counted">
                  <strong>We counted:</strong>
                  {counted.map((text, i) => <span key={i}>{text}</span>)}
                  {row.plan?.explanation && (
                    <span className="pu-note">{row.plan.explanation}</span>
                  )}
                </div>
                <div className="pu-buttons">
                  <button
                    type="button"
                    className="om-pri"
                    disabled={busy}
                    onClick={() => act('confirm', { contextKey: row.context_key })}
                  >
                    {sales.length > 1 ? `Correct, count all ${sales.length}` : 'Correct'}
                  </button>
                  <button type="button" className="om-btn" disabled={busy} onClick={() => edit(row)}>
                    Change amounts
                  </button>
                </div>
                <p className="pu-note">
                  Already counted. Your answer is used for every sale of this dish with these requests, past and future.
                </p>
              </>
            )}

            {kind !== 'dish' && !(kind === 'amount' && row.status === 'ready') && (
              <>
                {row.reason && <div className="pu-reason">{row.reason}</div>}
                <div className="pu-buttons">
                  {kind === 'retry' ? (
                    <button type="button" className="om-btn" disabled={busy} onClick={() => act('prepare')}>
                      Retry now
                    </button>
                  ) : row.rule_available && (
                    <button type="button" className="om-pri" disabled={busy} onClick={() => edit(row)}>
                      {kind === 'weight' ? 'Set the weight' : 'Set portions'}
                    </button>
                  )}
                </div>
              </>
            )}

            {row.base?.length > 0 && (
              <details>
                <summary className="pu-more">See the full recipe</summary>
                <div style={{ marginTop: 8 }}>{renderDish(row, 0)}</div>
              </details>
            )}
          </div>
        )}
      </article>
    );
  }

  function renderDone({ row, count }) {
    const key = `done:${row.line_key}`;
    const open = openKey === key;
    const requests = requestList(row);
    const [label, bg, fg] = row.status === 'excluded'
      ? ['Not food', 'var(--panel)', 'var(--muted)']
      : row.origin === 'admin'
        ? ['Reviewed by you', 'var(--green-tint)', 'var(--green)']
        : ['Automatic', 'var(--panel)', 'var(--muted)'];

    return (
      <div key={key} className="pu-done">
        <button
          type="button"
          className="pu-done-row"
          aria-expanded={open}
          onClick={() => setOpenKey(open ? '' : key)}
        >
          <strong>
            {row.dish}
            {count > 1 && <span className="pu-count">×{count}</span>}
          </strong>
          <span className="pu-req">{requests.length ? requests.join(' · ') : 'No requests'}</span>
          <span className="pu-when">#{row.ticket || '—'}</span>
          <span><span className="pu-mark" style={{ background: bg, color: fg }}>{label}</span></span>
        </button>
        {open && row.status !== 'excluded' && (
          <div style={{ padding: '0 18px 16px' }}>{renderDish(row, 0)}</div>
        )}
      </div>
    );
  }

  const setupCard = data && !data.settings && (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', flex: '1 1 220px' }}>
        Start with tickets dated
        <input className="om-field" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      </label>
      <button type="button" className="om-pri" disabled={busy} onClick={() => act('setup', { startDate })}>
        Set up preview
      </button>
    </section>
  );

  return (
    <AdminShell
      section="Platform"
      sub="Ingredient usage"
      title="POS ingredient usage"
    >
      <style jsx global>{`
        .pu-seg { display: flex; background: var(--panel); border-radius: 10px; padding: 3px; gap: 2px; }
        .pu-seg button { flex: 1; min-height: 34px; border: 0; border-radius: 8px; background: transparent; font: 600 12.5px 'Manrope', sans-serif; color: var(--muted); cursor: pointer; white-space: nowrap; padding: 0 12px; }
        .pu-seg button[aria-pressed="true"] { background: var(--shell); color: var(--text); box-shadow: 0 1px 2px rgba(17,24,25,0.10); }
        .pu-portion input { text-align: right; font-family: 'IBM Plex Mono', monospace; }
        .pu-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .pu-day { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
        .pu-day select { width: auto; min-height: 38px; border-radius: 19px; }
        .pu-arrows { display: flex; align-items: center; gap: 6px; }
        .pu-arrows button { width: 40px; height: 40px; border-radius: 20px; border: 1px solid var(--line); background: var(--shell); color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .pu-arrows button:disabled { opacity: 0.4; cursor: default; }
        .pu-arrows span { min-width: 130px; text-align: center; font-size: 15px; font-weight: 800; }
        .pu-note { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
        .pu-list { display: flex; flex-direction: column; gap: 10px; }
        .pu-card { background: var(--shell); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .pu-card[data-open] { border: 2px solid var(--accent); }
        .pu-head { width: 100%; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 18px; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--text); font: inherit; }
        .pu-mark { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 10px; white-space: nowrap; }
        .pu-title { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .pu-title strong { font-size: 15px; font-weight: 800; }
        .pu-title > span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
        .pu-count { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; background: var(--panel); color: var(--text); padding: 2px 7px; border-radius: 8px; margin-left: 6px; }
        .pu-when { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); }
        .pu-body { border-top: 1px solid var(--line-soft); padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
        .pu-sales { display: flex; gap: 8px; flex-wrap: wrap; }
        .pu-sales span { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; background: var(--panel); border-radius: 8px; padding: 6px 10px; }
        .pu-label { font-size: 13px; font-weight: 700; }
        .pu-choices { display: flex; gap: 8px; flex-wrap: wrap; }
        .pu-choices button { min-height: 42px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--shell); font: 600 13.5px 'Manrope', sans-serif; color: var(--text); cursor: pointer; }
        .pu-choices button[aria-pressed="true"] { border: 2px solid var(--accent); background: var(--accent-tint); font-weight: 700; }
        .pu-counted { background: var(--amber-tint); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
        .pu-reason { background: var(--red-tint); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.55; }
        .pu-buttons { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .pu-more { cursor: pointer; color: var(--accent-deep); font-size: 12.5px; font-weight: 700; padding: 4px 0; }
        .pu-done-list { background: var(--shell); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .pu-done + .pu-done { border-top: 1px solid var(--line-soft); }
        .pu-done-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.6fr) 110px 150px; gap: 12px; align-items: center; padding: 13px 18px; border: 0; background: transparent; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
        .pu-done-row strong { font-size: 13.5px; font-weight: 700; }
        .pu-req { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
        .pu-empty { margin: 0; color: var(--muted); font-size: 13px; padding: 14px 18px; }
        @media (max-width: 700px) {
          .pu-done-row { display: flex; flex-wrap: wrap; gap: 6px 12px; }
          .pu-done-row strong { flex: 1 1 100%; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 18 }}>
        <PageHead
          kicker={data?.settings
            ? (data.settings.enabled
              ? `PLATFORM · COUNTING SINCE ${shortDate(data.settings.start_date)}`
              : `PLATFORM · PREVIEW FROM ${shortDate(data.settings.start_date)}`)
            : 'PLATFORM'}
          title="Ingredient usage"
          sub={isPhone ? undefined : 'What every dish sold took out of inventory.'}
        >
          {!isPhone && selectRestaurant}
          {!isPhone && actions}
        </PageHead>

        {isPhone && selectRestaurant}
        {isPhone && actions && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
        )}

        {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

        {setupCard}

        {data?.job?.last_error && (
          <div className="pu-reason">Last worker error: {data.job.last_error}</div>
        )}

        {typedMissing && data?.settings && (
          <div className="pu-reason" style={{ background: 'var(--amber-tint)' }}>
            <strong>Typed kitchen requests are incomplete.</strong> Preset modifiers are applied. Typed requests are included once Shift4 lookup access is on.
          </div>
        )}

        {data?.settings && (
          <>
            <div className="pu-bar">
              <Segmented
                label="View"
                value={view}
                onChange={(key) => {
                  setView(key);
                  setOpenKey('');
                }}
                options={[
                  ['review', `Needs review · ${reviewGroups.length}`],
                  ['done', 'Done'],
                ]}
              />

              {view === 'review' ? (
                <label className="pu-day">
                  Day
                  <select
                    className="om-field"
                    value={reviewDay}
                    onChange={(event) => setReviewDay(event.target.value)}
                  >
                    <option value="all">All days</option>
                    {days.map((day) => (
                      <option key={day} value={day}>{longDate(day)}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="pu-arrows">
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={dayIndex <= 0}
                    onClick={() => {
                      setDoneDay(days[dayIndex - 1]);
                      setOpenKey('');
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span>{shownDay ? longDate(shownDay) : '—'}</span>
                  <button
                    type="button"
                    aria-label="Next day"
                    disabled={dayIndex < 0 || dayIndex >= days.length - 1}
                    onClick={() => {
                      setDoneDay(days[dayIndex + 1]);
                      setOpenKey('');
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </div>
              )}
            </div>

            {view === 'review' ? (
              <>
                <p className="pu-note">
                  Oldest first. Each answer is remembered for that dish with those same requests.
                </p>
                <div className="pu-list">
                  {visibleGroups.map(renderReview)}
                  {!visibleGroups.length && (
                    <p className="pu-empty" style={{ padding: 8 }}>
                      {report.length
                        ? 'Nothing needs review.'
                        : 'Usage is prepared after each POS sync.'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="pu-note">
                  Every dish sold this day, with or without requests · {doneLines.length} counted · {waitingToday} still in Needs review
                </p>
                <div className="pu-done-list">
                  {doneLines.map(renderDone)}
                  {!doneLines.length && (
                    <p className="pu-empty">No counted dishes this day.</p>
                  )}
                </div>
              </>
            )}

            <p className="pu-note" style={{ paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
              {data.settings.enabled
                ? (applied
                  ? 'Counting into inventory · up to date.'
                  : 'Counting into inventory · waiting for the background update.')
                : 'Preview only. Inventory is unchanged until you choose Use for inventory.'}
            </p>
          </>
        )}

        {!restaurantId && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Choose a restaurant to see its ingredient usage.
          </p>
        )}
      </div>

      {editing && (
        <Dialog
          title={editing.dish}
          sub="Set portions for one serving"
          width={560}
          showCloseButton
          onClose={() => { if (!busy) setEditing(null); }}
        >
          {(() => {
            const modifiers = editing.instructions?.modifiers || [];
            const requests = [
              ...(editing.instructions?.requests || []),
              ...modifiers.flatMap((modifier) => modifier.requests || []),
            ].filter((text) => text && text.trim());
            const target = data.ingredients.find((ingredient) => ingredient.id === conversion.ingredientId);

            // Only this dish's ingredients, unit mismatches first.
            const dishParts = [
              ...(editing.base || []),
              ...(editing.adjusted || []),
            ];
            const dishIngredients = data.ingredients
              .filter((ingredient) =>
                dishParts.some((part) => part.id === ingredient.id) ||
                portions.some((portion) => portion.id === ingredient.id)
              )
              .map((ingredient) => ({
                ingredient,
                recipeUnit: dishParts.find((part) =>
                  part.id === ingredient.id &&
                  part.unit &&
                  part.unit !== ingredient.unit
                )?.unit || null,
              }))
              .sort((a, b) =>
                Number(Boolean(b.recipeUnit)) - Number(Boolean(a.recipeUnit)) ||
                a.ingredient.name.localeCompare(b.ingredient.name)
              );

            return (
              <>
                {(modifiers.length > 0 || requests.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {modifiers.map((modifier, i) => (
                      <span key={`m${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>{modifier.name}</span>
                    ))}
                    {requests.map((text, i) => (
                      <span key={`r${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid var(--amber)', color: 'var(--amber)' }}>TYPED · {text}</span>
                    ))}
                  </div>
                )}

                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 56px', gap: 8, padding: '7px 12px', background: 'var(--panel)', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>
                    <span>INGREDIENT</span><span>ONE SERVING</span><span>UNIT</span>
                  </div>
                  {portions.map((portion, index) => {
                    const ingredient = data.ingredients.find((candidate) => candidate.id === portion.id);
                    const needed = portion.quantity === '';
                    return (
                      <label key={portion.id} className="pu-portion" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 56px', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--line-soft)', alignItems: 'center', fontSize: 13.5, background: needed ? 'var(--amber-tint)' : 'transparent' }}>
                        <span style={{ fontWeight: needed ? 700 : 600, minWidth: 0, overflowWrap: 'anywhere' }}>
                          {ingredient?.name}
                          {needed && <span style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: 'var(--amber)' }}>NEEDED</span>}
                        </span>
                        <input
                          className="om-field"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          aria-label={`${ingredient?.name} quantity`}
                          value={portion.quantity}
                          disabled={busy}
                          style={{ borderColor: needed ? 'var(--amber)' : undefined }}
                          onChange={(event) =>
                            setPortions(portions.map((value, i) =>
                              i === index ? { ...value, quantity: event.target.value } : value
                            ))
                          }
                        />
                        <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{ingredient?.unit}</span>
                      </label>
                    );
                  })}
                </div>

                <Picker
                  value=""
                  search
                  placeholder="Search to add an ingredient"
                  ariaLabel="Add an ingredient"
                  disabled={busy}
                  options={data.ingredients
                    .filter((ingredient) =>
                      !portions.some((portion) => portion.id === ingredient.id)
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((ingredient) => ({
                      value: ingredient.id,
                      label: ingredient.name,
                      meta: ingredient.unit,
                    }))}
                  onChange={(id) => {
                    if (id) setPortions([...portions, { id, quantity: '' }]);
                  }}
                />

                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)', background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
                  Saved as a rule for every <strong style={{ color: 'var(--text)' }}>{editing.dish}</strong> with these same instructions. Zero removes an ingredient. Other dishes are not changed.
                </div>

                <details open={dishIngredients.some(({ recipeUnit }) => recipeUnit)}>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent-deep)', fontSize: 13, fontWeight: 700, padding: '4px 0' }}>
                    Fix unit conversions instead
                  </summary>
                  {(() => {
                    const rows = dishIngredients.filter(({ recipeUnit }) => recipeUnit);
                    const filled = rows
                      .map(({ ingredient, recipeUnit }) => ({
                        ingredient,
                        recipeUnit,
                        fix: fixes[ingredient.id] || {},
                      }))
                      .filter(({ fix }) => fix.factor !== undefined && fix.factor !== '');
                    const invalid = filled.some(({ fix }) =>
                      !(Number(fix.factor) > 0) || !String(fix.evidence || '').trim()
                    );
                    const update = (id, change) => setFixes({
                      ...fixes,
                      [id]: { basis: 'estimated', ...fixes[id], ...change },
                    });

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
                          Fill in any you know. Each one applies to that ingredient everywhere. Leave a row blank to skip it.
                        </p>
                        {!rows.length && (
                          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
                            Every ingredient in this dish already uses its inventory unit.
                          </p>
                        )}
                        {rows.map(({ ingredient, recipeUnit }) => {
                          const fix = fixes[ingredient.id] || {};
                          return (
                            <div key={ingredient.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13.5 }}>
                                <strong style={{ flex: '1 1 140px', minWidth: 0 }}>{ingredient.name}</strong>
                                <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>1 {recipeUnit} =</span>
                                <input
                                  className="om-field"
                                  type="number"
                                  min="0"
                                  step="any"
                                  inputMode="decimal"
                                  aria-label={`${ingredient.name} ${ingredient.unit} per ${recipeUnit}`}
                                  value={fix.factor ?? ''}
                                  disabled={busy}
                                  style={{ width: 90, textAlign: 'right', fontFamily: MONO }}
                                  onChange={(event) => update(ingredient.id, { factor: event.target.value })}
                                />
                                <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{ingredient.unit}</span>
                                <select
                                  className="om-field"
                                  aria-label={`${ingredient.name} basis`}
                                  value={fix.basis || 'estimated'}
                                  disabled={busy}
                                  style={{ width: 'auto' }}
                                  onChange={(event) => update(ingredient.id, { basis: event.target.value })}
                                >
                                  <option value="estimated">Estimate</option>
                                  <option value="measured">Measured</option>
                                  <option value="package_label">Package label</option>
                                </select>
                              </div>
                              <input
                                className="om-field"
                                placeholder="Source or explanation"
                                aria-label={`${ingredient.name} source`}
                                value={fix.evidence || ''}
                                disabled={busy}
                                onChange={(event) => update(ingredient.id, { evidence: event.target.value })}
                              />
                            </div>
                          );
                        })}
                        {invalid && (
                          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--red)' }}>
                            Each filled row needs a number above zero and a source.
                          </p>
                        )}
                        <button
                          type="button"
                          className="om-btn"
                          style={{ alignSelf: 'flex-start' }}
                          disabled={busy || !filled.length || invalid}
                          onClick={() => act('conversions', {
                            conversions: filled.map(({ ingredient, recipeUnit, fix }) => ({
                              ingredientId: ingredient.id,
                              fromUnit: recipeUnit,
                              toUnit: ingredient.unit,
                              factor: Number(fix.factor),
                              basis: fix.basis || 'estimated',
                              evidence: fix.evidence.trim(),
                            })),
                          })}
                        >
                          {filled.length > 1
                            ? `Save ${filled.length} conversions and recalculate`
                            : 'Save conversion and recalculate'}
                        </button>
                      </div>
                    );
                  })()}
                </details>

                {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button type="button" className="om-btn" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="om-pri"
                    disabled={
                      busy ||
                      !portions.length ||
                      portions.some((portion) =>
                        portion.quantity === '' ||
                        !Number.isFinite(Number(portion.quantity)) ||
                        Number(portion.quantity) < 0
                      )
                    }
                    onClick={() => act('rule', {
                      contextKey: editing.context_key,
                      portions: portions.map((portion) => ({
                        ...portion,
                        quantity: Number(portion.quantity),
                      })),
                    })}
                  >
                    {busy ? 'Saving…' : 'Save and reuse'}
                  </button>
                </div>
              </>
            );
          })()}
        </Dialog>
      )}
    </AdminShell>
  );
}
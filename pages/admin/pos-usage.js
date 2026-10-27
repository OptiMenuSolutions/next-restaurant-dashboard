import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead, Dialog } from '../../components/admin/AdminShell';
import { MONO } from '../../components/client/ClientChrome';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';

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

// Base recipe next to this order's adjusted recipe, one line per ingredient.
function ingredientRows(row) {
  const base = row.base || [];
  const ids = [...new Set(
    [...base, ...(row.adjusted || [])].map((part) => part.id)
  )];

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
      changed: Boolean(
        row.adjusted &&
        (!sameUnit || !originals.length || (adjusted?.quantity || 0) !== before)
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
  const ticketKey = typeof router.query.ticket === 'string'
    ? router.query.ticket
    : '';

  const [restaurants, setRestaurants] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState('2026-10-24');
  const [editing, setEditing] = useState(null);
  const [portions, setPortions] = useState([]);
  const [addId, setAddId] = useState('');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [conversion, setConversion] = useState({
    ingredientId: '',
    fromUnit: 'each',
    factor: '',
    basis: 'estimated',
    evidence: '',
  });

  const report = data?.result?.report || [];
  const grouped = new Map();

  for (const row of report) {
    const lineKey = String(row.line_key || '');
    const separator = lineKey.lastIndexOf(':');
    const ticketId = separator >= 0
      ? lineKey.slice(0, separator)
      : String(row.ticket || lineKey);
    const key = `${row.date}:${ticketId}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        number: row.ticket,
        date: row.date,
        rows: [],
      });
    }

    grouped.get(key).rows.push(row);
  }

  const ticketGroups = [...grouped.values()];
  const blocked = (ticket) => ticket.rows.some((row) => row.status === 'blocked');

  const ticketCounts = {
    all: ticketGroups.length,
    review: ticketGroups.filter(blocked).length,
    ready: ticketGroups.filter((ticket) => !blocked(ticket)).length,
  };

  const filteredTickets = ticketGroups.filter((ticket) =>
    ticketFilter === 'all' ||
    (ticketFilter === 'review' ? blocked(ticket) : !blocked(ticket))
  );

  const activeTicket = filteredTickets.find((ticket) => ticket.key === ticketKey) ||
    (isPhone ? null : filteredTickets[0]);

  const readyRows = report.filter((row) => row.status === 'ready');
  const blockedRows = report.filter((row) => row.status === 'blocked');
  const estimatedRows = readyRows.filter((row) => row.estimated);
  const typedMissing = report.some((row) =>
    row.instructions && row.typed_requests_available === false
  );
  const applied = Boolean(
    data?.settings?.enabled &&
    data?.result?.publication_id &&
    data?.job?.applied_publication_id === data.result.publication_id
  );
  const restaurantName = restaurants.find((r) => r.id === restaurantId)?.name || '';

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

  // A detail screen starts at its top, not where the list was scrolled.
  useEffect(() => {
    if (isPhone && ticketKey) window.scrollTo(0, 0);
  }, [isPhone, ticketKey]);

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
      onChange={(event) => {
        setTicketFilter('all');
        setQuery({ restaurant: event.target.value, ticket: '' }, true);
      }}
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

  const kpis = [
    [applied ? 'APPLIED TO INVENTORY' : 'PREPARED', `${readyRows.length} ${readyRows.length === 1 ? 'serving' : 'servings'}`,
      data?.settings?.enabled
        ? (applied ? 'Applied by the latest run' : 'Waiting for the background update')
        : 'Preview only · inventory unchanged',
      'var(--text)'],
    ['NEEDS REVIEW', `${blockedRows.length} ${blockedRows.length === 1 ? 'serving' : 'servings'}`,
      blockedRows.length
        ? `On ${ticketCounts.review} ${ticketCounts.review === 1 ? 'ticket' : 'tickets'} · the rest still count`
        : 'Nothing waiting',
      blockedRows.length ? 'var(--red)' : 'var(--text)'],
    ['ESTIMATED', `${estimatedRows.length} ${estimatedRows.length === 1 ? 'serving' : 'servings'}`,
      estimatedRows.length ? 'Counted · confirm once to reuse' : 'No estimates in use',
      estimatedRows.length ? 'var(--amber)' : 'var(--text)'],
    ['TYPED REQUESTS', typedMissing ? 'Partial' : 'Complete',
      typedMissing ? 'Shift4 lookup access pending' : 'Typed notes were read',
      typedMissing ? 'var(--amber)' : 'var(--text)'],
  ];

  const ticketSummary = (ticket) => {
    const review = ticket.rows.filter((row) => row.status === 'blocked').length;
    const estimated = ticket.rows.some((row) => row.status === 'ready' && row.estimated);
    return {
      text: review
        ? `${review} TO REVIEW`
        : estimated ? 'APPLIED · ESTIMATE USED' : 'APPLIED',
      color: review ? 'var(--red)' : estimated ? 'var(--amber)' : 'var(--green)',
    };
  };

  function renderTicketCard(ticket, asLink) {
    const on = !isPhone && activeTicket?.key === ticket.key;
    const state = ticketSummary(ticket);
    const inner = (
      <>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px 8px', fontSize: 10.5, letterSpacing: '0.1em', borderBottom: '1px dashed var(--paper-line)' }}>
          <span style={{ fontWeight: 600 }}>#{ticket.number || '—'}</span>
          <span style={{ color: 'var(--ink-soft)' }}>{shortDate(ticket.date)}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 12px' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, fontWeight: 800 }}>
              {ticket.rows.length} {ticket.rows.length === 1 ? 'serving' : 'servings'}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: state.color }}>{state.text}</span>
          </span>
          {asLink && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          )}
        </span>
      </>
    );
    const style = {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      border: 0,
      outline: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
      outlineOffset: 1,
      background: 'var(--paper)',
      color: 'var(--ink)',
      borderRadius: 4,
      padding: 0,
      cursor: 'pointer',
      fontFamily: MONO,
      textDecoration: 'none',
      boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)',
    };

    return asLink ? (
      <Link
        key={ticket.key}
        href={{ pathname: router.pathname, query: { ...router.query, ticket: ticket.key } }}
        shallow
        scroll={false}
        style={style}
      >
        {inner}
      </Link>
    ) : (
      <button
        key={ticket.key}
        type="button"
        aria-pressed={on}
        onClick={() => setQuery({ ticket: ticket.key }, true)}
        style={style}
      >
        {inner}
      </button>
    );
  }

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
    const reason = row.reason || (status === 'ESTIMATED'
      ? (row.plan?.explanation || 'This portion is an estimate. It already counts. Confirm it once and matching orders reuse it.')
      : '');
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

        {row.rule_available && (row.status === 'blocked' || (row.status === 'ready' && row.estimated)) && (
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
              {row.plan?.explanation && status !== 'ESTIMATED' && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>{row.plan.explanation}</p>
              )}
              {row.instructions && (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
                  {row.typed_requests_available
                    ? 'Typed requests were read for this dish.'
                    : 'Typed requests were not available for this dish.'}
                </p>
              )}
              {row.rule_available && !row.estimated && (
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

  function renderTicketDetail(ticket) {
    return ticket.rows.map((row, index) => (
      <Fragment key={`${row.line_key}:${row.unit_index || 0}`}>
        {renderDish(row, index)}
      </Fragment>
    ));
  }

  const ticketHeader = (ticket) => {
    const review = blocked(ticket);
    return {
      tag: review ? 'NEEDS REVIEW' : 'READY',
      label: review ? `${ticket.rows.filter((row) => row.status === 'blocked').length} TO REVIEW` : 'APPLIED',
    };
  };

  const filters = (
    <Segmented
      label="Filter tickets"
      value={ticketFilter}
      onChange={(key) => {
        setTicketFilter(key);
        setQuery({ ticket: '' }, true);
      }}
      options={[
        ['all', `All · ${ticketCounts.all}`],
        ['review', `Review · ${ticketCounts.review}`],
        ['ready', `Applied · ${ticketCounts.ready}`],
      ]}
    />
  );

  const emptyTickets = (
    <p style={{ color: 'var(--muted)', fontSize: 13, padding: 8, margin: 0 }}>
      {report.length
        ? 'No tickets match this filter.'
        : 'Usage is prepared after POS sync or when you save a usage correction.'}
    </p>
  );

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

  const phoneDetail = isPhone && activeTicket;

  return (
    <AdminShell
      section="Platform"
      sub="Ingredient usage"
      title="POS ingredient usage"
      back={phoneDetail ? {
        label: 'Tickets',
        href: { pathname: router.pathname, query: { restaurant: restaurantId } },
        actions: <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)' }}>#{activeTicket.number || '—'}</span>,
      } : undefined}
    >
      <style jsx global>{`
        .pu-seg { display: flex; background: var(--panel); border-radius: 10px; padding: 3px; gap: 2px; }
        .pu-seg button { flex: 1; min-height: 34px; border: 0; border-radius: 8px; background: transparent; font: 600 12.5px 'Manrope', sans-serif; color: var(--muted); cursor: pointer; white-space: nowrap; padding: 0 10px; }
        .pu-seg button[aria-pressed="true"] { background: var(--shell); color: var(--text); box-shadow: 0 1px 2px rgba(17,24,25,0.10); }
        .pu-portion input { text-align: right; font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {phoneDetail ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <Kicker>{restaurantName.toUpperCase()}</Kicker>
              <Tag status={ticketHeader(activeTicket).tag} />
            </div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: '-0.04em' }}>Ticket {activeTicket.number || '—'}</h1>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>
              {shortDate(activeTicket.date)} · {activeTicket.rows.length} {activeTicket.rows.length === 1 ? 'serving' : 'servings'}
            </div>
          </section>
          {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}
          {renderTicketDetail(activeTicket)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 20 }}>
          <PageHead
            kicker={data?.settings && !isPhone
              ? (data.settings.enabled
                ? `PLATFORM · ACTIVE FOR INVENTORY SINCE ${shortDate(data.settings.start_date)}`
                : `PLATFORM · PREVIEW FROM ${shortDate(data.settings.start_date)}`)
              : 'PLATFORM'}
            title={isPhone ? 'Ingredient usage' : 'POS ingredient usage'}
            sub={isPhone
              ? 'What each ticket took out of inventory.'
              : 'What every ticket took out of inventory, dish by dish. Modifiers are applied to the recipe first, then quantities are converted into each ingredient’s inventory unit.'}
          >
            {!isPhone && selectRestaurant}
            {!isPhone && actions}
          </PageHead>

          {isPhone && selectRestaurant}

          {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

          {setupCard}

          {data?.settings && !isPhone && (
            <section aria-label="Summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {kpis.map(([label, value, sub, color]) => (
                <div key={label} style={{ padding: '16px 20px', borderRight: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Kicker>{label}</Kicker>
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color }}>{value}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
                </div>
              ))}
            </section>
          )}

          {data?.settings && isPhone && (
            <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ padding: '12px 14px', borderRight: '1px solid var(--line-soft)', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em' }}>{readyRows.length}</div>
                  <Kicker style={{ fontSize: 9.5, letterSpacing: '0.12em' }}>{applied ? 'APPLIED' : 'PREPARED'}</Kicker>
                </div>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: blockedRows.length ? 'var(--red)' : 'var(--text)' }}>{blockedRows.length}</div>
                  <Kicker style={{ fontSize: 9.5, letterSpacing: '0.12em' }}>TO REVIEW</Kicker>
                </div>
              </div>
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: data.settings.enabled ? 'var(--green)' : 'var(--faint)' }} />
                  <span style={{ flex: 1 }}>
                    {data.settings.enabled
                      ? (applied ? 'Active for inventory · up to date' : 'Active · waiting for the background update')
                      : 'Preview only · inventory unchanged'}
                  </span>
                </div>
                {estimatedRows.length > 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>
                    {estimatedRows.length} estimated {estimatedRows.length === 1 ? 'serving' : 'servings'} counted · confirm once to reuse
                  </div>
                )}
                {typedMissing && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber)', background: 'var(--amber-tint)', borderRadius: 8, padding: '8px 10px' }}>
                    Typed kitchen requests are partial until Shift4 grants lookup access.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>{actions}</div>
              </div>
            </section>
          )}

          {!isPhone && data?.job?.last_error && (
            <div style={{ fontSize: 13, lineHeight: 1.5, background: 'var(--red-tint)', borderRadius: 8, padding: '10px 12px' }}>
              Last worker error: {data.job.last_error}
            </div>
          )}

          {!isPhone && typedMissing && data?.settings && (
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', background: 'var(--amber-tint)', borderRadius: 8, padding: '10px 12px' }}>
              <strong>Typed kitchen requests are incomplete.</strong> Preset modifiers from Shift4 are applied. Typed requests will be included once lookup access is granted.
            </div>
          )}

          {data?.settings && isPhone && (
            <>
              {filters}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredTickets.map((ticket) => renderTicketCard(ticket, true))}
                {!filteredTickets.length && emptyTickets}
              </div>
            </>
          )}

          {data?.settings && !isPhone && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
                <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--panel)', borderRadius: 12, padding: 14 }}>
                  {filters}
                  {filteredTickets.map((ticket) => renderTicketCard(ticket, false))}
                  {!filteredTickets.length && emptyTickets}
                </aside>

                {activeTicket ? (
                  <section aria-labelledby="pu-ticket" style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--shell)', minWidth: 0 }}>
                    <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <h2 id="pu-ticket" style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>
                          Ticket {activeTicket.number || '—'}
                        </h2>
                        <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>
                          {shortDate(activeTicket.date)} · {activeTicket.rows.length} {activeTicket.rows.length === 1 ? 'serving' : 'servings'}
                        </div>
                      </div>
                      <Tag status={ticketHeader(activeTicket).tag} />
                    </div>
                    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {renderTicketDetail(activeTicket)}
                    </div>
                  </section>
                ) : (
                  <section style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 28, color: 'var(--muted)', fontSize: 13.5, textAlign: 'center' }}>
                    Choose a ticket to see what it used.
                  </section>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--muted)', paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                <span>
                  {data.settings.enabled
                    ? 'Ready servings apply automatically. Servings in review wait without holding up anything else.'
                    : 'Preview only. Inventory is unchanged until you choose Use for inventory.'}
                </span>
                <span style={{ fontFamily: MONO }}>
                  {blockedRows.length} {blockedRows.length === 1 ? 'SERVING' : 'SERVINGS'} TO REVIEW · {estimatedRows.length} ESTIMATED
                </span>
              </div>
            </>
          )}

          {!restaurantId && (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>Choose a restaurant to see its ingredient usage.</p>
          )}
        </div>
      )}

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

                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="om-field"
                    aria-label="Add an ingredient"
                    value={addId}
                    disabled={busy}
                    onChange={(event) => setAddId(event.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="">Add an ingredient</option>
                    {data.ingredients
                      .filter((ingredient) => !portions.some((portion) => portion.id === ingredient.id))
                      .map((ingredient) => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.name} ({ingredient.unit})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy || !addId}
                    onClick={() => {
                      setPortions([...portions, { id: addId, quantity: '' }]);
                      setAddId('');
                    }}
                  >
                    Add
                  </button>
                </div>

                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)', background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
                  Saved as a rule for every <strong style={{ color: 'var(--text)' }}>{editing.dish}</strong> with these same instructions. Zero removes an ingredient. Other dishes are not changed.
                </div>

                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent-deep)', fontSize: 13, fontWeight: 700, padding: '4px 0' }}>
                    Fix a unit conversion instead
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
                      Use a package label, a measurement or a documented estimate. It applies to this ingredient everywhere.
                    </p>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                      Ingredient
                      <select
                        className="om-field"
                        value={conversion.ingredientId}
                        onChange={(event) => {
                          const picked = dishIngredients.find(({ ingredient }) =>
                            ingredient.id === event.target.value
                          );
                          setConversion({
                            ...conversion,
                            ingredientId: event.target.value,
                            fromUnit: UNITS.includes(picked?.recipeUnit)
                              ? picked.recipeUnit
                              : conversion.fromUnit,
                          });
                        }}
                      >
                        <option value="">Choose an ingredient in this dish</option>
                        {dishIngredients.map(({ ingredient, recipeUnit }) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name} ({recipeUnit
                              ? `recipe uses ${recipeUnit}, counted in ${ingredient.unit}`
                              : ingredient.unit})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                        From unit
                        <select
                          className="om-field"
                          value={conversion.fromUnit}
                          onChange={(event) => setConversion({ ...conversion, fromUnit: event.target.value })}
                        >
                          {UNITS.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                        1 {conversion.fromUnit} = this many {target?.unit || 'units'}
                        <input
                          className="om-field"
                          type="number"
                          min="0"
                          step="any"
                          value={conversion.factor}
                          onChange={(event) => setConversion({ ...conversion, factor: event.target.value })}
                        />
                      </label>
                    </div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                      Basis
                      <select
                        className="om-field"
                        value={conversion.basis}
                        onChange={(event) => setConversion({ ...conversion, basis: event.target.value })}
                      >
                        <option value="estimated">Estimate</option>
                        <option value="measured">Measured</option>
                        <option value="package_label">Package label</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                      Source or explanation
                      <input
                        className="om-field"
                        value={conversion.evidence}
                        onChange={(event) => setConversion({ ...conversion, evidence: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="om-btn"
                      style={{ alignSelf: 'flex-start' }}
                      disabled={
                        busy ||
                        !conversion.ingredientId ||
                        !conversion.evidence.trim() ||
                        !Number.isFinite(Number(conversion.factor)) ||
                        Number(conversion.factor) <= 0 ||
                        conversion.fromUnit === target?.unit
                      }
                      onClick={() => act('conversion', {
                        ...conversion,
                        factor: Number(conversion.factor),
                        toUnit: target?.unit,
                      })}
                    >
                      Save conversion and recalculate
                    </button>
                  </div>
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
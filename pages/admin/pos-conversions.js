import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';

const SOURCES = {
  missing: ['Missing', 'var(--accent-tint)', 'var(--accent-deep)'],
  ai: ['AI estimate', 'var(--amber-tint)', 'var(--amber)'],
  shared: ['Shared average', 'var(--amber-tint)', 'var(--amber)'],
  density: ['Typical density', 'var(--amber-tint)', 'var(--amber)'],
  package_label: ['Package label', 'var(--green-tint)', 'var(--green)'],
  confirmed: ['You confirmed', 'var(--green-tint)', 'var(--green)'],
  set: ['You set it', 'var(--green-tint)', 'var(--green)'],
};

const GROUPS = [
  {
    key: 'missing',
    title: 'Needs a number',
    note: 'These dishes wait in Needs review until you fill it in.',
    dot: 'var(--accent)',
    sources: ['missing'],
  },
  {
    key: 'estimate',
    title: 'AI estimates',
    note: 'Already counting. Confirm them, or change the number and past dishes are fixed.',
    dot: 'var(--amber)',
    sources: ['ai', 'shared', 'density'],
  },
  {
    key: 'confirmed',
    title: 'Confirmed',
    note: 'From a package label or you. Still editable.',
    dot: 'var(--green)',
    sources: ['package_label', 'confirmed', 'set'],
  },
];

const ESTIMATES = ['ai', 'shared', 'density'];

export default function PosConversions() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const isPhone = useIsPhone();

  const restaurantId = typeof router.query.restaurant === 'string'
    ? router.query.restaurant
    : '';
  const focus = typeof router.query.ingredient === 'string'
    ? router.query.ingredient
    : '';

  const [restaurants, setRestaurants] = useState([]);
  const [rows, setRows] = useState(null);
  const [values, setValues] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function request(url, body) {
    const response = await adminFetch(
      url,
      body ? { method: 'POST', body: JSON.stringify(body) } : {}
    );
    const json = await response.json();

    if (!response.ok) throw new Error(json.error || 'Request failed');

    return json;
  }

  useEffect(() => {
    let live = true;

    request('/api/admin/pos-conversions')
      .then((json) => { if (live) setRestaurants(json.restaurants); })
      .catch((error) => { if (live) setMessage(error.message); });

    return () => { live = false; };
  }, [adminFetch]);

  useEffect(() => {
    let live = true;

    setRows(null);
    setValues({});
    setMessage('');

    if (restaurantId) {
      request(`/api/admin/pos-conversions?restaurantId=${restaurantId}`)
        .then((json) => { if (live) setRows(json.rows); })
        .catch((error) => { if (live) setMessage(error.message); });
    }

    return () => { live = false; };
  }, [restaurantId, adminFetch]);

  // Land on the ingredient the usage page sent you to.
  useEffect(() => {
    if (!rows || !focus) return;

    const element = document.getElementById(`conv-${focus}`);

    if (element) {
      element.scrollIntoView({ block: 'center' });
      element.querySelector('input')?.focus();
    }
  }, [rows, focus]);

  const keyOf = (row) => `${row.ingredient_id}:${row.from}`;

  async function save(row, confirm) {
    const key = keyOf(row);
    const factor = Number(values[key] ?? row.factor);

    setBusy(key);
    setMessage('');

    try {
      const result = await request('/api/admin/pos-conversions', {
        restaurantId,
        ingredientId: row.ingredient_id,
        fromUnit: row.from,
        toUnit: row.to,
        factor,
        confirm,
      });
      const json = await request(
        `/api/admin/pos-conversions?restaurantId=${restaurantId}`
      );

      setRows(json.rows);
      setValues((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      setMessage(result.usage?.error
        ? `Saved ${row.name}. Recounting failed: ${result.usage.error}. It retries on the next run.`
        : `Saved ${row.name}. Past dishes were recounted.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  function renderRow(row) {
    const key = keyOf(row);
    const value = values[key] ?? (row.factor ?? '');
    const edited = values[key] !== undefined &&
      String(values[key]) !== String(row.factor ?? '');
    const [label, bg, fg] = SOURCES[row.source];
    const estimate = ESTIMATES.includes(row.source);
    const confirm = estimate && !edited;
    const showButton = row.source === 'missing' || estimate || edited;
    const used = [
      row.waiting ? `${row.waiting} waiting` : '',
      row.dishes.join(', ') +
        (row.dish_count > row.dishes.length
          ? ` +${row.dish_count - row.dishes.length} more`
          : ''),
    ].filter(Boolean).join(' · ');

    return (
      <div
        key={key}
        id={`conv-${row.ingredient_id}`}
        className="pc-row"
        data-focus={focus === row.ingredient_id ? '' : undefined}
      >
        <div className="pc-name">
          <strong>{row.name}</strong>
          {used && <span>{used}</span>}
          {row.note && <span className="pc-note">{row.note}</span>}
        </div>
        <span className="pc-qty">1 <em>{row.from}</em></span>
        <span className="pc-eq" aria-hidden="true">=</span>
        <span className="pc-inv">
          <input
            className="om-field"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder="?"
            aria-label={`${row.name}: ${row.to} in one ${row.from}`}
            value={value}
            disabled={Boolean(busy)}
            data-missing={row.source === 'missing' ? '' : undefined}
            onChange={(event) => setValues({ ...values, [key]: event.target.value })}
          />
          <span>{row.to}</span>
        </span>
        <span>
          <span className="pc-chip" style={{ background: bg, color: fg }}>{label}</span>
        </span>
        <span>
          {showButton && (
            <button
              type="button"
              className={confirm ? 'om-btn pc-btn' : 'om-pri pc-btn'}
              disabled={Boolean(busy) || !(Number(value) > 0)}
              onClick={() => save(row, confirm)}
            >
              {busy === key ? 'Saving…' : confirm ? 'Confirm' : 'Save'}
            </button>
          )}
        </span>
      </div>
    );
  }

  const shown = (rows || []).filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <AdminShell section="Platform" sub="Conversions" title="Conversions">
      <style jsx global>{`
        .om-app .pc-section { background: var(--shell); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
        .om-app .pc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 16px 20px; background: var(--panel); }
        .om-app .pc-head h2 { margin: 0; font-size: 15px; font-weight: 800; }
        .om-app .pc-head span:last-child { font-size: 12.5px; color: var(--muted); }
        .om-app .pc-dot { width: 10px; height: 10px; border-radius: 50%; }
        .om-app .pc-row, .om-app .pc-cols { display: grid; grid-template-columns: minmax(0, 1.5fr) 140px 24px 200px 140px 110px; gap: 16px; align-items: center; padding: 14px 20px; border-top: 1px solid var(--line-soft); }
        .om-app .pc-cols { padding-top: 9px; padding-bottom: 9px; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: 0.1em; color: var(--muted); }
        .om-app .pc-row[data-focus] { background: var(--accent-tint); }
        .om-app .pc-name { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .om-app .pc-name strong { font-size: 14.5px; }
        .om-app .pc-name span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
        .om-app .pc-note { font-style: italic; }
        .om-app .pc-qty { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; border-radius: 10px; background: var(--panel); font: 600 14px 'IBM Plex Mono', monospace; }
        .om-app .pc-qty em { font-style: normal; font-weight: 500; color: var(--muted); }
        .om-app .pc-eq { font: 700 16px 'IBM Plex Mono', monospace; color: var(--muted); text-align: center; }
        .om-app .pc-inv { display: flex; align-items: center; gap: 8px; }
        .om-app .pc-inv input { width: 84px; min-height: 40px; border-radius: 10px; padding: 0 10px; text-align: right; font-family: 'IBM Plex Mono', monospace; }
        .om-app .pc-inv input[data-missing] { border: 2px solid var(--accent); }
        .om-app .pc-inv > span { font: 600 14px 'IBM Plex Mono', monospace; }
        .om-app .pc-chip { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 10px; white-space: nowrap; }
        .om-app .pc-btn { width: 100%; min-height: 40px; justify-content: center; border-radius: 20px; }
        .om-app .om-btn.pc-btn { border-color: var(--accent); color: var(--accent-deep); }
        @media (max-width: 820px) {
          .om-app .pc-cols { display: none; }
          .om-app .pc-row { grid-template-columns: auto 16px minmax(0, 1fr); gap: 10px 12px; }
          .om-app .pc-name { grid-column: 1 / -1; }
          .om-app .pc-row > span:nth-last-child(2), .om-app .pc-row > span:last-child { grid-column: 1 / -1; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 20 }}>
        <PageHead
          kicker="PLATFORM"
          title="Conversions"
          sub={isPhone ? undefined : 'Where a recipe unit does not match how you buy and count it. Change a number and past dishes are recounted.'}
        >
          <select
            aria-label="Restaurant"
            className="om-field"
            value={restaurantId}
            disabled={Boolean(busy)}
            style={{ width: isPhone ? '100%' : 240, minHeight: 38, borderRadius: 20 }}
            onChange={(event) => router.replace(
              { pathname: router.pathname, query: event.target.value ? { restaurant: event.target.value } : {} },
              undefined,
              { shallow: true }
            )}
          >
            <option value="">Choose restaurant</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name || 'Unnamed restaurant'}
              </option>
            ))}
          </select>
          <input
            className="om-field"
            placeholder="Search ingredients"
            aria-label="Search ingredients"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: isPhone ? '100%' : 220, borderRadius: 20 }}
          />
        </PageHead>

        {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

        {!restaurantId && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Choose a restaurant to see its conversions.
          </p>
        )}

        {restaurantId && !rows && !message && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>Loading…</p>
        )}

        {rows && !rows.length && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Every recipe unit already matches its inventory unit.
          </p>
        )}

        {rows && GROUPS.map((group) => {
          const list = shown.filter((row) => group.sources.includes(row.source));

          if (!list.length) return null;

          return (
            <section key={group.key} className="pc-section">
              <div className="pc-head">
                <span className="pc-dot" style={{ background: group.dot }} />
                <h2>{group.title}</h2>
                <span>{group.note}</span>
              </div>
              <div className="pc-cols" aria-hidden="true">
                <span>INGREDIENT</span>
                <span>ON RECIPE</span>
                <span />
                <span>IN INVENTORY</span>
                <span>SOURCE</span>
                <span />
              </div>
              {list.map(renderRow)}
            </section>
          );
        })}
      </div>
    </AdminShell>
  );
}
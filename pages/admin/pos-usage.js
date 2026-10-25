import { useEffect, useState } from 'react';
import { convertQuantity } from '../../lib/computeWasteRisk';
import AdminShell from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

export default function PosUsage() {
  const { adminFetch } = useAdminFetch();

  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState('2026-10-24');
  const [editing, setEditing] = useState(null);
  const [portions, setPortions] = useState([]);
  const [addId, setAddId] = useState('');

  const card = {
    overflowWrap: 'anywhere',
    padding: 16,
    border: '1px solid var(--line)',
    borderRadius: 12,
    background: 'var(--shell)',
    marginTop: 12,
  };

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

  const hasMissingRequests = report.some((row) =>
    row.instructions && !row.typed_requests_available
  );

  function formatQty(value) {
    return Number.isFinite(value)
      ? Number(value.toFixed(4)).toLocaleString('en-US', {
          maximumFractionDigits: 4,
        })
      : '—';
  }

  function ingredientRows(row) {
    const base = row.base || [];
    const adjusted = row.adjusted;
    const parts = new Map();

    for (const part of base) {
      parts.set(part.id, {
        ...part,
        before: part.quantity,
        quantity: adjusted ? 0 : part.quantity,
        changed: Boolean(adjusted && part.quantity !== 0),
      });
    }

    for (const part of adjusted || []) {
      const original = base.find((candidate) =>
        candidate.id === part.id
      );

      const before = original
        ? convertQuantity(
            original.quantity,
            original.unit,
            part.unit,
            part.name
          )
        : 0;

      parts.set(part.id, {
        ...part,
        before,
        changed: !Number.isFinite(before) ||
          Math.abs(before - part.quantity) > 0.000001,
      });
    }

    return [...parts.values()];
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

    if (restaurantId) {
      request(
        `/api/admin/pos-usage?restaurantId=${restaurantId}`
      )
        .then((json) => {
          if (live) setData(json);
        })
        .catch((error) => {
          if (live) setMessage(error.message);
        });
    }

    return () => { live = false; };
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
        action === 'prepare'
          ? result.ready
            ? 'Ready to review.'
            : 'Review blocked dishes below. Pending interpretations can be continued with Prepare again.'
          : 'Saved.'
      );

      setEditing(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function edit(row) {
    try {
      const next = (row.adjusted || row.base || [])
        .map((part) => {
          const ingredient = data.ingredients.find(
            (candidate) => candidate.id === part.id
          );

          const quantity = ingredient && convertQuantity(
            part.quantity,
            part.unit,
            ingredient.unit,
            ingredient.name
          );

          if (!Number.isFinite(quantity)) {
            throw new Error(
              'Correct the ingredient unit mapping before editing this rule.'
            );
          }

          return {
            id: part.id,
            quantity: String(quantity),
          };
        });

      setPortions(next);
      setEditing(row);
      setAddId('');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <AdminShell
      section="Platform"
      sub="POS connections"
      title="POS ingredient usage"
    >
      <h1>POS ingredient usage</h1>

      <p>
        Review individual dishes and estimated modifier portions.
        Preview does not change inventory.
      </p>

      <select
        className="om-field"
        value={restaurantId}
        disabled={busy}
        onChange={(event) => setRestaurantId(event.target.value)}
      >
        <option value="">Choose restaurant</option>

        {restaurants.map((restaurant) => (
          <option key={restaurant.id} value={restaurant.id}>
            {restaurant.name || 'Unnamed restaurant'}
          </option>
        ))}
      </select>

      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <div style={card}>
            {!data.settings ? (
              <>
                <label>
                  Start with tickets dated
                  <input
                    className="om-field"
                    type="date"
                    value={startDate}
                    onChange={(event) =>
                      setStartDate(event.target.value)
                    }
                  />
                </label>

                <button
                  type="button"
                  className="om-pri"
                  disabled={busy}
                  onClick={() => act('setup', { startDate })}
                >
                  Set up preview
                </button>
              </>
            ) : (
              <>
                <p>
                  {data.settings.enabled
                    ? 'Active for inventory'
                    : 'Preview only'}
                  {' · From '}
                  {data.settings.start_date}
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="om-pri"
                    disabled={busy}
                    onClick={() => act('prepare')}
                  >
                    {busy ? 'Working…' : 'Prepare / refresh'}
                  </button>

                  {!data.settings.enabled && (
                    <button
                      type="button"
                      className="om-btn"
                      disabled={busy || !data.result?.ready}
                      onClick={() => act('enable')}
                    >
                      Use for inventory
                    </button>
                  )}

                  {data.settings.enabled && (
                    <button
                      type="button"
                      className="om-btn"
                      disabled={busy}
                      onClick={() => act('disable')}
                    >
                      Return to standard recipes
                    </button>
                  )}
                </div>

                {hasMissingRequests && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: '10px 12px',
                      borderLeft: '3px solid var(--amber)',
                      background: 'var(--amber-tint)',
                      borderRadius: 6,
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    <strong>Typed kitchen instructions are incomplete.</strong>
                    {' '}
                    These results include the preset modifiers received
                    from Shift4. Typed requests will be included when
                    lookup access is available.
                  </div>
                )}
              </>
            )}
          </div>

          {ticketGroups.map((ticket) => (
            <section
              key={ticket.key}
              style={{
                marginTop: 24,
                border: '1px solid var(--line)',
                borderRadius: 14,
                background: 'var(--shell)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    Ticket {ticket.number || '—'}
                  </h2>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    {ticket.date} · {ticket.rows.length} dish entries
                  </div>
                </div>

                {ticket.rows.some((row) => row.status === 'blocked') ? (
                  <span
                    style={{
                      color: 'var(--red)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Needs review
                  </span>
                ) : (
                  <span
                    style={{
                      color: 'var(--muted)',
                      fontSize: 12,
                    }}
                  >
                    Prepared
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
                  gap: 12,
                  padding: 12,
                }}
              >
                {ticket.rows.map((row, index) => {
                  const ingredients = ingredientRows(row);
                  const changes = ingredients.filter((part) => part.changed);
                  const modifiers = row.instructions?.modifiers || [];
                  const requests = [
                    ...(row.instructions?.requests || []),
                    ...modifiers.flatMap((modifier) =>
                      modifier.requests || []
                    ),
                  ].filter((text) => text.trim());

                  const statusColor = row.status === 'blocked'
                    ? 'var(--red)'
                    : row.estimated
                      ? 'var(--amber)'
                      : 'var(--muted)';

                  return (
                    <article
                      key={`${row.line_key}:${row.unit_index || 0}`}
                      style={{
                        minWidth: 0,
                        padding: 14,
                        border: '1px solid var(--line)',
                        borderRadius: 10,
                        overflowWrap: 'anywhere',
                        alignSelf: 'start',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 8,
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        <span style={{ color: 'var(--muted)' }}>
                          DISH {index + 1}
                        </span>
                        <span style={{ color: statusColor }}>
                          {row.status === 'blocked'
                            ? 'NEEDS REVIEW'
                            : row.status === 'excluded'
                              ? 'EXCLUDED'
                              : row.estimated
                                ? 'ESTIMATED'
                                : 'READY'}
                        </span>
                      </div>

                      <h3
                        style={{
                          margin: 0,
                          fontSize: 16,
                          lineHeight: 1.4,
                        }}
                      >
                        {row.dish}
                      </h3>

                      <div
                        style={{
                          marginTop: 9,
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        {modifiers.length ? modifiers.map((modifier, i) => (
                          <span
                            key={i}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 12,
                              background: 'var(--accent-tint)',
                              color: 'var(--accent-deep)',
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            {modifier.name}
                          </span>
                        )) : (
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--muted)',
                            }}
                          >
                            {requests.length
                              ? 'Typed instructions'
                              : 'Standard order'}
                          </span>
                        )}
                      </div>

                      {requests.length > 0 && (
                        <p
                          style={{
                            margin: '10px 0 0',
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: 'var(--muted)',
                          }}
                        >
                          {requests.join(' · ')}
                        </p>
                      )}

                      {row.status === 'ready' && (
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 10,
                            borderTop: '1px solid var(--line)',
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          {changes.length ? changes.map((part) => (
                            <div key={part.id}>
                              <strong>{part.name}</strong>
                              {' · '}
                              {part.quantity === 0
                                ? 'Removed'
                                : part.before === 0
                                  ? `Added ${formatQty(part.quantity)} ${part.unit}`
                                  : `${formatQty(part.before)} → ${formatQty(part.quantity)} ${part.unit}`}
                            </div>
                          )) : (
                            <span style={{ color: 'var(--muted)' }}>
                              Standard recipe quantities
                            </span>
                          )}
                        </div>
                      )}

                      {row.reason && (
                        <p
                          style={{
                            margin: '12px 0 0',
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: statusColor,
                          }}
                        >
                          {row.reason}
                        </p>
                      )}

                      {row.reason === 'Choose the matching OptiMenu dish' && (
                        <select
                          aria-label={`Match recipe for ${row.dish}`}
                          className="om-field"
                          style={{ marginTop: 12, minWidth: 0 }}
                          disabled={busy}
                          defaultValue=""
                          onChange={(event) =>
                            event.target.value && act('map', {
                              itemRef: row.item_ref,
                              menuId: event.target.value,
                            })
                          }
                        >
                          <option value="">Choose matching recipe</option>
                          <option value="__exclude__">
                            No tracked ingredients — exclude this POS item
                          </option>
                          {data.menus.map((menu) => (
                            <option key={menu.id} value={menu.id}>
                              {menu.name}
                            </option>
                          ))}
                        </select>
                      )}

                      {(ingredients.length > 0 || row.plan?.explanation) && (
                        <details style={{ marginTop: 12 }}>
                          <summary
                            style={{
                              cursor: 'pointer',
                              color: 'var(--accent-deep)',
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '6px 0',
                            }}
                          >
                            Ingredients & calculation
                          </summary>

                          {ingredients.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  paddingBottom: 7,
                                  color: 'var(--muted)',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  letterSpacing: '0.08em',
                                }}
                              >
                                <span>INGREDIENT</span>
                                <span>
                                  {row.status === 'ready'
                                    ? 'USAGE'
                                    : 'BASE RECIPE'}
                                </span>
                              </div>

                              {ingredients.map((part) => (
                                <div
                                  key={part.id}
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                                    gap: 12,
                                    padding: '8px 0',
                                    borderTop: '1px solid var(--line)',
                                    fontSize: 13,
                                    alignItems: 'baseline',
                                  }}
                                >
                                  <span
                                    style={{
                                      color: part.quantity === 0
                                        ? 'var(--muted)'
                                        : 'var(--text)',
                                      textDecoration: part.quantity === 0
                                        ? 'line-through'
                                        : 'none',
                                    }}
                                  >
                                    {part.name}
                                  </span>
                                  <strong
                                    style={{
                                      whiteSpace: 'nowrap',
                                      fontVariantNumeric: 'tabular-nums',
                                      color: part.changed
                                        ? 'var(--accent-deep)'
                                        : 'var(--text)',
                                    }}
                                  >
                                    {formatQty(part.quantity)} {part.unit}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          )}

                          {row.plan?.explanation && (
                            <p
                              style={{
                                margin: '12px 0 0',
                                paddingTop: 10,
                                borderTop: '1px solid var(--line)',
                                color: 'var(--muted)',
                                fontSize: 12,
                                lineHeight: 1.65,
                              }}
                            >
                              {row.plan.explanation}
                            </p>
                          )}

                          {row.instructions && (
                            <p
                              style={{
                                margin: '10px 0 0',
                                fontSize: 11,
                                color: 'var(--muted)',
                              }}
                            >
                              {row.typed_requests_available
                                ? 'Typed-request retrieval complete.'
                                : 'Typed requests unavailable for this dish.'}
                            </p>
                          )}

                          {row.rule_available && (
                            <button
                              type="button"
                              className="om-btn"
                              style={{ marginTop: 12 }}
                              disabled={busy}
                              onClick={() => edit(row)}
                            >
                              Edit portions
                            </button>
                          )}
                        </details>
                      )}

                      {row.rule_available &&
                        ingredients.length === 0 &&
                        !row.plan?.explanation && (
                          <button
                            type="button"
                            className="om-btn"
                            style={{ marginTop: 12 }}
                            disabled={busy}
                            onClick={() => edit(row)}
                          >
                            Edit portions
                          </button>
                        )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {editing && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Set ingredient portions"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2000,
                background: 'var(--shell)',
                color: 'var(--text)',
                overflowY: 'auto',
                padding: 20,
                boxSizing: 'border-box',
              }}
            >
              <div style={{ maxWidth: 640, margin: 'auto' }}>
                <h2>{editing.dish} — one serving</h2>

                <p>
                  Set final quantities, including unchanged
                  ingredients. Zero removes an ingredient.
                  This rule is reused for the same recipe
                  and instructions.
                </p>

                {portions.map((portion, index) => {
                  const ingredient = data.ingredients.find(
                    (candidate) => candidate.id === portion.id
                  );

                  return (
                    <label
                      key={portion.id}
                      style={{
                        display: 'block',
                        marginBottom: 12,
                      }}
                    >
                      {ingredient?.name} ({ingredient?.unit})

                      <input
                        className="om-field"
                        type="number"
                        min="0"
                        step="any"
                        value={portion.quantity}
                        disabled={busy}
                        onChange={(event) =>
                          setPortions(portions.map((value, i) =>
                            i === index
                              ? {
                                  ...value,
                                  quantity: event.target.value,
                                }
                              : value
                          ))
                        }
                      />
                    </label>
                  );
                })}

                <select
                  className="om-field"
                  value={addId}
                  disabled={busy}
                  onChange={(event) => setAddId(event.target.value)}
                >
                  <option value="">Add an ingredient</option>

                  {data.ingredients
                    .filter((ingredient) =>
                      !portions.some((portion) =>
                        portion.id === ingredient.id
                      )
                    )
                    .map((ingredient) => (
                      <option
                        key={ingredient.id}
                        value={ingredient.id}
                      >
                        {ingredient.name} ({ingredient.unit})
                      </option>
                    ))}
                </select>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy || !addId}
                    onClick={() => {
                      setPortions([
                        ...portions,
                        { id: addId, quantity: '0' },
                      ]);
                      setAddId('');
                    }}
                  >
                    Add
                  </button>

                  <button
                    type="button"
                    className="om-pri"
                    disabled={
                      busy ||
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
                    Save rule
                  </button>

                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Close
                  </button>
                </div>

                {message && <p role="status">{message}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
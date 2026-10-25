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

                <p>
                  Typed requests are available only after the
                  Shift4 lookup succeeds. Missing requests are
                  marked on each dish.
                </p>
              </>
            )}
          </div>

          {(data.result?.report || []).map((row, index) => (
            <div
              key={`${row.line_key}:${index}`}
              style={card}
            >
              <strong>
                Ticket {row.ticket} · {row.dish}
                {row.unit_index
                  ? ` · Dish ${row.unit_index}`
                  : ''}
              </strong>

              <p>
                {row.status}
                {row.estimated ? ' · Estimated portion' : ''}
                {row.reason ? ` · ${row.reason}` : ''}
              </p>

              {row.instructions && (
                <>
                  <p>
                    {row.instructions.modifiers
                      .map((modifier) => modifier.name)
                      .join(', ') || 'No preset modifiers'}
                  </p>

                  <p>
                    {[
                      ...(row.instructions.requests || []),
                      ...row.instructions.modifiers.flatMap(
                        (modifier) => modifier.requests || []
                      ),
                    ].join('; ') || 'No typed text received'}
                  </p>

                  {!row.typed_requests_available && (
                    <p>Typed-request retrieval incomplete.</p>
                  )}
                </>
              )}

              {row.adjusted?.map((part) => (
                <div key={part.id}>
                  {part.name}: {' '}
                  {Number(part.quantity.toFixed(4))} {part.unit}
                </div>
              ))}

              {row.plan?.explanation && (
                <p>{row.plan.explanation}</p>
              )}

              {row.reason ===
                'Choose the matching OptiMenu dish' && (
                <select
                  className="om-field"
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

              {row.rule_available && (
                <button
                  type="button"
                  className="om-btn"
                  disabled={busy}
                  onClick={() => edit(row)}
                >
                  Set portions for this combination
                </button>
              )}
            </div>
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

import { useCallback, useEffect, useRef, useState } from 'react';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { Card } from '../../components/admin/ui';
import { MONO } from '../../components/client/ClientChrome';

const TYPE_LABELS = {
  inventory: 'INVENTORY',
  margin: 'MARGIN',
  trending: 'SALES',
};

function RecommendationLab() {
  const { adminFetch } = useAdminFetch();
  const isPhone = useIsPhone();

  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);

  const loadRestaurants = useCallback(async () => {
    setLoadingRestaurants(true);
    setError('');

    try {
      const response = await adminFetch('/api/admin/restaurants');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not load restaurants');
      }

      setRestaurants(
        (data.restaurants || []).sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingRestaurants(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const filteredRestaurants = restaurants.filter(restaurant =>
    restaurant.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedRestaurant = restaurants.find(
    restaurant => restaurant.id === restaurantId
  );

  async function runTest() {
    if (!restaurantId || running) return;

    setRunning(true);
    setError('');

    const started = performance.now();

    try {
      const response = await adminFetch(
        '/api/admin/test-ai-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({ restaurantId }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Recommendation test failed');
      }

      const elapsedSeconds = (performance.now() - started) / 1000;

      setResults(previous => [{
        id: `${restaurantId}-${Date.now()}`,
        restaurantId,
        restaurantName: selectedRestaurant?.name || 'Restaurant',
        date: data.date,
        count: data.count,
        recommendations: data.recommendations || [],
        elapsedSeconds,
      }, ...previous]);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const latest = results[0];

  return (
    <>
      <PageHead
        kicker="PLATFORM"
        title="Recommendation Lab"
        sub="Test Tonight's Dish against restaurant data without saving or publishing recommendations."
      />

      <Card title="Run a test">
        <div style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
          alignItems: 'end',
        }}>
          <div
            ref={dropdownRef}
            style={{
              minWidth: 0,
              maxWidth: isPhone ? '100%' : 440,
              display: 'grid',
              gap: 8,
              position: 'relative',
            }}
          >
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>
              Restaurant
            </label>

            <div style={{ position: 'relative' }}>
              <input
                className="om-field"
                type="text"
                role="combobox"
                aria-label="Search and select restaurant"
                aria-autocomplete="list"
                aria-expanded={dropdownOpen}
                aria-controls="recommendation-restaurant-options"
                value={search}
                onFocus={() => setDropdownOpen(true)}
                onChange={event => {
                  setSearch(event.target.value);
                  setRestaurantId('');
                  setDropdownOpen(true);
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setDropdownOpen(false);
                  }
                }}
                placeholder={
                  loadingRestaurants
                    ? 'Loading restaurants…'
                    : 'Search or select a restaurant'
                }
                disabled={running || loadingRestaurants}
                autoComplete="off"
                style={{ paddingRight: 34 }}
              />

              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  right: 13,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                  pointerEvents: 'none',
                  fontSize: 12,
                }}
              >
                ▾
              </span>

              {dropdownOpen && !loadingRestaurants && (
                <div
                  id="recommendation-restaurant-options"
                  role="listbox"
                  style={{
                    position: 'absolute',
                    zIndex: 20,
                    top: 'calc(100% + 5px)',
                    left: 0,
                    right: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    background: 'var(--shell)',
                    boxShadow: 'var(--shadow-lg)',
                    padding: 5,
                  }}
                >
                  {filteredRestaurants.length === 0 ? (
                    <div style={{
                      padding: '12px 10px',
                      color: 'var(--muted)',
                      fontSize: 13,
                    }}>
                      No restaurants found.
                    </div>
                  ) : (
                    filteredRestaurants.map(restaurant => (
                      <button
                        key={restaurant.id}
                        type="button"
                        role="option"
                        aria-selected={restaurantId === restaurant.id}
                        onClick={() => {
                          setRestaurantId(restaurant.id);
                          setSearch(restaurant.name);
                          setDropdownOpen(false);
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '10px 12px',
                          border: 0,
                          borderRadius: 6,
                          background:
                            restaurantId === restaurant.id
                              ? 'var(--accent-tint)'
                              : 'transparent',
                          color: 'var(--text)',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={event => {
                          event.currentTarget.style.background =
                            'var(--accent-tint)';
                        }}
                        onMouseLeave={event => {
                          event.currentTarget.style.background =
                            restaurantId === restaurant.id
                              ? 'var(--accent-tint)'
                              : 'transparent';
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          {restaurant.name}
                        </div>
                        <div style={{
                          marginTop: 3,
                          color: 'var(--muted)',
                          fontSize: 11,
                        }}>
                          {restaurant.menu_item_count} menu items ·{' '}
                          {restaurant.ingredient_count} ingredients
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="om-pri"
            disabled={!restaurantId || running}
            onClick={runTest}
            style={{
              minHeight: 38,
              justifyContent: 'center',
              width: isPhone ? '100%' : undefined,
            }}
          >
            {running ? 'Generating…' : 'Run dry test'}
          </button>
        </div>

        {selectedRestaurant && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            marginTop: 12,
            color: 'var(--muted)',
            fontSize: 12,
          }}>
            <span>{selectedRestaurant.menu_item_count} menu items</span>
            <span>{selectedRestaurant.ingredient_count} ingredients</span>
            <span>{selectedRestaurant.invoice_count} invoices</span>
          </div>
        )}

        <div style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--muted)',
        }}>
          Dry run only. Recommendations will not be saved. Each test
          makes a paid Claude API request.
        </div>
      </Card>

      {error && (
        <div role="alert" style={{
          padding: '12px 14px',
          borderRadius: 10,
          background: 'var(--red-tint)',
          color: 'var(--red)',
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {running && (
        <Card title="Generating recommendations">
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            Analyzing the selected restaurant's available data.
            This may take several seconds.
          </div>
        </Card>
      )}

      {latest && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isPhone
              ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(3, minmax(0, 1fr))',
            gap: 10,
          }}>
            {[
              ['RECOMMENDATIONS', `${latest.count} / 3`],
              ['EXECUTION TIME', `${latest.elapsedSeconds.toFixed(1)}s`],
              ['MODE', 'DRY RUN'],
            ].map(([label, value]) => (
              <div key={label} style={{
                padding: isPhone ? 13 : 18,
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                minWidth: 0,
              }}>
                <div style={{
                  color: 'var(--muted)',
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                }}>
                  {label}
                </div>
                <div style={{
                  marginTop: 7,
                  fontSize: isPhone ? 22 : 26,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <Card title={`Results · ${latest.restaurantName}`}>
            <div style={{
              fontSize: 12,
              color: 'var(--muted)',
              marginBottom: 14,
            }}>
              {latest.date} · Generated for testing only
            </div>

            {latest.count < 3 && (
              <div style={{
                padding: '10px 12px',
                marginBottom: 14,
                borderRadius: 8,
                background: 'var(--amber-tint)',
                color: 'var(--amber)',
                fontSize: 12.5,
              }}>
                Only {latest.count} eligible recommendations were returned.
              </div>
            )}

            {latest.recommendations.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                No eligible recommendations were returned.
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              {latest.recommendations.map((rec, index) => (
                <div key={`${rec.title}-${index}`} style={{
                  padding: isPhone ? 13 : 18,
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  minWidth: 0,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginBottom: 12,
                  }}>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 800,
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                    }}>
                      {index + 1}. {rec.title}
                    </div>
                    <span style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--accent-deep)',
                      background: 'var(--accent-tint)',
                      borderRadius: 5,
                      padding: '5px 8px',
                    }}>
                      {TYPE_LABELS[rec.type] || rec.type?.toUpperCase()}
                    </span>
                  </div>

                  {[
                    ['WHY SELECTED', rec.reason_selected],
                    ['DESCRIPTION', rec.description],
                    ['STAFF TALKING POINT', rec.talking_point],
                  ].map(([label, value]) => (
                    <div key={label} style={{ marginTop: 12 }}>
                      <div style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: '0.09em',
                        color: 'var(--muted)',
                        marginBottom: 5,
                      }}>
                        {label}
                      </div>
                      <div style={{
                        fontSize: 13,
                        lineHeight: 1.65,
                        overflowWrap: 'anywhere',
                      }}>
                        {value || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {results.length > 0 && (
        <Card title="Session history">
          <div style={{ display: 'grid', gap: 0 }}>
            {results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                onClick={() => {
                  if (index === 0) return;
                  setResults(previous => [
                    previous[index],
                    ...previous.filter((_, i) => i !== index),
                  ]);
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '12px 0',
                  border: 0,
                  borderBottom: '1px solid var(--line-soft)',
                  background: 'transparent',
                  color: 'var(--text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {result.restaurantName}
                </span>
                <span style={{
                  fontFamily: MONO,
                  color: 'var(--muted)',
                  fontSize: 11,
                }}>
                  {result.count}/3 · {result.elapsedSeconds.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>
          <div style={{
            marginTop: 10,
            color: 'var(--muted)',
            fontSize: 12,
          }}>
            Results remain available until this page is refreshed.
            Select a previous run to inspect it again.
          </div>
        </Card>
      )}
    </>
  );
}

export default function Page() {
  return (
    <AdminShell
      section="Platform"
      sub="Recommendation Lab"
      title="Recommendation Lab"
    >
      <RecommendationLab />
    </AdminShell>
  );
}


import { useCallback, useEffect, useRef, useState } from 'react';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { Card } from '../../components/admin/ui';
import { MONO } from '../../components/client/ClientChrome';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../lib/ai/recommendationScoring';

const TYPE_LABELS = {
  inventory: 'INVENTORY',
  margin: 'MARGIN',
  trending: 'SALES',
  feature: 'MENU FEATURE',
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
  const [scoringConfig, setScoringConfig] = useState({
    ...DEFAULT_RECOMMENDATION_CONFIG,
  });

  const scoringTotal =
    scoringConfig.inventoryWeight +
    scoringConfig.profitabilityWeight +
    scoringConfig.salesWeight;

  const scoringValid = scoringTotal === 100;

  function updateScoringConfig(key, value) {
    setScoringConfig(previous => ({
      ...previous,
      [key]: value,
    }));
  }

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
    if (!restaurantId || running || !scoringValid) return;

    setRunning(true);
    setError('');

    const started = performance.now();

    try {
      const response = await adminFetch(
        '/api/admin/test-ai-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({
            restaurantId,
            scoringConfig,
          }),
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
        diagnostics: data.diagnostics || null,
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

<Card title="Recommendation weights">
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 14,
  }}>
    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
      Test-only weights · Total {scoringTotal}%
    </span>

    <button
      type="button"
      className="om-btn"
      onClick={() => setScoringConfig({
        ...DEFAULT_RECOMMENDATION_CONFIG,
      })}
    >
      Reset defaults
    </button>
  </div>

  <div style={{
    display: 'grid',
    gridTemplateColumns: isPhone
      ? 'minmax(0, 1fr)'
      : 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  }}>
    {[
      ['inventoryWeight', 'Inventory urgency'],
      ['profitabilityWeight', 'Profitability'],
      ['salesWeight', 'Customer demand'],
    ].map(([key, label]) => (
      <div key={key} style={{
        minWidth: 0,
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: 13,
        background: 'var(--panel)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}>
          <span style={{ fontSize: 12, fontWeight: 800 }}>
            {label}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              className="om-field"
              type="number"
              min="0"
              max="100"
              step="1"
              value={scoringConfig[key]}
              onChange={event => {
                const value = Number(event.target.value);
                if (
                  Number.isFinite(value) &&
                  value >= 0 &&
                  value <= 100
                ) {
                  updateScoringConfig(key, value);
                }
              }}
              aria-label={`${label} percentage`}
              style={{
                width: 57,
                minWidth: 0,
                textAlign: 'right',
                fontFamily: MONO,
                fontWeight: 800,
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              %
            </span>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={scoringConfig[key]}
          onChange={event =>
            updateScoringConfig(key, Number(event.target.value))
          }
          aria-label={`${label} slider`}
          style={{
            display: 'block',
            width: '100%',
            accentColor: 'var(--accent)',
            cursor: 'pointer',
          }}
        />
      </div>
    ))}
  </div>

  {!scoringValid && (
    <div style={{
      marginTop: 10,
      fontSize: 12,
      color: 'var(--red)',
    }}>
      Weights must total 100% before running a test.
    </div>
  )}

  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 13,
    flexWrap: 'wrap',
  }}>
    <label style={{ fontSize: 12, fontWeight: 700 }}>
      Candidate shortlist
    </label>

    <select
      className="om-field"
      value={scoringConfig.shortlistSize}
      onChange={event =>
        updateScoringConfig(
          'shortlistSize',
          Number(event.target.value)
        )
      }
      style={{ width: 130, fontFamily: MONO }}
    >
      {[3, 5, 8, 10, 12, 15, 20, 25].map(size => (
        <option key={size} value={size}>
          {size} dishes
        </option>
      ))}
    </select>
  </div>

  <div style={{
    marginTop: 10,
    fontSize: 11,
    color: 'var(--muted)',
  }}>
    Menu-only mode evaluates the full menu without a shortlist.
    These controls do not change production settings.
  </div>
</Card>

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
            disabled={!restaurantId || running || !scoringValid}
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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      padding: '10px 13px',
      border: '1px solid var(--line)',
      borderRadius: 10,
      background: 'var(--panel)',
      fontSize: 12,
    }}>
      <strong>{latest.restaurantName}</strong>

      <span style={{ color: 'var(--muted)' }}>
        {latest.count}/3 recommendations
        {' · '}
        {latest.elapsedSeconds.toFixed(1)}s
        {' · '}
        {latest.diagnostics?.usage?.estimatedCostUsd != null
          ? `$${latest.diagnostics.usage.estimatedCostUsd.toFixed(4)}`
          : 'Cost unavailable'}
      </span>
    </div>

    <Card title="Tonight's Dish">
      <div style={{
        fontSize: 11,
        color: 'var(--muted)',
        marginBottom: 13,
      }}>
        {latest.date} · Test preview only
      </div>

      {latest.count < 3 && (
        <div style={{
          marginBottom: 12,
          padding: 10,
          background: 'var(--amber-tint)',
          color: 'var(--amber)',
          borderRadius: 8,
          fontSize: 12,
        }}>
          Only {latest.count} of 3 recommendations generated.
          Check the audit and validation events below.
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: isPhone
          ? 'minmax(0, 1fr)'
          : 'repeat(3, minmax(0, 1fr))',
        gap: 12,
        alignItems: 'stretch',
      }}>
        {latest.recommendations.map((rec, index) => (
          <div
            key={`${rec.title}-${index}`}
            style={{
              minWidth: 0,
              background: '#f7f7f5',
              color: '#141a1b',
              border: '1px solid #e0e2e0',
              borderRadius: 9,
              padding: '16px 15px',
              boxShadow: '0 3px 9px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
              marginBottom: 15,
            }}>
              <span style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.1em',
                color: '#5a6669',
              }}>
                {['PUSH TONIGHT', 'RECOMMEND', 'MENTION'][index]}
              </span>

              <span style={{
                width: 7,
                height: 7,
                flexShrink: 0,
                borderRadius: '50%',
                background: [
                  '#02a4ba',
                  '#3f9c56',
                  '#c1871c',
                ][index],
              }} />
            </div>

            <div style={{
              fontSize: 16,
              fontWeight: 800,
              lineHeight: 1.3,
              overflowWrap: 'anywhere',
            }}>
              {rec.title}
            </div>

            <div style={{
              marginTop: 7,
              fontFamily: MONO,
              fontSize: 9,
              color: '#03808f',
            }}>
              {TYPE_LABELS[rec.type] || rec.type?.toUpperCase()}
            </div>

            <div style={{
              borderTop: '1px dashed #d2d5d1',
              margin: '14px 0',
            }} />

            <div style={{
              fontFamily: MONO,
              fontSize: 9,
              color: '#687270',
              marginBottom: 5,
            }}>
              WHY TONIGHT
            </div>

            <div style={{
              fontSize: 12,
              lineHeight: 1.6,
              overflowWrap: 'anywhere',
            }}>
              {rec.reason_selected || '—'}
            </div>

            <div style={{
              borderTop: '1px dashed #d2d5d1',
              margin: '14px 0',
            }} />

            <div style={{
              fontFamily: MONO,
              fontSize: 9,
              color: '#687270',
              marginBottom: 5,
            }}>
              SAY THIS
            </div>

            <div style={{
              fontSize: 12,
              lineHeight: 1.65,
              fontWeight: 600,
              overflowWrap: 'anywhere',
            }}>
              {rec.talking_point || rec.description || '—'}
            </div>

            {rec.description && (
              <details style={{ marginTop: 14 }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: 10,
                  color: '#5a6669',
                }}>
                  Dish description
                </summary>

                <div style={{
                  marginTop: 8,
                  fontSize: 11,
                  lineHeight: 1.6,
                }}>
                  {rec.description}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </Card>

    <Card title="Selection audit">
      {latest.diagnostics?.selectionAudit ? (
        <>
          <div style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            marginBottom: 13,
            color: 'var(--muted)',
            fontSize: 11,
          }}>
            <span>
              Selected: {latest.diagnostics.selectionAuditSummary?.selected ?? 0}
            </span>
            <span>
              Rejected: {latest.diagnostics.selectionAuditSummary?.rejected ?? 0}
            </span>
            <span>
              Skipped: {latest.diagnostics.selectionAuditSummary?.skipped ?? 0}
            </span>
            <span>
              Not selected: {latest.diagnostics.selectionAuditSummary?.notSelected ?? 0}
            </span>
          </div>

          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 9,
            overflow: 'hidden',
          }}>
            {latest.diagnostics.selectionAudit.map((item, index) => (
              <details
                key={`${item.name}-${index}`}
                style={{
                  borderBottom: index <
                    latest.diagnostics.selectionAudit.length - 1
                    ? '1px solid var(--line-soft)'
                    : 'none',
                }}
              >
                <summary style={{
                  display: 'grid',
                  gridTemplateColumns: isPhone
                    ? '24px minmax(0, 1fr) auto'
                    : '35px minmax(0, 1fr) 85px 110px',
                  gap: 9,
                  alignItems: 'center',
                  padding: '11px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}>
                  <span style={{
                    fontFamily: MONO,
                    color: 'var(--muted)',
                  }}>
                    {index + 1}
                  </span>

                  <strong style={{
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                  }}>
                    {item.name}
                  </strong>

                  {!isPhone && (
                    <span style={{
                      fontFamily: MONO,
                      color: 'var(--accent-deep)',
                    }}>
                      {item.score == null
                        ? '—'
                        : item.score.toFixed(1)}
                    </span>
                  )}

                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: item.finalPosition != null
                      ? 'var(--green)'
                      : item.status === 'rejected'
                        ? 'var(--red)'
                        : 'var(--muted)',
                  }}>
                    {item.finalPosition != null
                      ? `Selected #${item.finalPosition}`
                      : String(item.status || 'Unknown').replaceAll('_', ' ')}
                  </span>
                </summary>

                <div style={{
                  padding: '0 12px 13px',
                  fontSize: 12,
                  lineHeight: 1.65,
                  color: 'var(--muted)',
                }}>
                  {item.score != null && isPhone && (
                    <div style={{ marginBottom: 7 }}>
                      Score: {item.score.toFixed(1)} / 100
                    </div>
                  )}

                  <div>{item.reason || 'No reason recorded.'}</div>

                  {(item.events || []).map((event, eventIndex) => (
                    <div
                      key={eventIndex}
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: '1px solid var(--line-soft)',
                      }}
                    >
                      <strong>
                        {event.stage} · {event.outcome}
                      </strong>
                      {' — '}
                      {event.reason}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Selection audit unavailable for this test.
        </div>
      )}
    </Card>

    <details style={{
      border: '1px solid var(--line)',
      borderRadius: 10,
      padding: '13px 15px',
    }}>
      <summary style={{
        cursor: 'pointer',
        fontWeight: 800,
        fontSize: 13,
      }}>
        Weighted candidate ranking
      </summary>

      <div style={{
        marginTop: 14,
        display: 'grid',
        gap: 7,
      }}>
        {latest.diagnostics?.scoring?.mode === 'menu-only' ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Full-menu selection: all{' '}
            {latest.diagnostics.scoring.totalCandidates} eligible dishes
            evaluated without weighted scoring.
          </div>
        ) : (
          (latest.diagnostics?.scoring?.shortlist || []).map(
            (item, index) => (
              <details key={`${item.name}-${index}`} style={{
                border: '1px solid var(--line)',
                borderRadius: 7,
                padding: '9px 11px',
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}>
                  {index + 1}. {item.name}
                  {' · '}
                  {item.totalScore == null
                    ? 'Unscored'
                    : `${item.totalScore.toFixed(1)} / 100`}
                </summary>

                <div style={{
                  marginTop: 9,
                  display: 'grid',
                  gap: 5,
                  fontSize: 11,
                  color: 'var(--muted)',
                }}>
                  {[
                    ['Inventory', 'inventory'],
                    ['Profitability', 'profitability'],
                    ['Sales', 'sales'],
                  ].map(([label, key]) => (
                    <div key={key}>
                      {label}: {item.scores?.[key] == null
                        ? 'Unavailable'
                        : item.scores[key].toFixed(1)}
                      {' · '}
                      Effective weight:{' '}
                      {item.effectiveWeights?.[key]?.toFixed(1) ?? '—'}%
                      {' · '}
                      Contribution:{' '}
                      {item.contributions?.[key]?.toFixed(1) ?? '—'}
                    </div>
                  ))}
                </div>
              </details>
            )
          )
        )}
      </div>
    </details>

    <details style={{
      border: '1px solid var(--line)',
      borderRadius: 10,
      padding: '13px 15px',
    }}>
      <summary style={{
        cursor: 'pointer',
        fontWeight: 800,
        fontSize: 13,
      }}>
        Generation diagnostics
      </summary>

      <div style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: isPhone
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(3, minmax(0, 1fr))',
        gap: 9,
      }}>
        {[
          ['Eligible menu items', latest.diagnostics?.context?.eligibleMenuItems],
          ['Verified margins', latest.diagnostics?.context?.verifiedMarginItems],
          ['Expiring ingredients', latest.diagnostics?.context?.expiringIngredients],
          ['POS matches', latest.diagnostics?.context?.dishesWithMatchedSales],
          ['Claude candidates', latest.diagnostics?.generation?.returnedByClaude],
          ['Accepted', latest.diagnostics?.generation?.acceptedFromClaude],
          ['Rejected', latest.diagnostics?.generation?.rejectedCandidates],
          ['Fallbacks', latest.diagnostics?.generation?.acceptedFallbacks],
          ['Input tokens', latest.diagnostics?.usage?.inputTokens],
          ['Output tokens', latest.diagnostics?.usage?.outputTokens],
          ['Claude calls', latest.diagnostics?.usage?.claudeCalls],
        ].map(([label, value]) => (
          <div key={label} style={{
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 11,
          }}>
            <div style={{
              fontSize: 10,
              color: 'var(--muted)',
            }}>
              {label}
            </div>

            <div style={{
              marginTop: 5,
              fontSize: 18,
              fontWeight: 800,
              fontFamily: MONO,
            }}>
              {value?.toLocaleString?.() ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 12 }}>
          Validation events
        </strong>

        {(latest.diagnostics?.events || []).length === 0 ? (
          <div style={{
            marginTop: 9,
            fontSize: 12,
            color: 'var(--muted)',
          }}>
            No events recorded.
          </div>
        ) : (
          (latest.diagnostics.events || []).map((event, index) => (
            <div key={index} style={{
              borderBottom: '1px solid var(--line-soft)',
              padding: '9px 0',
              fontSize: 12,
              lineHeight: 1.5,
            }}>
              <strong>
                {event.stage} · {event.outcome}
              </strong>
              {event.dish ? ` · ${event.dish}` : ''}
              <div style={{ color: 'var(--muted)' }}>
                {event.reason}
              </div>
            </div>
          ))
        )}
      </div>
    </details>
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

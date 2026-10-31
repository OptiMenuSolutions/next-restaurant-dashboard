
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
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState('');
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

    useEffect(() => {
    if (!restaurantId) {
      setReadiness(null);
      setReadinessError('');
      setReadinessLoading(false);
      return;
    }

    let cancelled = false;

    setReadiness(null);
    setReadinessError('');
    setReadinessLoading(true);

    async function loadReadiness() {
      try {
        const response = await adminFetch(
          `/api/admin/data-readiness?restaurantId=${encodeURIComponent(restaurantId)}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Could not load data readiness');
        }

        if (!cancelled) setReadiness(data.readiness || null);
      } catch (err) {
        if (!cancelled) setReadinessError(err.message);
      } finally {
        if (!cancelled) setReadinessLoading(false);
      }
    }

    loadReadiness();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, adminFetch]);

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
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 18,
        }}>
          <div style={{
            fontSize: 12.5,
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: 600,
          }}>
            Adjust how OptiMenu scores inventory urgency,
            verified profitability, and customer demand.
            These settings apply only to this test session.
          </div>

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

        <div style={{ display: 'grid', gap: 18 }}>
          {[
            ['inventoryWeight', 'Inventory urgency'],
            ['profitabilityWeight', 'Profitability'],
            ['salesWeight', 'Customer demand'],
          ].map(([key, label]) => (
            <div key={key} style={{ display: 'grid', gap: 9 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <label style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                }}>
                  {label}
                </label>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
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
                      width: 70,
                      minWidth: 0,
                      textAlign: 'right',
                      fontFamily: MONO,
                      fontWeight: 800,
                    }}
                  />
                  <span style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                  }}>
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
                  width: '100%',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer',
                }}
              />
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 20,
          paddingTop: 14,
          borderTop: '1px solid var(--line)',
        }}>
          <span style={{
            fontSize: 12,
            color: 'var(--muted)',
          }}>
            Total allocation
          </span>

          <span style={{
            fontFamily: MONO,
            fontSize: 14,
            fontWeight: 800,
            color: scoringValid
              ? 'var(--green)'
              : 'var(--red)',
          }}>
            {scoringTotal}% / 100%
          </span>
        </div>

        {!scoringValid && (
          <div style={{
            marginTop: 9,
            color: 'var(--red)',
            fontSize: 12,
          }}>
            Adjust the percentages to total 100% before testing.
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: isPhone
            ? 'minmax(0, 1fr)'
            : 'minmax(0, 1fr) auto',
          alignItems: 'end',
          gap: 14,
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid var(--line)',
        }}>
          <div style={{ display: 'grid', gap: 7 }}>
            <label style={{
              fontSize: 12.5,
              fontWeight: 700,
            }}>
              Candidate shortlist size
            </label>

            <div style={{
              color: 'var(--muted)',
              fontSize: 11.5,
            }}>
              Number of ranked dishes available for selection.
            </div>
          </div>

          <select
            className="om-field"
            value={scoringConfig.shortlistSize}
            onChange={event =>
              updateScoringConfig(
                'shortlistSize',
                Number(event.target.value)
              )
            }
            style={{
              width: isPhone ? '100%' : 120,
              fontFamily: MONO,
            }}
          >
            {[3, 5, 8, 10, 12, 15, 20, 25].map(size => (
              <option key={size} value={size}>
                {size} dishes
              </option>
            ))}
          </select>
        </div>

        <div style={{
          marginTop: 16,
          fontSize: 11.5,
          color: 'var(--muted)',
          lineHeight: 1.6,
        }}>
          Preview mode: weights and shortlist size affect the
          scoring diagnostics, not Claude's selections yet.
          Production recommendations remain unchanged.
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


      {restaurantId && (
        <Card
          title="Restaurant data readiness"
          right={
            <a
              className="om-btn"
              href={`/admin/restaurants/${restaurantId}`}
              style={{ fontSize: 12 }}
            >
              Restaurant overview →
            </a>
          }
        >
          {readinessLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Checking restaurant data…
            </div>
          ) : readinessError ? (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>
              {readinessError}
            </div>
          ) : readiness ? (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}>
                <div style={{
                  fontFamily: MONO,
                  fontSize: 28,
                  fontWeight: 800,
                }}>
                  {readiness.score}
                  <span style={{
                    fontSize: 13,
                    color: 'var(--muted)',
                    fontWeight: 500,
                  }}>
                    /100
                  </span>
                </div>

                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: readiness.isDemo
                    ? 'var(--muted)'
                    : readiness.status === 'ready'
                      ? 'var(--green)'
                      : readiness.status === 'partial'
                        ? 'var(--amber)'
                        : 'var(--red)',
                }}>
                  {readiness.isDemo
                    ? 'Demo data'
                    : readiness.status === 'ready'
                      ? 'Ready'
                      : readiness.status === 'partial'
                        ? 'Partially ready'
                        : 'Limited data'}
                </span>
              </div>

              <div style={{
                height: 6,
                background: 'var(--line)',
                borderRadius: 20,
                overflow: 'hidden',
                marginBottom: 17,
              }}>
                <div style={{
                  width: `${readiness.score}%`,
                  height: '100%',
                  borderRadius: 20,
                  background: readiness.status === 'ready'
                    ? 'var(--green)'
                    : readiness.status === 'partial'
                      ? 'var(--amber)'
                      : 'var(--red)',
                }} />
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isPhone
                  ? 'minmax(0, 1fr)'
                  : 'repeat(2, minmax(0, 1fr))',
                gap: 10,
              }}>
                {readiness.checks.map(check => (
                  <div
                    key={check.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '11px 13px',
                      minWidth: 0,
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                      <span>{check.label}</span>
                      <span style={{
                        fontFamily: MONO,
                        whiteSpace: 'nowrap',
                      }}>
                        {check.score}/{check.weight}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11.5,
                      color: 'var(--muted)',
                      marginTop: 6,
                      lineHeight: 1.5,
                    }}>
                      {check.detail}
                    </div>
                  </div>
                ))}
              </div>

              {!readiness.isDemo && readiness.actions?.length > 0 && (
                <div style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid var(--line-soft)',
                }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 800,
                    marginBottom: 10,
                  }}>
                    Action required · {readiness.actions.length} issues
                  </div>

                  {readiness.actions.map(action => (
                    <div
                      key={action.id}
                      style={{
                        display: 'flex',
                        gap: 9,
                        padding: '7px 0',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        flexShrink: 0,
                        marginTop: 5,
                        background: action.priority === 'medium'
                          ? 'var(--amber)'
                          : 'var(--red)',
                      }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                          {action.title}
                        </div>
                        <div style={{
                          fontSize: 11.5,
                          color: 'var(--muted)',
                          marginTop: 3,
                        }}>
                          {action.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{
                marginTop: 14,
                color: 'var(--muted)',
                fontSize: 11.5,
                lineHeight: 1.6,
              }}>
                Readiness is informational. Dry runs remain available
                regardless of score. Review the restaurant's Overview
                tab for issue impact and repair instructions.
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              No readiness assessment available.
            </div>
          )}
        </Card>
      )}

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
              ['CLAUDE CALLS', latest.diagnostics?.usage?.claudeCalls ?? '—'],
              ['INPUT TOKENS', latest.diagnostics?.usage?.inputTokens?.toLocaleString() ?? '—'],
              ['OUTPUT TOKENS', latest.diagnostics?.usage?.outputTokens?.toLocaleString() ?? '—'],
              [
                'ESTIMATED COST',
                latest.diagnostics?.usage?.estimatedCostUsd != null
                  ? `$${latest.diagnostics.usage.estimatedCostUsd.toFixed(4)}`
                  : '—',
              ],
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
                padding: '12px 14px',
                marginBottom: 14,
                borderRadius: 8,
                background: 'var(--amber-tint)',
                color: 'var(--amber)',
                fontSize: 12.5,
                lineHeight: 1.6,
              }}>
                <strong>
                  Only {latest.count} of 3 recommendations generated.
                </strong>

                <div style={{ marginTop: 5 }}>
                  {latest.diagnostics?.generation?.rejectedCandidates > 0
                    ? `${latest.diagnostics.generation.rejectedCandidates} candidate validation failures were recorded.`
                    : latest.diagnostics?.generation?.skippedClaudeCandidates > 0
                      ? `${latest.diagnostics.generation.skippedClaudeCandidates} Claude candidates were skipped.`
                      : 'No candidate validation failures were recorded.'}
                </div>

                <div style={{ marginTop: 5 }}>
                  Review the Generation diagnostics below to identify
                  individual rejection reasons. Missing verified costs,
                  inventory opportunities, or POS sales may also limit
                  the available recommendations.
                </div>
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

          {latest.diagnostics?.scoring && (
            <Card title="Weighted candidate ranking">
              <div style={{
                color: 'var(--muted)',
                fontSize: 12,
                lineHeight: 1.6,
                marginBottom: 14,
              }}>
                Scoring preview ·{' '}
                {latest.diagnostics.scoring.totalCandidates} eligible dishes ·{' '}
                {latest.diagnostics.scoring.shortlist.length} shortlisted
              </div>

              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 16,
              }}>
                {[
                  ['Inventory', latest.diagnostics.scoring.config.inventoryWeight],
                  ['Profitability', latest.diagnostics.scoring.config.profitabilityWeight],
                  ['Sales', latest.diagnostics.scoring.config.salesWeight],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    border: '1px solid var(--line)',
                    borderRadius: 7,
                    padding: '8px 11px',
                    fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--muted)' }}>
                      {label}
                    </span>
                    <strong style={{
                      marginLeft: 8,
                      fontFamily: MONO,
                    }}>
                      {value}%
                    </strong>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 9 }}>
                {latest.diagnostics.scoring.shortlist.map((item, index) => (
                  <details key={`${item.name}-${index}`} style={{
                    border: '1px solid var(--line)',
                    borderRadius: 9,
                    padding: '12px 14px',
                    minWidth: 0,
                  }}>
                    <summary style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}>
                      <span style={{
                        fontSize: 12.5,
                        fontWeight: 800,
                        overflowWrap: 'anywhere',
                      }}>
                        {index + 1}. {item.name}
                      </span>

                      <span style={{
                        fontFamily: MONO,
                        fontWeight: 800,
                        fontSize: 12,
                        color: 'var(--accent-deep)',
                      }}>
                        {item.totalScore === null
                          ? 'MENU ONLY'
                          : `${item.totalScore.toFixed(1)} / 100`}
                      </span>
                    </summary>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: isPhone
                        ? 'minmax(0, 1fr)'
                        : 'repeat(3, minmax(0, 1fr))',
                      gap: 10,
                      marginTop: 14,
                    }}>
                      {[
                        ['Inventory', 'inventory'],
                        ['Profitability', 'profitability'],
                        ['Sales', 'sales'],
                      ].map(([label, key]) => (
                        <div key={key} style={{
                          padding: 11,
                          borderRadius: 7,
                          background: 'var(--panel)',
                          border: '1px solid var(--line)',
                          minWidth: 0,
                        }}>
                          <div style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            fontFamily: MONO,
                          }}>
                            {label.toUpperCase()}
                          </div>

                          <div style={{
                            fontSize: 18,
                            fontWeight: 800,
                            marginTop: 6,
                            fontFamily: MONO,
                          }}>
                            {item.scores[key] === null
                              ? '—'
                              : item.scores[key].toFixed(1)}
                          </div>

                          <div style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 4,
                          }}>
                            Effective weight:{' '}
                            {item.effectiveWeights[key].toFixed(1)}%
                          </div>

                          <div style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 3,
                          }}>
                            Contribution:{' '}
                            {item.contributions[key].toFixed(1)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}
          
          {latest.diagnostics && (
            <Card title="Generation diagnostics">
              <div style={{
                display: 'grid',
                gridTemplateColumns: isPhone
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(3, minmax(0, 1fr))',
                gap: 10,
                marginBottom: 22,
              }}>
                {[
                  ['ELIGIBLE MENU ITEMS', latest.diagnostics.context?.eligibleMenuItems],
                  ['VERIFIED MARGINS', latest.diagnostics.context?.verifiedMarginItems],
                  ['EXPIRING INGREDIENTS', latest.diagnostics.context?.expiringIngredients],
                  ['DISHES WITH INVENTORY RISK', latest.diagnostics.context?.dishesWithExpiringIngredients],
                  ['DISHES WITH POS SALES', latest.diagnostics.context?.dishesWithMatchedSales],
                  ['RECENT RECOMMENDATIONS', latest.diagnostics.context?.recentRecommendations],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    padding: 14,
                    border: '1px solid var(--line)',
                    borderRadius: 9,
                    minWidth: 0,
                  }}>
                    <div style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: 'var(--muted)',
                    }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: 23,
                      fontWeight: 800,
                      marginTop: 8,
                    }}>
                      {value ?? '—'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                fontSize: 13,
                fontWeight: 800,
                marginBottom: 12,
              }}>
                Generation breakdown
              </div>

              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 22,
              }}>
                {[
                  ['Claude candidates', latest.diagnostics.generation?.returnedByClaude],
                  ['Claude accepted', latest.diagnostics.generation?.acceptedFromClaude],
                  ['Rejected', latest.diagnostics.generation?.rejectedCandidates],
                  ['Claude skipped', latest.diagnostics.generation?.skippedClaudeCandidates],
                  ['Fallbacks accepted', latest.diagnostics.generation?.acceptedFallbacks],
                  ['Fallbacks skipped', latest.diagnostics.generation?.skippedFallbackCandidates],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    padding: '9px 12px',
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--muted)' }}>
                      {label}
                    </span>
                    <span style={{
                      marginLeft: 8,
                      fontFamily: MONO,
                      fontWeight: 800,
                    }}>
                      {value ?? '—'}
                    </span>
                  </div>
                ))}
              </div>

              <details style={{
                borderTop: '1px solid var(--line)',
                paddingTop: 16,
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 800,
                }}>
                  Validation and fallback events ({
                    latest.diagnostics.events?.length || 0
                  })
                </summary>

                <div style={{
                  display: 'grid',
                  gap: 0,
                  marginTop: 14,
                }}>
                  {(latest.diagnostics.events || []).length === 0 ? (
                    <div style={{
                      color: 'var(--muted)',
                      fontSize: 12,
                    }}>
                      No validation or fallback events recorded.
                    </div>
                  ) : (
                    latest.diagnostics.events.map((event, index) => (
                      <div key={index} style={{
                        display: 'grid',
                        gridTemplateColumns: isPhone
                          ? 'minmax(0, 1fr)'
                          : '105px 90px minmax(0, 1fr)',
                        gap: 10,
                        padding: '11px 0',
                        borderBottom: '1px solid var(--line-soft)',
                        fontSize: 12,
                        alignItems: 'start',
                      }}>
                        <span style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: 'var(--muted)',
                          textTransform: 'uppercase',
                        }}>
                          {event.stage}
                        </span>

                        <span style={{
                          fontWeight: 800,
                          color: event.outcome === 'rejected'
                            ? 'var(--red)'
                            : event.outcome === 'accepted'
                              ? 'var(--accent-deep)'
                              : 'var(--amber)',
                          textTransform: 'capitalize',
                        }}>
                          {event.outcome}
                        </span>

                        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                          {event.dish && (
                            <span style={{ fontWeight: 800 }}>
                              {event.dish} —{' '}
                            </span>
                          )}
                          {event.reason}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </Card>
          )}
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

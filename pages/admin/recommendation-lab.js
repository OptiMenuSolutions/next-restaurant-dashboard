
import { useCallback, useEffect, useRef, useState } from 'react';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { Card, Chip, Dot, Pills, th, td, shortDate } from '../../components/admin/ui';
import { MONO } from '../../components/client/ClientChrome';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../lib/ai/recommendationScoring';

const TYPE_LABELS = {
  inventory: 'INVENTORY',
  margin: 'MARGIN',
  trending: 'SALES',
  feature: 'MENU FEATURE',
};

const RANK_LABELS = ['PUSH TONIGHT', 'RECOMMEND', 'MENTION'];

const WEIGHT_ROWS = [
  ['inventoryWeight', 'Inventory urgency', 'Use up stock before it spoils', 'var(--w-inv)'],
  ['profitabilityWeight', 'Profitability', 'Verified plate margin', 'var(--w-pro)'],
  ['salesWeight', 'Customer demand', 'Recent POS sales trend', 'var(--w-dem)'],
];

const SIGNALS = [
  ['inventory', 'INVENTORY', 'var(--w-inv)'],
  ['profitability', 'PROFIT', 'var(--w-pro)'],
  ['sales', 'DEMAND', 'var(--w-dem)'],
];

const TAG_COLORS = {
  picked: ['var(--green-tint)', 'var(--green)'],
  rejected: ['var(--red-tint)', 'var(--red)'],
  skipped: ['var(--amber-tint)', 'var(--amber)'],
  other: ['var(--panel)', 'var(--muted)'],
};

// The three signal colors differ in lightness so they read apart in both themes.
const LAB_CSS = `
.om-app{--w-inv:#03505a;--w-pro:#02a4ba;--w-dem:#9fdce6}
.om-app[data-theme="dark"],html[data-om-theme="dark"] .om-app{--w-inv:#9fdce6;--w-pro:#43bccb;--w-dem:#1f6b74}
.om-lab-range{accent-color:var(--accent-deep);width:100%;margin:0;cursor:pointer}
`;

const INNER_PANEL = {
  minWidth: 0,
  background: 'var(--shell)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const TICKET_LABEL = {
  fontFamily: MONO,
  fontSize: 10.5,
  letterSpacing: '0.12em',
  color: 'var(--ink-soft, #5a6669)',
};

const TICKET_TEXT = {
  margin: '-4px 0 0',
  fontSize: 13,
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
};

const LINK_BUTTON = {
  border: 0,
  background: 'none',
  padding: 0,
  font: "700 13.5px 'Manrope', sans-serif",
  color: 'var(--accent-deep)',
  cursor: 'pointer',
  textAlign: 'left',
};

function nameKey(value) {
  return String(value || '').trim().toLowerCase();
}

function fmt(value) {
  return value == null ? '—' : Number(value).toLocaleString('en-US');
}

function money4(value) {
  return value == null ? '—' : `$${Number(value).toFixed(4)}`;
}

function scoreText(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function weightsText(config) {
  return config
    ? `${config.inventoryWeight} / ${config.profitabilityWeight} / ${config.salesWeight}`
    : '—';
}

function ago(timestamp) {
  if (!timestamp) return 'none yet';
  const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function outcomeOf(item) {
  if (item.finalPosition != null) {
    return { kind: 'picked', label: `PICKED #${item.finalPosition}` };
  }
  const status = String(item.status || '').toLowerCase();
  if (status === 'rejected') return { kind: 'rejected', label: 'REJECTED' };
  if (status === 'skipped') return { kind: 'skipped', label: 'SKIPPED' };
  if (!status || status === 'not_selected') return { kind: 'other', label: 'NOT PICKED' };
  return { kind: 'other', label: status.replaceAll('_', ' ').toUpperCase() };
}

function eventKind(outcome) {
  const value = String(outcome || '').toLowerCase();
  if (value.includes('reject') || value.includes('fail')) return 'rejected';
  if (value.includes('skip')) return 'skipped';
  return 'picked';
}

// Evidence chips on each ticket. Each one only shows when the shortlist
// entry for that dish carries the field.
function evidenceChips(item) {
  if (!item) return [];
  const chips = [];
  const days = (item.expiringIngredients || [])
    .map(ingredient => ingredient.daysLeft)
    .filter(value => Number.isFinite(value) && value > 0);
  if (days.length) {
    const soonest = Math.min(...days);
    chips.push(`EXPIRES IN ${soonest} DAY${soonest === 1 ? '' : 'S'}`);
  }
  if (Number.isFinite(item.margin)) {
    chips.push(`${Math.round(item.margin)}% MARGIN`);
  }
  if (Number.isFinite(item.qty7d)) {
    chips.push(`${item.qty7d} SOLD / 7D`);
  }
  return chips;
}

function SignalBar({ value, color }) {
  if (!Number.isFinite(value)) {
    return <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>—</span>;
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line-soft)' }}>
        <span style={{ display: 'block', height: 6, borderRadius: 3, background: color, width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, width: 26, textAlign: 'right' }}>{Math.round(value)}</span>
    </span>
  );
}

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
  const [phoneView, setPhoneView] = useState('picks');
  const resultsRef = useRef(null);

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
        runNumber: previous.length + 1,
        restaurantId,
        restaurantName: selectedRestaurant?.name || 'Restaurant',
        config: { ...scoringConfig },
        date: data.date,
        count: data.count,
        recommendations: data.recommendations || [],
        diagnostics: data.diagnostics || null,
        elapsedSeconds,
      }, ...previous]);
      setPhoneView('picks');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const latest = results[0];
  const live = DEFAULT_RECOMMENDATION_CONFIG;
  const changedFromLive =
    WEIGHT_ROWS.some(([key]) => scoringConfig[key] !== live[key]) ||
    scoringConfig.shortlistSize !== live.shortlistSize;

  // Data checks for the chosen restaurant. Expiring stock and POS matches
  // only come back from a run, so they fill in after the first test.
  const lastRunHere = results.find(result => result.restaurantId === restaurantId);
  const context = lastRunHere?.diagnostics?.context || null;
  const scoringMode = lastRunHere?.diagnostics?.scoring?.mode || null;
  const coverage = context?.eligibleMenuItems > 0
    ? Math.round((context.verifiedMarginItems / context.eligibleMenuItems) * 100)
    : null;

  const readiness = selectedRestaurant ? [
    ['Menu items', fmt(selectedRestaurant.menu_item_count), selectedRestaurant.menu_item_count > 0 ? 'green' : 'red'],
    ['Ingredients', fmt(selectedRestaurant.ingredient_count), selectedRestaurant.ingredient_count > 0 ? 'green' : 'red'],
    ['Invoices · newest', `${fmt(selectedRestaurant.invoice_count)} · ${ago(selectedRestaurant.last_invoice_at)}`, selectedRestaurant.invoice_count > 0 ? 'green' : 'amber'],
    ['Ingredients expiring soon', context ? fmt(context.expiringIngredients) : 'After first run', !context ? 'gray' : context.expiringIngredients > 0 ? 'amber' : 'green'],
    ['Dishes matched to POS sales', context ? `${fmt(context.dishesWithMatchedSales)} / ${fmt(context.eligibleMenuItems)}` : 'After first run', !context ? 'gray' : context.dishesWithMatchedSales > 0 ? 'green' : 'amber'],
  ] : [];

  const diag = latest?.diagnostics || {};
  const menuOnly = diag.scoring?.mode === 'menu-only';
  const shortlist = diag.scoring?.shortlist || [];
  const shortlistByName = new Map(shortlist.map(item => [nameKey(item.name), item]));

  const rankingRows = (diag.selectionAudit || shortlist).map(item => {
    const scored = shortlistByName.get(nameKey(item.name)) || item;
    return {
      name: item.name,
      reason: item.reason,
      scores: scored.scores || {},
      contributions: scored.contributions || {},
      total: scored.totalScore ?? item.score ?? null,
      outcome: outcomeOf(item),
    };
  });

  const outcomeCounts = rankingRows.reduce((counts, row) => {
    counts[row.outcome.kind] += 1;
    return counts;
  }, { picked: 0, rejected: 0, skipped: 0, other: 0 });

  const usage = diag.usage || {};
  const generation = diag.generation || {};
  const tokens = usage.inputTokens == null && usage.outputTokens == null
    ? null
    : (usage.inputTokens || 0) + (usage.outputTokens || 0);

  const kpis = latest ? [
    ['DISHES CONSIDERED', fmt(diag.context?.eligibleMenuItems), menuOnly ? 'Full menu sent to Claude' : `${shortlist.length} sent to Claude after scoring`],
    ['CLAUDE ANSWER', `${fmt(generation.returnedByClaude)} → ${fmt(generation.acceptedFromClaude)}`, `${fmt(generation.rejectedCandidates)} rejected · ${fmt(generation.acceptedFallbacks)} fallbacks used`],
    ['TOKENS', fmt(tokens), `${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out · ${fmt(usage.claudeCalls)} ${usage.claudeCalls === 1 ? 'call' : 'calls'}`],
    ['COST', money4(usage.estimatedCostUsd), `In ${latest.elapsedSeconds.toFixed(1)} s`],
  ] : [];

  const events = diag.events || [];
  const showPicks = !isPhone || phoneView === 'picks';
  const showRank = !isPhone || phoneView === 'rank';
  const showDetails = !isPhone || phoneView === 'details';

  const runMeta = latest
    ? [
        `RUN ${latest.runNumber}`,
        shortDate(latest.date).toUpperCase(),
        `${latest.count} OF 3`,
        `${latest.elapsedSeconds.toFixed(1)} S`,
        money4(usage.estimatedCostUsd),
        weightsText(latest.config),
      ].join(' · ')
    : '';

  useEffect(() => {
    if (isPhone && results.length > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isPhone, results.length]);

  function showRun(index) {
    if (index === 0) return;
    setResults(previous => [previous[index], ...previous.filter((_, i) => i !== index)]);
    setPhoneView('picks');
  }

  return (
    <>
      <style>{LAB_CSS}</style>

      <PageHead
        kicker="PLATFORM"
        title="Recommendation Lab"
        sub="Try Tonight's Dish on a restaurant's real data with your own weights. Nothing is saved or sent to the restaurant."
      >
        <Chip bg="var(--amber-tint)" fg="var(--amber)">DRY RUN · EACH TEST IS A PAID CLAUDE CALL</Chip>
      </PageHead>

      <section aria-labelledby="lab-setup" style={{ background: 'var(--panel)', borderRadius: 12, padding: isPhone ? 14 : '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 id="lab-setup" style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Test setup</h2>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>
            LIVE NOW: {weightsText(live)} · SHORTLIST {live.shortlistSize}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
          <div style={{ ...INNER_PANEL, flex: '1 1 400px' }}>
            <div ref={dropdownRef} style={{ display: 'grid', gap: 4, position: 'relative' }}>
              <label htmlFor="lab-restaurant" style={{ fontSize: 12, fontWeight: 700 }}>
                1 · Restaurant
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="lab-restaurant"
                  className="om-field"
                  type="text"
                  role="combobox"
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
                    if (event.key === 'Escape') setDropdownOpen(false);
                  }}
                  placeholder={loadingRestaurants ? 'Loading restaurants…' : 'Search or select a restaurant'}
                  disabled={running || loadingRestaurants}
                  autoComplete="off"
                  style={{ paddingRight: 34 }}
                />
                <span aria-hidden="true" style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', fontSize: 12 }}>
                  ▾
                </span>

                {dropdownOpen && !loadingRestaurants && (
                  <div
                    id="recommendation-restaurant-options"
                    role="listbox"
                    style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 5px)', left: 0, right: 0, maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--shell)', boxShadow: 'var(--shadow-lg)', padding: 5 }}
                  >
                    {filteredRestaurants.length === 0 ? (
                      <div style={{ padding: '12px 10px', color: 'var(--muted)', fontSize: 13 }}>
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
                          style={{ display: 'block', width: '100%', padding: '10px 12px', border: 0, borderRadius: 6, background: restaurantId === restaurant.id ? 'var(--accent-tint)' : 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                          onMouseEnter={event => {
                            event.currentTarget.style.background = 'var(--accent-tint)';
                          }}
                          onMouseLeave={event => {
                            event.currentTarget.style.background = restaurantId === restaurant.id ? 'var(--accent-tint)' : 'transparent';
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{restaurant.name}</div>
                          <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 11 }}>
                            {restaurant.menu_item_count} menu items · {restaurant.ingredient_count} ingredients
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {selectedRestaurant ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {readiness.map(([label, value, level]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
                      <Dot level={level} size={7} />
                      <span style={{ flex: 1, minWidth: 0, color: 'var(--muted)' }}>{label}</span>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>

                {coverage != null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>Dishes with a verified margin</span>
                      <span style={{ fontFamily: MONO }}>{fmt(context.verifiedMarginItems)} / {fmt(context.eligibleMenuItems)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--line-soft)' }}>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--accent)', width: `${coverage}%` }} />
                    </div>
                  </div>
                )}

                {scoringMode && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {scoringMode === 'menu-only' ? (
                      <>
                        <Chip bg="var(--amber-tint)" fg="var(--amber)">MENU ONLY</Chip>
                        Not enough sales or cost data to score, so Claude sees the full menu.
                      </>
                    ) : (
                      <>
                        <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">WEIGHTED</Chip>
                        Enough sales and cost data to score a shortlist.
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                Pick a restaurant to check its data before you run a test.
              </div>
            )}
          </div>

          <div style={{ ...INNER_PANEL, flex: '1.4 1 520px', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>2 · Scoring weights</span>
              <button
                type="button"
                className="om-btn"
                disabled={!changedFromLive}
                onClick={() => setScoringConfig({ ...DEFAULT_RECOMMENDATION_CONFIG })}
                style={{ minHeight: 30, fontSize: 12 }}
              >
                Reset to live
              </button>
            </div>

            <div aria-hidden="true" style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--line-soft)' }}>
              {WEIGHT_ROWS.map(([key, , , color]) => (
                <span key={key} style={{ width: `${Math.min(scoringConfig[key], 100)}%`, background: color }} />
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ color: scoringValid ? 'var(--muted)' : 'var(--red)' }}>
                TOTAL {scoringTotal}%{scoringValid ? '' : ' · MUST BE 100%'}
              </span>
              {changedFromLive && <span style={{ color: 'var(--amber)' }}>CHANGED FROM LIVE</span>}
            </div>

            {WEIGHT_ROWS.map(([key, label, hint, color]) => (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: isPhone ? '10px minmax(0, 1fr) 80px' : '10px minmax(0, 1fr) 200px 80px',
                  gap: isPhone ? '6px 10px' : 12,
                  alignItems: 'center',
                  padding: '8px 0',
                  borderTop: '1px solid var(--line-soft)',
                }}
              >
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</span>
                </span>
                <input
                  type="range"
                  className="om-lab-range"
                  min="0"
                  max="100"
                  step="5"
                  value={scoringConfig[key]}
                  onChange={event => updateScoringConfig(key, Number(event.target.value))}
                  aria-label={`${label} weight`}
                  style={isPhone ? { gridColumn: '1 / -1', order: 1 } : undefined}
                />
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    className="om-field"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={scoringConfig[key]}
                    onChange={event => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 0 && value <= 100) {
                        updateScoringConfig(key, value);
                      }
                    }}
                    aria-label={`${label} percent`}
                    style={{ textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>%</span>
                </span>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
              <label htmlFor="lab-shortlist" style={{ fontSize: 13.5, fontWeight: 700 }}>
                Dishes on Claude's shortlist
              </label>
              <select
                id="lab-shortlist"
                className="om-field"
                value={scoringConfig.shortlistSize}
                onChange={event => updateScoringConfig('shortlistSize', Number(event.target.value))}
                style={{ width: 130, fontFamily: MONO }}
              >
                {[3, 5, 8, 10, 12, 15, 20, 25].map(size => (
                  <option key={size} value={size}>{size} dishes</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="om-pri"
            disabled={!restaurantId || running || !scoringValid}
            onClick={runTest}
            style={isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined}
          >
            {running ? 'Generating…' : '3 · Run dry test'}
          </button>
          <span style={{ fontSize: 12.5, color: scoringValid ? 'var(--muted)' : 'var(--red)' }}>
            {!scoringValid
              ? 'Weights must total 100% before you can run a test.'
              : latest
                ? `Last run took ${latest.elapsedSeconds.toFixed(1)} s and cost ${money4(usage.estimatedCostUsd)} · results stay on this page until you refresh`
                : 'Results stay on this page until you refresh'}
          </span>
        </div>
      </section>

      {error && (
        <div role="alert" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--red-tint)', color: 'var(--red)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {running && (
        <Card title="Generating recommendations">
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            Reading the restaurant's data and asking Claude. This takes a few seconds.
          </div>
        </Card>
      )}

      {latest && (
        <>
          {isPhone && (
            <div ref={resultsRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 104 }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--muted)' }}>
                  {latest.restaurantName.toUpperCase()}
                </div>
                <h2 style={{ margin: '5px 0 0', fontSize: 23, fontWeight: 800, letterSpacing: '-0.03em' }}>Tonight's Dish</h2>
                <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{runMeta}</div>
              </div>
              <Pills
                label="Result view"
                value={phoneView}
                onChange={setPhoneView}
                options={[
                  { key: 'picks', label: 'Picks', n: latest.recommendations.length },
                  { key: 'rank', label: 'Shortlist', n: rankingRows.length },
                  { key: 'details', label: 'Details' },
                ]}
              />
            </div>
          )}

          {showPicks && (
            <Card
              title={isPhone ? null : `Tonight's Dish · ${latest.restaurantName}`}
              right={isPhone ? null : (
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)' }}>{runMeta}</span>
              )}
              style={isPhone ? { border: 0, padding: 0 } : { gap: 14 }}
            >
              {latest.count < 3 && (
                <div style={{ padding: '10px 12px', background: 'var(--amber-tint)', color: 'var(--amber)', borderRadius: 8, fontSize: 12.5 }}>
                  Only {latest.count} of 3 picks came back. The shortlist and checks below show why.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: isPhone ? 12 : 14 }}>
                {latest.recommendations.map((rec, index) => {
                  const scored = shortlistByName.get(nameKey(rec.title));
                  const chips = evidenceChips(scored);
                  const total = scored?.totalScore;

                  return (
                    <article
                      key={`${rec.title}-${index}`}
                      style={{ minWidth: 0, background: 'var(--paper, #f7f7f5)', color: 'var(--ink, #141a1b)', borderRadius: 4, padding: isPhone ? '12px 14px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em' }}>
                        <span style={{ fontWeight: 600, color: '#03808f' }}>{RANK_LABELS[index] || `PICK ${index + 1}`}</span>
                        <span style={{ color: 'var(--ink-soft, #5a6669)' }}>
                          {TYPE_LABELS[rec.type] || rec.type?.toUpperCase()}
                          {Number.isFinite(total) ? ` · ${total.toFixed(1)}` : ''}
                        </span>
                      </div>

                      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
                        {rec.title}
                      </h3>

                      {chips.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {chips.map(chip => (
                            <span key={chip} style={{ fontFamily: MONO, fontSize: 10.5, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--paper-line, #e0e2e0)' }}>
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ borderTop: '1px dashed var(--paper-line, #e0e2e0)' }} />

                      <div style={TICKET_LABEL}>WHY TONIGHT</div>
                      <p style={TICKET_TEXT}>{rec.reason_selected || '—'}</p>

                      <div style={TICKET_LABEL}>SAY THIS</div>
                      <p style={{ ...TICKET_TEXT, fontWeight: 600 }}>{rec.talking_point || rec.description || '—'}</p>

                      {rec.talking_point && rec.description && (
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--ink-soft, #5a6669)' }}>Dish description</summary>
                          <p style={{ ...TICKET_TEXT, marginTop: 6, fontSize: 12 }}>{rec.description}</p>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            </Card>
          )}

          {showRank && (
            <Card
              title={isPhone ? null : 'Shortlist and what happened to each dish'}
              style={isPhone ? { border: 0, padding: 0 } : undefined}
            >
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {menuOnly
                  ? `Full-menu mode: no weighted scoring for this restaurant, so Claude saw all ${fmt(diag.scoring?.totalCandidates)} eligible dishes.`
                  : "Bars are each signal's 0–100 score. Total is the weighted score that set the order."}
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip bg={TAG_COLORS.picked[0]} fg={TAG_COLORS.picked[1]}>{outcomeCounts.picked} PICKED</Chip>
                <Chip bg={TAG_COLORS.rejected[0]} fg={TAG_COLORS.rejected[1]}>{outcomeCounts.rejected} REJECTED</Chip>
                <Chip bg={TAG_COLORS.skipped[0]} fg={TAG_COLORS.skipped[1]}>{outcomeCounts.skipped} SKIPPED</Chip>
                <Chip bg={TAG_COLORS.other[0]} fg={TAG_COLORS.other[1]}>{outcomeCounts.other} NOT PICKED</Chip>
              </div>

              {rankingRows.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No shortlist came back for this run.</div>
              ) : isPhone ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>
                    {SIGNALS.map(([key, label, color]) => (
                      <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>

                  {rankingRows.map((row, index) => {
                    const [bg, fg] = TAG_COLORS[row.outcome.kind];
                    return (
                      <div key={`${row.name}-${index}`} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)', width: 16 }}>{index + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>{row.name}</span>
                          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600 }}>{scoreText(row.total)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 26 }}>
                          <span aria-hidden="true" style={{ flex: 1, display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--line-soft)', gap: 1 }}>
                            {SIGNALS.map(([key, , color]) => (
                              <span key={key} style={{ width: `${Math.max(0, row.contributions[key] || 0)}%`, background: color }} />
                            ))}
                          </span>
                          <Chip bg={bg} fg={fg}>{row.outcome.label}</Chip>
                        </div>
                        {row.reason && row.outcome.kind !== 'picked' && (
                          <div style={{ paddingLeft: 26, fontSize: 12, color: row.outcome.kind === 'rejected' ? 'var(--red)' : 'var(--muted)' }}>
                            {row.reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th scope="col" style={{ ...th, width: 30 }}>#</th>
                        <th scope="col" style={th}>DISH</th>
                        {SIGNALS.map(([key, label]) => (
                          <th key={key} scope="col" style={{ ...th, width: 150 }}>{label}</th>
                        ))}
                        <th scope="col" style={{ ...th, width: 70, textAlign: 'right' }}>TOTAL</th>
                        <th scope="col" style={{ ...th, width: 130 }}>RESULT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingRows.map((row, index) => {
                        const [bg, fg] = TAG_COLORS[row.outcome.kind];
                        return (
                          <tr key={`${row.name}-${index}`}>
                            <td style={{ ...td, fontFamily: MONO, fontSize: 12.5, color: 'var(--muted)' }}>{index + 1}</td>
                            <td style={td}>
                              <span style={{ display: 'block', fontWeight: 700 }}>{row.name}</span>
                              {row.reason && row.outcome.kind !== 'picked' && (
                                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: row.outcome.kind === 'rejected' ? 'var(--red)' : 'var(--muted)' }}>
                                  {row.reason}
                                </span>
                              )}
                            </td>
                            {SIGNALS.map(([key, , color]) => (
                              <td key={key} style={td}>
                                <SignalBar value={row.scores[key]} color={color} />
                              </td>
                            ))}
                            <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: 600 }}>{scoreText(row.total)}</td>
                            <td style={td}><Chip bg={bg} fg={fg}>{row.outcome.label}</Chip></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {showDetails && (
            <>
              <section aria-label="Run numbers" style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
                {kpis.map(([label, value, sub]) => (
                  <div key={label} style={{ padding: isPhone ? '12px 14px' : '16px 20px', borderRight: '1px solid var(--line-soft)', borderBottom: isPhone ? '1px solid var(--line-soft)' : 0, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{label}</div>
                    <div style={{ fontSize: isPhone ? 22 : 28, fontWeight: 800, letterSpacing: '-0.03em' }}>{value}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
                  </div>
                ))}
              </section>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
                <Card title="Checks on Claude's answer" style={{ flex: '1 1 520px', gap: 4 }}>
                  {events.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No checks recorded for this run.</div>
                  ) : (
                    events.map((event, index) => {
                      const [bg, fg] = TAG_COLORS[eventKind(event.outcome)];
                      return (
                        <div key={index} style={{ display: 'flex', flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'flex-start' : 'baseline', gap: isPhone ? 4 : 12, padding: '9px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
                          <Chip bg={bg} fg={fg}>{String(event.outcome || 'check').replaceAll('_', ' ').toUpperCase()}</Chip>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {event.dish && <b>{event.dish} · </b>}
                            <span style={{ color: 'var(--muted)' }}>{event.reason}</span>
                            {event.stage && (
                              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}> ({event.stage})</span>
                            )}
                          </span>
                        </div>
                      );
                    })
                  )}
                </Card>

                <Card
                  title="This session"
                  right={<span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Pick a run to see it again</span>}
                  style={{ flex: '1 1 520px' }}
                >
                  {isPhone ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {results.map((result, index) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => showRun(index)}
                          aria-current={index === 0 ? 'true' : undefined}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '11px 14px', borderRadius: 10, border: '1px solid var(--line)', background: index === 0 ? 'var(--accent-tint)' : 'var(--shell)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                              Run {result.runNumber} · {result.recommendations[0]?.title || 'No picks'}
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--muted)' }}>
                              {result.restaurantName.toUpperCase()} · {weightsText(result.config)} · {result.count} OF 3
                            </span>
                          </span>
                          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600 }}>
                            {money4(result.diagnostics?.usage?.estimatedCostUsd)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                      <thead>
                        <tr>
                          <th scope="col" style={th}>RUN</th>
                          <th scope="col" style={th}>WEIGHTS</th>
                          <th scope="col" style={th}>TOP PICK</th>
                          <th scope="col" style={{ ...th, textAlign: 'right' }}>COST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((result, index) => (
                          <tr key={result.id} style={{ background: index === 0 ? 'var(--accent-tint)' : 'transparent' }}>
                            <td style={td}>
                              <button type="button" onClick={() => showRun(index)} aria-current={index === 0 ? 'true' : undefined} style={LINK_BUTTON}>
                                Run {result.runNumber}
                              </button>
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{result.restaurantName}</span>
                            </td>
                            <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{weightsText(result.config)}</td>
                            <td style={td}>
                              <span style={{ display: 'block' }}>{result.recommendations[0]?.title || 'No picks'}</span>
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {result.count} of 3{result.diagnostics?.scoring?.mode === 'menu-only' ? ' · menu only' : ''}
                              </span>
                            </td>
                            <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: 600 }}>
                              {money4(result.diagnostics?.usage?.estimatedCostUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
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

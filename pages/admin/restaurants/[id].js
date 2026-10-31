// pages/admin/restaurants/[id].js
// One restaurant. The health box up top says why its dot is that color and
// links to the fix. Tabs: Overview, Activity, Menu, Invoices, Billing.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { Confirm, Dialog } from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../../components/client/ClientChrome';
import { Dot, StatusChip, Chip, Pills, Card, th, td, money, shortDate, HEALTH_WORD, DOT } from '../../../components/admin/ui';
import useIsPhone from '../../../lib/admin/useIsPhone';

const TABS = ['Overview', 'Activity', 'Menu', 'Invoices', 'Billing'];
const STEP_NAMES = ['Menu parsed', 'First invoice', 'POS connected', 'Tags placed', 'Scanner added'];

const ago = (ts) => {
  if (!ts) return 'Never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
};
const monthYear = (ts) => new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(ts));

function useLoad(url) {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!url) return;
    setError('');
    try {
      const res = await adminFetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [url, adminFetch]);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

function RestaurantPage({ id }) {
  const isPhone = useIsPhone();
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const [tab, setTab] = useState('Overview');

  useEffect(() => {
    if (isPhone && typeof router.query.tab === 'string' && TABS.includes(router.query.tab)) {
      setTab(router.query.tab);
    }
  }, [isPhone, router.query.tab]);
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}`);
  const {
    data: readinessData,
    error: readinessError,
    load: reloadReadiness,
  } = useLoad(`/api/admin/data-readiness?restaurantId=${encodeURIComponent(id)}`);

  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState('');

  async function act(body) {
    const res = await adminFetch(`/api/admin/restaurant/${id}/action`, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not save');
    return json;
  }

  async function runDish() {
    setRunning(true);
    setFlash('');
    try {
      const json = await act({ action: 'run-dish' });
      setFlash(`Tonight’s Dish picked: ${json.picks.join(', ')}`);
      load();
    } catch (e) {
      setFlash(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading restaurant…" />;

  const r = data.restaurant;
  const bad = data.checks.filter((c) => !c.ok);

  return (
    <>
      {!isPhone && <Link href="/admin/restaurants" style={{ fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>← All restaurants</Link>}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 360px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Dot level={r.health.level} size={12} />
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{r.name}</h1>
            <StatusChip status={r.status} />
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>
            {[r.town, r.owner ? `Owner ${r.owner.name}` : 'No owner login yet', `Joined ${monthYear(r.created_at)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.staffPreview
            ? <a className="om-btn" href={data.staffPreview} target="_blank" rel="noopener noreferrer">Open staff page ↗</a>
            : <button type="button" className="om-btn" disabled>No staff page yet</button>}
          <Link className="om-btn" href={`/admin/support?restaurant=${r.id}`}>Message</Link>
          <Link className="om-btn" href={`/admin/recipes?restaurant=${r.id}`}>Recipes &amp; prep</Link>
          <button type="button" className="om-btn" onClick={runDish} disabled={running || r.status === 'CLOSED'}>{running ? 'Running…' : 'Run Tonight’s Dish now'}</button>
          <Link className="om-btn" href="/admin/view-as">View as this restaurant</Link>
        </div>
      </div>
      {flash && <div style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <section aria-labelledby="health" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, border: `1.5px solid ${DOT[r.health.level]}`, borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ flex: '0 1 260px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>HEALTH · CHECKED {data.checkedAt.toUpperCase()}</div>
          <h2 id="health" style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot level={r.health.level} size={11} />{HEALTH_WORD[r.health.level]}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            {r.health.level === 'gray' ? r.health.reasons[0] : bad.length ? `${bad.length} check${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} you.` : 'Every check passed.'}
          </p>
        </div>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column' }}>
          {data.checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: 13.5 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: c.ok ? 'var(--green)' : DOT[r.health.level] }} />
              <span style={{ flex: 1 }}>{c.t}</span>
              {c.act && (c.href === '#run-dish'
                ? <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={runDish} disabled={running}>{c.act}</button>
                : <Link href={c.href} style={{ fontSize: 12.5, fontWeight: 700 }}>{c.act} →</Link>)}
            </div>
          ))}
        </div>
      </section>

      <div role="tablist" aria-label="Restaurant sections" style={{
        display: 'flex',
        gap: 22,
        borderBottom: '1px solid var(--line)',
        overflowX: isPhone ? 'auto' : 'visible',
        overflowY: isPhone ? 'hidden' : 'visible',
        flexWrap: isPhone ? 'nowrap' : 'wrap',
        position: isPhone ? 'sticky' : 'static',
        top: isPhone ? 48 : undefined,
        zIndex: isPhone ? 30 : undefined,
        background: isPhone ? 'var(--shell)' : undefined,
      }}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => {
            setTab(t);
            if (isPhone) {
              const query = { ...router.query, tab: t };
              if (t !== 'Menu') delete query.dish;
              router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
            }
          }}
            style={{ padding: '10px 0', border: 0, background: 'none', cursor: 'pointer', font: `${tab === t ? 700 : 500} 13.5px 'Manrope', sans-serif`, color: tab === t ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <Overview
          data={data}
          act={act}
          reload={load}
          readiness={readinessData?.readiness || null}
          readinessError={readinessError}
          reloadReadiness={reloadReadiness}
          onNavigate={setTab}
        />
      )}
      {tab === 'Activity' && <Activity id={id} />}
      {tab === 'Menu' && <Menu id={id} />}
      {tab === 'Invoices' && <Invoices id={id} />}
      {tab === 'Billing' && <Billing r={r} act={act} />}
    </>
  );
}


function ReadinessActions({ actions = [], isDemo = false, onNavigate }) {
  const [expanded, setExpanded] = useState({});

  const colors = {
    critical: 'var(--red)',
    high: 'var(--red)',
    medium: 'var(--amber)',
  };

  const visibleActions = isDemo ? [] : actions;

  return (
    <Card
      title="Action required"
      right={
        <span style={{
          fontFamily: MONO,
          fontSize: 11,
          color: visibleActions.length ? 'var(--amber)' : 'var(--green)',
          fontWeight: 700,
        }}>
          {isDemo
            ? 'DEMO ACCOUNT'
            : visibleActions.length
              ? `${visibleActions.length} ISSUES`
              : 'ALL CLEAR'}
        </span>
      }
    >
      {isDemo ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Internal demo data. Production action items are not tracked for this account.
        </div>
      ) : visibleActions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          No issues detected by the current Data Readiness checks.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 0 }}>
          {visibleActions.map((action, index) => {
            const open = Boolean(expanded[action.id]);
            const color = colors[action.priority] || 'var(--muted)';

            return (
              <div
                key={action.id}
                style={{
                  borderTop: index
                    ? '1px solid var(--line-soft)'
                    : 'none',
                  padding: '13px 0',
                }}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(previous => ({
                    ...previous,
                    [action.id]: !previous[action.id],
                  }))}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    padding: 0,
                    border: 0,
                    background: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontFamily: "'Manrope', sans-serif",
                  }}
                >
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    marginTop: 6,
                  }} />

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 800,
                    }}>
                      {action.title}
                    </span>
                    <span style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--muted)',
                      marginTop: 4,
                      lineHeight: 1.5,
                    }}>
                      {action.detail}
                    </span>
                  </span>

                  <span style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                    paddingTop: 3,
                  }}>
                    {action.priority}
                  </span>

                  <span style={{
                    color: 'var(--muted)',
                    fontSize: 14,
                    paddingTop: 1,
                  }}>
                    {open ? '−' : '+'}
                  </span>
                </button>

                {open && (
                  <div style={{
                    margin: '13px 0 0 18px',
                    padding: '14px',
                    borderRadius: 9,
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    display: 'grid',
                    gap: 13,
                  }}>
                    <div>
                      <div style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: 'var(--muted)',
                        letterSpacing: '0.1em',
                        marginBottom: 5,
                      }}>
                        IMPACT ON THE RESTAURANT
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                        {action.impact}
                      </div>
                    </div>

                    <div>
                      <div style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: 'var(--muted)',
                        letterSpacing: '0.1em',
                        marginBottom: 5,
                      }}>
                        HOW TO FIX IT
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                        {action.fix}
                      </div>
                    </div>

                    {action.affected?.length > 0 && (
                      <details>
                        <summary style={{
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}>
                          View affected dishes ({action.affected.length})
                        </summary>

                        <div style={{
                          marginTop: 9,
                          maxHeight: 240,
                          overflowY: 'auto',
                          display: 'grid',
                          gap: 0,
                        }}>
                          {action.affected.map(item => (
                            <div
                              key={item.id}
                              style={{
                                padding: '8px 0',
                                borderBottom: '1px solid var(--line-soft)',
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700 }}>
                                {item.name}
                              </div>

                              {item.reasons?.length > 0 && (
                                <div style={{
                                  fontSize: 11,
                                  color: 'var(--muted)',
                                  marginTop: 3,
                                }}>
                                  {item.reasons.join(' · ')}
                                </div>
                              )}

                              {item.ingredients?.length > 0 && (
                                <div style={{
                                  fontSize: 11,
                                  color: 'var(--muted)',
                                  marginTop: 3,
                                }}>
                                  Ingredients: {item.ingredients.join(', ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}>
                      <span style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                      }}>
                        Assigned to: {action.owner}
                      </span>

                      {action.id === 'missing-menu' ||
                       action.id === 'missing-recipes' ||
                       action.id === 'unverified-costs' ? (
                        <button
                          type="button"
                          className="om-btn"
                          onClick={() => onNavigate('Menu')}
                        >
                          Review menu →
                        </button>
                      ) : action.id === 'invoice-freshness' ? (
                        <button
                          type="button"
                          className="om-btn"
                          onClick={() => onNavigate('Invoices')}
                        >
                          Review invoices →
                        </button>
                      ) : (
                        <span style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                        }}>
                          Review POS integration settings
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Overview({
  data,
  act,
  reload,
  readiness,
  readinessError,
  reloadReadiness,
  onNavigate,
}) {
  const isPhone = useIsPhone();
  const r = data.restaurant;
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(null);
  const addr = r.address || {};
  const fullAddress = [addr.line1, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  const week = r.views.reduce((a, b) => a + b, 0);

  async function saveNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await act({ action: 'note', body: note });
      setNote('');
      setNoteOpen(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const stats = [
    ['LAST INVOICE', ago(r.lastInvoice), `${r.invoiceCount} in all · ${r.unreviewedCount} to check`],
    ['POS', r.conn ? (r.conn.status === 'connected' ? `Synced ${ago(r.conn.last_synced_at).toLowerCase()}` : r.conn.status) : 'Not connected', r.conn?.last_error || (r.conn ? r.conn.provider : 'No POS yet')],
    ['TONIGHT’S DISH', r.hasDishToday ? 'Ran today' : r.lastDish ? `Last ${shortDate(r.lastDish.date)}` : 'Not running', r.lastDish?.title || ''],
    ['STAFF PAGE', `${week} views`, `last 7 days · ${r.views[6]} yesterday`],
    ['MENU', `${r.menuCount} items`, 'Active on their menu'],
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '2 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Data">
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            {stats.map(([k, v, s]) => (
              <div key={k}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{v}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</div>
              </div>
            ))}
          </div>
        </Card>


        <ReadinessActions
          actions={readiness?.actions || []}
          isDemo={Boolean(readiness?.isDemo)}
          onNavigate={onNavigate}
        />

        <Card
          title="Data readiness"
          right={
            <button
              type="button"
              onClick={reloadReadiness}
              className="om-btn"
              style={{ minHeight: 30, fontSize: 12 }}
            >
              Refresh
            </button>
          }
        >
          {readinessError ? (
            <div style={{ fontSize: 13, color: 'var(--red)' }}>
              Could not load Data Readiness: {readinessError}
            </div>
          ) : !readiness ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Calculating data readiness…
            </div>
          ) : (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}>
                <div>
                  <div style={{
                    fontFamily: MONO,
                    fontSize: 34,
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    lineHeight: 1.2,
                  }}>
                    {readiness.score}
                    <span style={{
                      fontSize: 15,
                      color: 'var(--muted)',
                      fontWeight: 500,
                    }}>
                      /100
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    marginTop: 4,
                  }}>
                    Operational data completeness
                  </div>
                </div>

                <span style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: readiness.status === 'ready'
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
                height: 7,
                background: 'var(--line)',
                borderRadius: 20,
                overflow: 'hidden',
                marginBottom: 18,
              }}>
                <div style={{
                  height: '100%',
                  width: `${readiness.score}%`,
                  borderRadius: 20,
                  background: readiness.status === 'ready'
                    ? 'var(--green)'
                    : readiness.status === 'partial'
                      ? 'var(--amber)'
                      : 'var(--red)',
                }} />
              </div>

              <div style={{ display: 'grid', gap: 0 }}>
                {readiness.checks.map((check, index) => {
                  const color = check.status === 'ready'
                    ? 'var(--green)'
                    : check.status === 'partial'
                      ? 'var(--amber)'
                      : 'var(--red)';

                  return (
                    <div
                      key={check.id}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        padding: '12px 0',
                        borderTop: index
                          ? '1px solid var(--line-soft)'
                          : 'none',
                      }}
                    >
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                        marginTop: 6,
                      }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13,
                          fontWeight: 700,
                        }}>
                          {check.label}
                        </div>

                        <div style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          marginTop: 4,
                          lineHeight: 1.5,
                        }}>
                          {check.detail}
                        </div>

                        {check.status !== 'ready' && (
                          <div style={{
                            fontSize: 11.5,
                            color: 'var(--muted)',
                            marginTop: 5,
                          }}>
                            Next: {check.action}
                          </div>
                        )}
                      </div>

                      <div style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}>
                        {check.score}/{check.weight}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{
                marginTop: 16,
                padding: '13px 14px',
                border: '1px solid var(--line)',
                borderRadius: 9,
                background: 'var(--panel)',
              }}>
                <div style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--muted)',
                  marginBottom: 7,
                }}>
                  POS DATA SOURCE
                </div>

                <div style={{
                  fontSize: 13,
                  fontWeight: 700,
                }}>
                  {readiness.pos.dataSource}
                </div>

                <div style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginTop: 5,
                }}>
                  {readiness.pos.hasLiveConnection
                    ? `${readiness.pos.provider || 'POS'} · active connection`
                    : 'Recent sales records do not establish an active POS integration.'}
                </div>
              </div>

              <div style={{
                marginTop: 12,
                padding: '13px 14px',
                border: '1px solid var(--line)',
                borderRadius: 9,
                background: 'var(--panel)',
              }}>
                <div style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--muted)',
                  marginBottom: 7,
                }}>
                  INVOICE FRESHNESS
                </div>

                <div style={{
                  fontSize: 13,
                  fontWeight: 700,
                }}>
                  {readiness.invoice.ageDays == null
                    ? 'No invoices recorded'
                    : `Latest invoice: ${readiness.invoice.ageDays} days ago`}
                </div>

                <div style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginTop: 5,
                  lineHeight: 1.5,
                }}>
                  {readiness.invoice.status === 'stale'
                    ? 'Recent ingredient prices may need verification.'
                    : readiness.invoice.status === 'missing'
                      ? 'No invoice history is available to assess price freshness.'
                      : 'Invoice activity is recent.'}
                </div>
              </div>

              <div style={{
                marginTop: 12,
                fontSize: 11.5,
                color: 'var(--muted)',
                lineHeight: 1.5,
              }}>
                Data Readiness is separate from account Health.
                Ingredient pricing coverage does not guarantee
                that every recipe has a verified margin.
              </div>
            </>
          )}
        </Card>

        <Card title="Setup">
          {r.setup.map((ok, i) => (

            <div key={i} style={{ display: 'flex', gap: 10, alignItems: isPhone ? 'flex-start' : 'center', flexWrap: isPhone ? 'wrap' : 'nowrap', fontSize: 13.5, padding: '4px 0' }}>
              <span style={{ width: 20, flexShrink: 0, fontWeight: 800, color: ok ? 'var(--green)' : 'var(--faint)' }}>{ok ? '✓' : '○'}</span>
              <span style={{ fontWeight: 600, width: isPhone ? 105 : 140, flexShrink: 0 }}>{STEP_NAMES[i]}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12.5, flex: isPhone ? 1 : undefined, minWidth: isPhone ? 0 : undefined, overflowWrap: isPhone ? 'anywhere' : undefined }}>
                {i === 0 && (ok ? `${r.menuCount} items` : 'No menu yet')}
                {i === 1 && (ok ? `${r.invoiceCount} invoices` : 'No invoices yet')}
                {i === 2 && (r.conn ? `${r.conn.provider || 'POS'} · ${r.conn.status}` : 'Not connected')}
                {i === 3 && (r.tags.length ? r.tags.map((t) => `${t.label}${t.spot ? ' · ' + t.spot : ' · not placed'}`).join(', ') : 'No tags yet')}
                {i === 4 && (r.scanners.length ? r.scanners.map((s) => s.name).join(', ') : 'No scanner yet')}
              </span>
            </div>
          ))}
        </Card>

        <Card title="Tonight’s Dish · last 5 nights" right={<span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>TOP PICK vs TYPICAL SALES</span>}>
          {data.dishes.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No picks yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {data.dishes.map((d, i) => (
                <article key={i} style={{ background: 'var(--paper)', color: 'var(--ink)', borderRadius: 4, padding: '10px 12px', fontFamily: MONO, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--ink-soft)' }}>{d.date.toUpperCase()}</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}>{d.dish}</div>
                  {d.why && <div title={d.why} style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.why}</div>}
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 'auto' }}>{d.lift}</div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Notes">
          {isPhone ? (
            <>
              <button type="button" className="om-pri" onClick={() => setNoteOpen(true)} style={{ width: '100%' }}>
                + Add note
              </button>
              {noteOpen && (
                <Dialog title="Add note" sub="This note is only visible to your team." onClose={() => setNoteOpen(false)}>
                  <textarea className="om-field" rows={4} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note about this restaurant" aria-label="New note" style={{ padding: '8px 10px', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="om-btn" onClick={() => setNoteOpen(false)} style={{ flex: 1 }}>Cancel</button>
                    <button type="button" className="om-pri" onClick={saveNote} disabled={saving || !note.trim()} style={{ flex: 1 }}>
                      {saving ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </Dialog>
              )}
            </>
          ) : (
            <>
              <textarea className="om-field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this restaurant" aria-label="New note" style={{ padding: '8px 10px', resize: 'vertical' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="om-pri" onClick={saveNote} disabled={saving || !note.trim()}>{saving ? 'Saving…' : 'Save note'}</button>
              </div>
            </>
          )}
          {data.notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{n.when} · {n.by}</span>
                <button type="button" onClick={() => setDel(n)} aria-label="Delete note"
                  style={{ border: 0, background: 'none', padding: 0, color: 'var(--muted)', cursor: 'pointer', font: "600 12px 'Manrope', sans-serif" }}>Delete</button>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body}</div>
            </div>
          ))}
          {del && (
            <Confirm title="Delete this note?" sub={del.body.length > 140 ? `${del.body.slice(0, 140)}…` : del.body}
              yes="Delete note" danger busy={saving} onClose={() => setDel(null)}
              onYes={async () => {
                setSaving(true);
                try { await act({ action: 'delete-note', noteId: del.id }); setDel(null); reload(); } finally { setSaving(false); }
              }} />
          )}
        </Card>

        <Card title="Address" right={fullAddress && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700 }}>Open in Google Maps ↗</a>}>
          {fullAddress ? (
            <>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {addr.line1}{addr.line1 && <br />}{[addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </div>
              <iframe title={`Map of ${r.name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(fullAddress)}&z=15&output=embed`}
                loading="lazy" referrerPolicy="no-referrer-when-downgrade" style={{ width: '100%', height: 220, border: 0, borderRadius: 10 }} />
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No shipping address yet. It comes from the owner's onboarding.</div>
          )}
        </Card>

        <Card title="People & scanners">
          {r.people.length === 0 && r.scanners.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No one yet.</div>}
          {r.people.map((p, i) => (
            <Person key={'p' + i} name={p.name} sub={p.email} role="OWNER" />
          ))}
          {r.scanners.map((s, i) => (
            <Person key={'s' + i} name={s.name} sub={`Joined ${shortDate(s.joined_at)} · seen ${ago(s.last_seen_at).toLowerCase()}`} role="SCANNER" />
          ))}
        </Card>

        <Card title="Account">
          {[
            ['Created', shortDate(r.created_at) + ', ' + new Date(r.created_at).getFullYear()],
            ['Plan', r.subscription_status ? r.subscription_status.replace(/_/g, ' ') : 'No plan'],
            ['Food cost target', r.target_food_cost != null ? `${r.target_food_cost}%` : 'Not set'],
            ['Tags', r.tags.length ? r.tags.map((t) => t.label).join(', ') : 'None'],
            ['Closed', r.deactivated_at ? shortDate(r.deactivated_at) : 'No'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, borderTop: '1px solid var(--line-soft)', paddingTop: 7 }}>
              <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Person({ name, sub, role }) {
  const ini = String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{ini}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{name}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
      <Chip>{role}</Chip>
    </div>
  );
}

const KIND_COLOR = { INVOICE: 'var(--accent-deep)', SCAN: 'var(--accent-deep)', DISH: 'var(--green)', STAFF: 'var(--muted)', ADMIN: 'var(--amber)', NOTE: 'var(--amber)', MENU: 'var(--accent-deep)' };

function Activity({ id }) {
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}?part=activity`);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading activity…" />;
  return (
    <section aria-label="Activity" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '6px 18px' }}>
      {data.activity.length === 0 && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13.5 }}>Nothing in the last 60 days.</div>}
      {data.activity.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, padding: '9px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: 13.5, alignItems: 'baseline' }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)', width: 130, flexShrink: 0 }}>{a.when}</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: KIND_COLOR[a.kind], width: 66, flexShrink: 0 }}>{a.kind}</span>
          <span style={{ flex: 1 }}>{a.text}</span>
        </div>
      ))}
    </section>
  );
}

function Menu({ id }) {
  const isPhone = useIsPhone();
  const router = useRouter();
  const dishId = typeof router.query.dish === 'string' ? router.query.dish : '';
  const menuUrl = `/api/admin/restaurant/${id}?part=menu${dishId ? `&dish=${encodeURIComponent(dishId)}` : ''}`;
  const { data, error, load } = useLoad(menuUrl);
  const [f, setF] = useState('ALL');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading menu…" />;

  const rows = data.menu;
  const priced = rows.filter((m) => m.cost != null);
  const over = priced.filter((m) => m.pct > data.target);
  const waiting = rows.filter((m) => m.recipe !== 'PRICED');
  const shown = f === 'OVER' ? over : f === 'WAITING' ? waiting : rows;
  const avg = priced.length ? priced.reduce((a, m) => a + m.pct, 0) / priced.length : null;
  const selectedDish = dishId ? rows.find((m) => String(m.id) === dishId) : null;

  function closeRecipe() {
    const query = { ...router.query };
    delete query.dish;
    router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  }

  if (isPhone && dishId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button type="button" className="om-btn" onClick={closeRecipe} style={{ alignSelf: 'flex-start' }}>← Menu</button>
        {!selectedDish ? (
          <Card title="Dish not found">
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>This dish is no longer on the active menu.</p>
          </Card>
        ) : (
          <Card title={selectedDish.name} right={<Chip>{selectedDish.recipe}</Chip>}>
            <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{selectedDish.cat}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: '12px 0 16px' }}>
              {[
                ['PRICE', money(selectedDish.price)],
                ['PLATE COST', money(selectedDish.cost)],
                ['FOOD COST', selectedDish.pct != null ? `${selectedDish.pct.toFixed(1)}%` : '—'],
                ['MARGIN', money(selectedDish.margin)],
              ].map(([label, value]) => (
                <div key={label} style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--muted)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em' }}>{label}</div>
                  <div style={{ marginTop: 3, fontFamily: MONO, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
            {data.recipeFor !== dishId ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading recipe…</div>
            ) : data.recipeComponents?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.recipeComponents.map((component, i) => (
                  <section key={component.id || i} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                    <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 800 }}>{component.name || `Component ${i + 1}`}</h3>
                    {(component.component_ingredients || []).length ? component.component_ingredients.map((line, j) => (
                      <div key={line.id || j} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderTop: j ? '1px solid var(--line-soft)' : 0, fontSize: 13 }}>
                        <span>{[line.quantity, line.unit || line.ingredients?.unit, line.ingredients?.name].filter(Boolean).join(' ') || 'Ingredient'}</span>
                      </div>
                    )) : <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>No ingredients in this component.</div>}
                  </section>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                {data.recipeFor === dishId ? 'No recipe details are available for this dish.' : 'Loading recipe…'}
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
       <section aria-label="Menu summary" style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(170px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          ['ITEMS', rows.length, `${priced.length} fully priced`],
          ['AVG FOOD COST', avg != null ? `${avg.toFixed(1)}%` : '—', `Target ${data.target}%`],
          ['OVER TARGET', over.length, 'Priced dishes above target'],
          ['WAITING ON PRICES', waiting.length, 'No recipe or costs to approve'],
        ].map(([k, v, s]) => (
          <div key={k} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)' }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
          </div>
        ))}
      </section>
      <Pills label="Filter dishes" value={f} onChange={setF} options={[
        { key: 'ALL', label: 'All', n: rows.length },
        { key: 'OVER', label: 'Over target', n: over.length },
        { key: 'WAITING', label: 'Waiting on prices', n: waiting.length },
      ]} />
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: isPhone ? 'visible' : 'auto' }}>
        {isPhone ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {shown.map((m, i) => (
              <button key={m.id} type="button"
                onClick={() => router.push({ pathname: router.pathname, query: { ...router.query, dish: String(m.id) } }, undefined, { shallow: true })}
                aria-label={`View recipe for ${m.name}`}
                style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: 14, textAlign: 'left', border: 0, borderTop: i ? '1px solid var(--line-soft)' : 0, background: 'var(--shell)', color: 'var(--text)', font: 'inherit', cursor: 'pointer' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 15 }}>{m.name}</strong>
                    <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{m.cat}</span>
                  </span>
                  <strong style={{ flexShrink: 0, fontFamily: MONO }}>{money(m.price)}</strong>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, width: '100%' }}>
                  {[
                    ['PLATE COST', money(m.cost)],
                    ['MARGIN', money(m.margin)],
                    ['FOOD COST', m.pct != null ? `${m.pct.toFixed(1)}%` : '—'],
                    ['SOLD · 7 DAYS', m.sold == null ? '—' : Math.round(m.sold)],
                  ].map(([label, value]) => (
                    <span key={label} style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', color: 'var(--muted)', fontFamily: MONO, fontSize: 10 }}>{label}</span>
                      <strong style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 12.5, color: label === 'FOOD COST' && m.pct > data.target ? 'var(--red)' : 'var(--text)' }}>{value}</strong>
                    </span>
                  ))}
                </span>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%' }}>
                  <Chip bg={m.recipe === 'PRICED' ? 'var(--green-tint)' : m.recipe === 'NO RECIPE' ? 'var(--panel)' : 'var(--amber-tint)'} fg={m.recipe === 'PRICED' ? 'var(--green)' : m.recipe === 'NO RECIPE' ? 'var(--muted)' : 'var(--amber)'}>{m.recipe}</Chip>
                  <span style={{ color: 'var(--accent-deep)', fontSize: 12.5, fontWeight: 700 }}>View recipe →</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>ITEM</th>
              <th style={{ ...th, textAlign: 'right' }}>PRICE</th>
              <th style={{ ...th, textAlign: 'right' }}>PLATE COST</th>
              <th style={{ ...th, textAlign: 'right' }}>FOOD COST</th>
              <th style={{ ...th, textAlign: 'right' }}>MARGIN</th>
              <th style={th}>RECIPE</th>
              <th style={{ ...th, textAlign: 'right' }}>SOLD · 7 DAYS</th>
              <th style={{ ...th, textAlign: 'right', paddingRight: 18 }}>PICKED · 30 DAYS</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, paddingLeft: 18, maxWidth: 300 }}>
                  <span title={m.name} style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.cat}</span>
                </td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.price)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.cost)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, color: m.pct > data.target ? 'var(--red)' : 'var(--text)' }}>{m.pct != null ? `${m.pct.toFixed(1)}%` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.margin)}</td>
                <td style={td}><Chip bg={m.recipe === 'PRICED' ? 'var(--green-tint)' : m.recipe === 'NO RECIPE' ? 'var(--panel)' : 'var(--amber-tint)'} fg={m.recipe === 'PRICED' ? 'var(--green)' : m.recipe === 'NO RECIPE' ? 'var(--muted)' : 'var(--amber)'}>{m.recipe}</Chip></td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{m.sold == null ? '—' : Math.round(m.sold)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, paddingRight: 18 }}>{m.picked || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </section>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Plate cost only uses invoice prices and approved estimates, the same rule the owner sees. Picked counts how often Tonight’s Dish chose the dish in the last 30 days.</p>
    </div>
  );
}

function Invoices({ id }) {
  const isPhone = useIsPhone();
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}?part=invoices`);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading invoices…" />;
  const list = data.invoices;
  const toCheck = list.filter((i) => !i.reviewed).length;
  const month = new Date().toISOString().slice(0, 7);
  const spend = list.filter((i) => String(i.date || '').startsWith(month)).reduce((a, i) => a + (i.total || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(170px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          ['INVOICES', list.length, 'Real ones, samples left out'],
          ['TO CHECK', toCheck, 'Not reviewed by you yet'],
          ['COULD NOT READ', list.filter((i) => i.parse === 'failed').length, 'Parse failed'],
          ['SPEND THIS MONTH', money(spend, 0), 'From invoice totals'],
        ].map(([k, v, s]) => (
          <div key={k} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)' }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
          </div>
        ))}
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: isPhone ? 'visible' : 'auto' }}>
        {isPhone ? (
          list.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13.5 }}>No invoices yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {list.map((i, index) => (
                <Link key={i.id} href={`/admin/review?restaurant=${encodeURIComponent(id)}&invoice=${encodeURIComponent(i.id)}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderTop: index ? '1px solid var(--line-soft)' : 0, textDecoration: 'none', color: 'var(--text)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 15 }}>{i.vendor}</strong>
                      <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12.5 }}>{shortDate(i.date)}{i.number ? ` · #${i.number}` : ''}</span>
                    </span>
                    <strong style={{ flexShrink: 0, fontFamily: MONO }}>{money(i.total)}</strong>
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{i.lines ?? '—'} lines · Uploaded {i.uploaded}</span>
                    {i.parse === 'failed'
                      ? <Chip bg="var(--red-tint)" fg="var(--red)">COULD NOT READ</Chip>
                      : i.reviewed
                        ? <Chip bg="var(--green-tint)" fg="var(--green)">REVIEWED</Chip>
                        : <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">TO CHECK</Chip>}
                  </span>
                  <span style={{ alignSelf: 'flex-end', color: 'var(--accent-deep)', fontSize: 12.5, fontWeight: 700 }}>Review invoice →</span>
                </Link>
              ))}
            </div>
          )
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>DATE</th>
              <th style={th}>VENDOR</th>
              <th style={th}>NUMBER</th>
              <th style={{ ...th, textAlign: 'right' }}>LINES</th>
              <th style={{ ...th, textAlign: 'right' }}>TOTAL</th>
              <th style={th}>UPLOADED</th>
              <th style={th}>YOUR REVIEW</th>
              <th style={{ ...th, paddingRight: 18 }}><span style={{ position: 'absolute', left: -9999 }}>Open</span></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No invoices yet.</td></tr>}
            {list.map((i) => (
              <tr key={i.id}>
                <td style={{ ...td, paddingLeft: 18, fontFamily: MONO, fontSize: 12 }}>{shortDate(i.date)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{i.vendor}</td>
                <td style={{ ...td, fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{i.number || '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{i.lines ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(i.total)}</td>
                <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>{i.uploaded}</td>
                <td style={td}>
                  {i.parse === 'failed'
                    ? <Chip bg="var(--red-tint)" fg="var(--red)">COULD NOT READ</Chip>
                    : i.reviewed ? <Chip bg="var(--green-tint)" fg="var(--green)">REVIEWED</Chip> : <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">TO CHECK</Chip>}
                </td>
                <td style={{ ...td, paddingRight: 18 }}><Link href={`/admin/review?restaurant=${id}`} style={{ fontWeight: 700, fontSize: 12.5 }}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </section>
    </div>
  );
}

function Billing({ r, act }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function remove() {
    setBusy(true);
    setProblem('');

    try {
      await act({ action: 'delete-test-account', confirm: typed.trim() });
      router.push('/admin/restaurants');
    } catch (e) {
      setProblem(e.message);
      setBusy(false);
    }
  }

  return (
    <>
    <Card title="Billing">
      {[
        ['Plan', r.subscription_status ? r.subscription_status.replace(/_/g, ' ') : 'No plan'],
        ['Stripe customer', r.stripe_customer_id || 'Not created yet'],
        ['Stripe subscription', r.stripe_subscription_id || 'None'],
      ].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
          <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, fontFamily: MONO, fontSize: 12.5 }}>{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {r.stripe_customer_id && <a className="om-btn" href={`https://dashboard.stripe.com/customers/${r.stripe_customer_id}`} target="_blank" rel="noopener noreferrer">Open in Stripe ↗</a>}
        <Link className="om-pri" href={`/admin/billing/${r.id}`}>Open client billing →</Link>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>What they paid, what they cost you month by month, payments and billing actions are on the client billing page.</p>
    </Card>

    <Card title="Delete test account">
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
        For test signups only. This cancels the Stripe subscription, deletes the Stripe customer, then permanently deletes the restaurant and all of its data. It can’t be undone.
      </p>
      <button
        type="button"
        className="om-btn"
        onClick={() => { setTyped(''); setProblem(''); setOpen(true); }}
        style={{ alignSelf: 'flex-start', color: 'var(--red)' }}
      >
        Delete test account…
      </button>
    </Card>

    {open && (
      <Dialog title={`Delete ${r.name}?`} sub="Type the restaurant’s name exactly to confirm." onClose={() => { if (!busy) setOpen(false); }}>
        <input
          className="om-field"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={r.name}
          aria-label="Restaurant name"
          autoFocus
        />
        {problem && <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>{problem}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="om-btn" onClick={() => setOpen(false)} disabled={busy} style={{ flex: 1 }}>Cancel</button>
          <button
            type="button"
            className="om-pri"
            onClick={remove}
            disabled={busy || typed.trim() !== r.name}
            style={{ flex: 1, background: 'var(--red)' }}
          >
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </Dialog>
    )}
    </>
  );
}

export default function Page() {
  const router = useRouter();
  const { id } = router.query;
  return (
    <AdminShell section="Restaurants" sub="All restaurants" title="Restaurant"
      back={{ label: 'Restaurants', href: '/admin/restaurants' }}>
      {id ? <RestaurantPage id={id} /> : <LoadingState />}
    </AdminShell>
  );
}
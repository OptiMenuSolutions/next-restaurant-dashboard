// pages/admin/settings.js
// Settings: plans and the business numbers the admin uses for its math,
// feature switches, saved replies for the Support inbox, admin access and
// the audit log. The old Feature Flags page is at /admin/old/flags.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminShell, { PageHead, Dialog, Confirm } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, shortDate } from '../../components/admin/ui';

const TABS = ['Plans & limits', 'Feature switches', 'Saved replies', 'Admin access', 'Audit log'];
const FIELDS = [
  ['PLANS', [
    ['founding_price', 'Founding price, per month', '$', 'Locked for life for founding members. Shown on Revenue; what Stripe charges is set on the Stripe price.'],
    ['regular_price', 'Regular price, per month', '$', 'After the founding seats run out.'],
    ['founding_seats', 'Founding seats', '#', 'Revenue counts seats claimed against this.'],
    ['tags_per_plan', 'NFC tags per plan', '#', 'Shipped in the welcome kit.'],
    ['extra_tag_price', 'Price per extra tag', '$', 'Charged once when you log Sell extra tags.'],
  ]],
  ['YOUR COSTS', [
    ['kit_cost', 'What a tag kit costs you', '$', 'Applies to kits started from now on. Kits already sent keep the cost they had.'],
    ['tag_cost', 'What one loose tag costs you', '$', 'For replacements and add-on tags.'],
    ['hosting_monthly', 'Hosting per month', '$', 'Split across live restaurants in the profit numbers.'],
    ['ai_daily_alert', 'AI daily spend line', '$', 'The dashed line on AI & parsing.'],
  ]],
  ['SHIPPING', [
    ['ship_from', 'Return address for mailing labels', 'text', 'Printed on every 4×6 label.'],
  ]],
];
const when = (ts) => `${shortDate(ts)} · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ts))}`;
const NOISE = /^(GET|POST|PUT|PATCH|DELETE) \/api\//;

function SettingsPage() {
  const isPhone = useIsPhone();
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(TABS[0]);
  const [form, setForm] = useState({});
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [flag, setFlag] = useState(null);
  const [q, setQ] = useState('');
  const [hideNoise, setHideNoise] = useState(true);

  useEffect(() => {
    setTab(TABS.includes(router.query.tab) ? router.query.tab : TABS[0]);
  }, [router.query.tab]);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/business/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load settings');
      setData(json);
      setForm(Object.fromEntries(FIELDS.flatMap(([, list]) => list).map(([k]) => [k, json.settings[k] == null ? '' : String(json.settings[k])])));
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body, ok) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/business/settings', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (ok) setFlash(ok);
      await load();
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [adminFetch, load]);

  const audit = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.audit || []).filter((a) => (!hideNoise || !NOISE.test(a.action)) && (!s || `${a.action} ${a.target_restaurant_name || ''} ${a.admin_name || ''}`.toLowerCase().includes(s)));
  }, [data, q, hideNoise]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading settings…" />;

  const dirty = Object.keys(form).some((k) => String(form[k]) !== (data.settings[k] == null ? '' : String(data.settings[k])));

  return (
    <>
      <PageHead kicker="BUSINESS" title="Settings" />
      {isPhone ? (
        <select
          className="om-field"
          aria-label="Settings section"
          value={tab}
          onChange={(e) => {
            const nextTab = e.target.value;
            setTab(nextTab);
            setFlash('');
            router.push({ pathname: router.pathname, query: { ...router.query, tab: nextTab } }, undefined, { shallow: true, scroll: false });
          }}
          style={{ width: '100%', minHeight: 44, minWidth: 0, boxSizing: 'border-box' }}
        >
          {TABS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      ) : (
        <Pills label="Settings section" value={tab} onChange={(t) => { setTab(t); setFlash(''); }} options={TABS.map((t) => ({ key: t, label: t }))} />
      )}
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      {tab === 'Plans & limits' && (
        <Card title="Plans & limits" right={<button type="button" className="om-pri" disabled={!dirty || busy} onClick={() => post({ action: 'save-settings', values: form }, 'Saved.')}>{busy ? 'Saving…' : 'Save'}</button>}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>The numbers the admin uses for its math. Changes apply from now on; existing founding members keep their price. Leave a box empty to go back to the default.</div>
          {FIELDS.map(([group, list]) => (
            <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)', margin: '10px 0 4px' }}>{group}</div>
              {list.map(([key, label, kind, help]) => (
                <label key={key} style={{ display: 'flex', flexDirection: isPhone ? 'column' : 'row', flexWrap: 'wrap', gap: isPhone ? 8 : '6px 16px', alignItems: isPhone ? 'stretch' : 'center', padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ flex: isPhone ? undefined : '1 1 260px', minWidth: isPhone ? 0 : undefined }}>
                    <b style={{ fontSize: 13.5 }}>{label}</b>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{help}</span>
                  </span>
                  {kind === 'text'
                    ? <textarea className="om-field" rows={3} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ flex: isPhone ? undefined : '0 1 320px', width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : undefined, boxSizing: isPhone ? 'border-box' : undefined, padding: 8, resize: 'vertical' }} />
                    : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : undefined }}>
                        {kind === '$' && <span style={{ fontFamily: MONO, color: 'var(--muted)' }}>$</span>}
                        <input className="om-field" inputMode="decimal" value={form[key]} placeholder={settingHint(data, key)} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ width: isPhone ? '100%' : 110, minWidth: isPhone ? 0 : undefined, minHeight: isPhone ? 44 : undefined, boxSizing: isPhone ? 'border-box' : undefined, fontFamily: MONO }} />
                      </span>
                    )}
                </label>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Scanner login limits and invite expiry are set in the code, so they are not here.</div>
        </Card>
      )}

      {tab === 'Feature switches' && (
        <Card title="Feature switches" right={<button type="button" className="om-btn" onClick={() => setFlag({})}>Add a switch</button>}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Changes save the moment you flip them. A switch only does something once the app’s code checks its key.</div>
          {data.flagsError && <div style={{ fontSize: 13, color: 'var(--red)' }}>{data.flagsError}</div>}
          {data.flags.length === 0 && !data.flagsError && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No switches yet.</div>}
          {data.flags.map((f) => (
            <div key={f.id} style={{ display: 'flex', flexWrap: isPhone ? 'wrap' : undefined, gap: isPhone ? 10 : 14, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ flex: isPhone ? '1 1 100%' : 1, minWidth: 0, overflowWrap: isPhone ? 'anywhere' : undefined }}>
                <b style={{ fontSize: 13.5 }}>{f.label}</b> <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{f.key}</span>
                {f.description && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{f.description}</span>}
              </span>
              <Chip bg={f.enabled ? 'var(--green-tint)' : 'var(--panel)'} fg={f.enabled ? 'var(--green)' : 'var(--muted)'}>{f.enabled ? 'ON' : 'OFF'}</Chip>
              <button type="button" role="switch" aria-checked={!!f.enabled} aria-label={`${f.label} ${f.enabled ? 'on' : 'off'}`} disabled={busy}
                onClick={() => post({ action: 'flag-toggle', id: f.id, enabled: !f.enabled })}
                style={{ width: 42, height: 24, borderRadius: 12, border: 0, cursor: 'pointer', position: 'relative', background: f.enabled ? 'var(--accent-deep)' : 'var(--line)', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: f.enabled ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </button>
              <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setFlag(f)}>Edit</button>
            </div>
          ))}
        </Card>
      )}

      {tab === 'Saved replies' && (
        <Card title="Saved replies" right={<button type="button" className="om-btn" onClick={() => setReply({})}>Add a reply</button>}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>These show as quick buttons under the reply box in the Support inbox. {'{name}'} fills in the owner’s first name.</div>
          {data.replies.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No saved replies yet.</div>}
          {data.replies.map((r) => (
            <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{r.label}</b> <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>USED {r.used_count || 0}×</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{r.body}</span>
              </span>
              <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setReply(r)}>Edit</button>
            </div>
          ))}
        </Card>
      )}

      {tab === 'Admin access' && (
        <Card title="Admin access">
          {data.admins.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-deep)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{String(a.full_name || a.email || 'A')[0].toUpperCase()}</span>
              <span style={{ flex: 1, minWidth: isPhone ? 0 : undefined, overflowWrap: isPhone ? 'anywhere' : undefined }}><b>{a.full_name || a.email}</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{a.email}</span></span>
              <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">ADMIN</Chip>
            </div>
          ))}
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Anyone whose profile role is admin can sign in here. To add a teammate, make their account and set their role to admin in Supabase. Inviting from this page comes later.</div>
        </Card>
      )}

      {tab === 'Audit log' && (
        <Card title="Audit log">
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Every change made in the admin, newest first, with who made it. The old admin pages also log each time they load data; those are hidden unless you untick the box.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <input className="om-field" placeholder="Search the log" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} /> Hide page loads from the old admin</label>
          </div>
          {audit.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing matches.</div>}
          {audit.slice(0, 200).map((a) => (
            <div key={a.id} style={{ display: 'flex', flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 5 : 14, padding: isPhone ? '12px 0' : '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)', width: isPhone ? undefined : 130, flexShrink: 0 }}>{when(a.created_at)}</span>
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                {a.action}{a.target_restaurant_name ? <span style={{ color: 'var(--muted)' }}> · {a.target_restaurant_name}</span> : null}{a.reason ? <span style={{ color: 'var(--muted)' }}> · reason: {a.reason}</span> : null}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, overflowWrap: isPhone ? 'anywhere' : undefined }}>{a.admin_name}</span>
            </div>
          ))}
        </Card>
      )}

      {reply && <ReplyDialog r={reply} busy={busy} onClose={() => setReply(null)} post={post} />}
      {flag && <FlagDialog f={flag} busy={busy} onClose={() => setFlag(null)} post={post} />}
    </>
  );
}

function settingHint(data, key) {
  return data.setKeys.includes(key) ? '' : 'default';
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function ReplyDialog({ r, busy, onClose, post }) {
  const [f, setF] = useState({ label: r.label || '', body: r.body || '' });
  const [askDel, setAskDel] = useState(false);
  return (
    <Dialog title={r.id ? 'Edit saved reply' : 'Add a saved reply'} sub="{name} fills in the owner’s first name." onClose={onClose} width={560}>
      <Field label="Button label"><input className="om-field" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Thanks, on it" /></Field>
      <Field label="Reply text"><textarea className="om-field" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ padding: 10, resize: 'vertical' }} /></Field>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {r.id ? <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button> : <span />}
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="om-pri" disabled={busy || !f.label.trim() || !f.body.trim()} onClick={async () => { if (await post({ action: 'reply-save', id: r.id || undefined, ...f })) onClose(); }}>{busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {askDel && <Confirm title={`Delete the reply ${r.label}?`} sub="Its button leaves the Support inbox." yes="Delete reply" danger busy={busy} onClose={() => setAskDel(false)} onYes={async () => { if (await post({ action: 'reply-delete', id: r.id })) onClose(); setAskDel(false); }} />}
    </Dialog>
  );
}

function FlagDialog({ f: flag, busy, onClose, post }) {
  const [f, setF] = useState({ label: flag.label || '', key: flag.key || '', description: flag.description || '' });
  const [askDel, setAskDel] = useState(false);
  return (
    <Dialog title={flag.id ? 'Edit switch' : 'Add a switch'} sub="New switches start off." onClose={onClose}>
      <Field label="Name"><input className="om-field" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Store app prompts" /></Field>
      <Field label="Key (what the code checks)"><input className="om-field" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} placeholder="e.g. store_app_prompts" style={{ fontFamily: MONO }} /></Field>
      <Field label="What it does (optional)"><input className="om-field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {flag.id ? <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button> : <span />}
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="om-pri" disabled={busy || !f.label.trim() || !f.key.trim()} onClick={async () => { if (await post({ action: 'flag-save', id: flag.id || undefined, ...f })) onClose(); }}>{busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {askDel && <Confirm title={`Delete ${flag.label}?`} sub={`Code that checks ${flag.key} will see it as off.`} yes="Delete switch" danger busy={busy} onClose={() => setAskDel(false)} onYes={async () => { if (await post({ action: 'flag-delete', id: flag.id })) onClose(); setAskDel(false); }} />}
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Business" sub="Settings" title="Settings">
      <SettingsPage />
    </AdminShell>
  );
}
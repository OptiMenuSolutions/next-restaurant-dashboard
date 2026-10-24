// pages/admin/health.js
// Jobs & health: the outside services OptiMenu leans on (checked when you
// open the page), last night's chain of jobs with the last 14 nights of
// each, every run of a job, and the error list.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, th, td, shortDate } from '../../components/admin/ui';

const RUN = {
  ok: ['RAN OK', 'var(--green-tint)', 'var(--green)'],
  partial: ['PROBLEMS', 'var(--amber-tint)', 'var(--amber)'],
  failed: ['FAILED', 'var(--red-tint)', 'var(--red)'],
  missed: ['DID NOT RUN', 'var(--red-tint)', 'var(--red)'],
  waiting: ['NOT YET', 'var(--panel)', 'var(--muted)'],
  none: ['NOT TRACKED', 'var(--panel)', 'var(--muted)'],
};
const SVC = { UP: ['var(--green-tint)', 'var(--green)'], SLOW: ['var(--amber-tint)', 'var(--amber)'], DOWN: ['var(--red-tint)', 'var(--red)'], 'NOT SET': ['var(--amber-tint)', 'var(--amber)'] };
const ERR = { open: 'New', investigating: 'Watching', resolved: 'Fixed' };

const took = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`);
const clock = (ts) => (ts ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) : '—');
const when = (ts) => (ts ? `${shortDate(ts)}, ${clock(ts)}` : '—');

function RunChip({ status }) {
  const [label, bg, fg] = RUN[status] || RUN.none;
  return <Chip bg={bg} fg={fg}>{label}</Chip>;
}

function NightStrip({ nights }) {
  return (
    <div role="img" aria-label={`Last ${nights.length} nights: ${nights.map((n) => `${shortDate(n.date)} ${RUN[n.status][0].toLowerCase()}`).join(', ')}`} style={{ display: 'flex', gap: 3 }}>
      {nights.map((n) => {
        const [, bg, fg] = RUN[n.status];
        const solid = n.status === 'ok' || n.status === 'partial' || n.status === 'failed';
        return <span key={n.date} title={`${shortDate(n.date)}: ${RUN[n.status][0]}`} style={{ width: 12, height: 12, borderRadius: 3, background: solid ? fg : bg, border: n.status === 'missed' ? `2px solid ${fg}` : '1px solid var(--line)', boxSizing: 'border-box' }} />;
      })}
    </div>
  );
}

async function copy(text, setFlash) {
  try { await navigator.clipboard.writeText(text); setFlash('Copied. Paste it into a chat with Claude.'); } catch { setFlash('Could not copy. Your browser blocked the clipboard.'); }
}

function HealthPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const isPhone = useIsPhone();
  const [data, setData] = useState(null);
  const [svc, setSvc] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [errTab, setErrTab] = useState('open');

  useEffect(() => {
    const status = String(router.query.status || '');
    if (['open', 'investigating', 'resolved'].includes(status)) setErrTab(status);
  }, [router.query.status]);
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState('');
  const [stackOpen, setStackOpen] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/platform/jobs');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load jobs');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);

  const checkServices = useCallback(async () => {
    setSvc(null);
    try {
      const res = await adminFetch('/api/admin/platform/jobs?services=1');
      const json = await res.json();
      setSvc(res.ok ? json : { services: [], error: json.error });
    } catch (e) {
      setSvc({ services: [], error: e.message });
    }
  }, [adminFetch]);

  useEffect(() => { load(); checkServices(); }, [load, checkServices]);

  const post = async (body, key) => {
    setBusy(key);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/platform/jobs', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not do that');
      if (json.message) setFlash(json.message);
      await load();
    } catch (e) {
      setFlash(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading jobs and health…" />;

  const selectedJob = data.jobs.find((j) => j.key === String(router.query.job || ''));
  const job = selectedJob || data.jobs.find((j) => j.key === open);
  const selectedError = data.errors.find((e) => e.id === String(router.query.error || ''));
  const errs = data.errors.filter((e) => e.status === errTab);
  const count = (s) => data.errors.filter((e) => e.status === s).length;

  const jobText = (j) => [
    `OptiMenu nightly job: ${j.name} (pages/api/cron/${j.key}.js), scheduled ${j.time} Eastern.`,
    `What it does: ${j.what}`,
    'Recent runs, newest first:',
    ...j.runs.slice(0, 10).map((r) => `- ${when(r.at)} (${r.trigger}), took ${took(r.ms)}, ${RUN[r.status][0]}: ${r.summary}${r.details.length ? '\n    ' + r.details.join('\n    ') : ''}`),
  ].join('\n');
  const errText = (e) => [
    `OptiMenu error in ${e.feature}${e.restaurant ? ` for ${e.restaurant}` : ''}.`,
    `Seen ${e.times} time${e.times === 1 ? '' : 's'}, first ${when(e.first)}, last ${when(e.last)}.`,
    `Message: ${e.message}`,
    ...(e.stack ? ['Details:', e.stack] : []),
  ].join('\\n');

  if (isPhone && selectedJob) {
    return (
      <PhoneJobDetail
        job={selectedJob}
        busy={busy}
        flash={flash}
        onRun={() => post({ action: 'run', job: selectedJob.key }, selectedJob.key)}
        onCopy={() => copy(jobText(selectedJob), setFlash)}
      />
    );
  }

  if (isPhone && selectedError) {
    return (
      <PhoneErrorDetail
        error={selectedError}
        busy={busy}
        flash={flash}
        onCopy={() => copy(errText(selectedError), setFlash)}
        onStatus={(status) => post({ action: 'error', id: selectedError.id, status }, selectedError.id)}
      />
    );
  }

  return (
    <>
      <PageHead kicker="PLATFORM" title="Jobs & health" sub="The outside services OptiMenu leans on, the nightly jobs, and every error worth a look." />
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <Card title="Services" right={<button type="button" className="om-btn" onClick={checkServices} disabled={!svc}>{svc ? 'Check again' : 'Checking…'}</button>}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Each one is called when you open this page{svc?.checkedAt ? `, last at ${clock(svc.checkedAt)}` : ''}.</div>
        {isPhone && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {!svc && <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', fontSize: 13 }}>Checking each service…</div>}
            {svc?.error && <div style={{ gridColumn: '1 / -1', color: 'var(--red)', fontSize: 13 }}>{svc.error}</div>}
            {(svc?.services || []).map((s) => (
              <div key={s.name} style={{ minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 11 }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{s.name}</strong>
                <div style={{ margin: '5px 0 8px', fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{s.use}</div>
                <Chip bg={SVC[s.status][0]} fg={SVC[s.status][1]}>{s.status}</Chip>
                <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 11.5 }}>{s.ms} ms</div>
                {s.error && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--red)', overflowWrap: 'anywhere' }}>{s.error}</div>}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: isPhone ? 'none' : undefined, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
            <thead><tr><th style={th}>SERVICE</th><th style={th}>WHAT WE USE IT FOR</th><th style={th}>STATUS</th><th style={{ ...th, textAlign: 'right' }}>RESPONSE</th><th style={th}>PROBLEM</th></tr></thead>
            <tbody>
              {!svc && <tr><td colSpan={5} style={{ ...td, color: 'var(--muted)' }}>Checking each service…</td></tr>}
              {svc?.error && <tr><td colSpan={5} style={{ ...td, color: 'var(--red)' }}>{svc.error}</td></tr>}
              {(svc?.services || []).map((s) => (
                <tr key={s.name}>
                  <td style={{ ...td, fontWeight: 700 }}>{s.name}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{s.use}</td>
                  <td style={td}><Chip bg={SVC[s.status][0]} fg={SVC[s.status][1]}>{s.status}</Chip></td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5 }}>{s.ms} ms</td>
                  <td style={{ ...td, fontSize: 12.5, color: s.error ? 'var(--red)' : 'var(--muted)' }}>{s.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Last night’s chain" right={<span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>LAST 14 NIGHTS · OLDEST → LAST NIGHT</span>}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>
          Each job feeds the next. Click a job to see every run.
          {!data.tracking && ' No runs recorded yet. The first ones show up after tonight’s jobs.'}
        </div>
        <div style={{ display: isPhone ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {data.jobs.map((j) => {
            const on = j.key === open;
            return (
              <button key={j.key} type="button" aria-expanded={on} onClick={() => setOpen(on ? null : j.key)}
                style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-tint)' : 'var(--shell)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text)', font: "500 13px 'Manrope',sans-serif" }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{j.time}</span>
                  <RunChip status={j.today.status} />
                </span>
                <b style={{ fontSize: 14.5 }}>{j.name}</b>
                <span style={{ fontSize: 12, color: 'var(--muted)', minHeight: 32 }}>{j.today.summary ? `${j.today.summary}${j.today.ms != null ? ` · ${took(j.today.ms)}` : ''}` : j.what}</span>
                <NightStrip nights={j.nights} />
              </button>
            );
          })}
        </div>

        {isPhone && (
          <div style={{ display: 'grid', gap: 10 }}>
            {data.jobs.map((j) => (
              <div key={j.key} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'var(--shell)' }}>
                <button type="button" onClick={() => router.push({ pathname: '/admin/health', query: { job: j.key } }, undefined, { shallow: true })} style={{ display: 'grid', width: '100%', gap: 7, padding: 0, border: 0, background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{j.time}</span>
                    <RunChip status={j.today.status} />
                  </span>
                  <strong style={{ fontSize: 14.5, overflowWrap: 'anywhere' }}>{j.name}</strong>
                  <span style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{j.today.summary || j.what}</span>
                  <NightStrip nights={j.nights} />
                </button>
                {j.canRun
                  ? <button type="button" className="om-btn" disabled={!!busy} onClick={() => post({ action: 'run', job: j.key }, j.key)} style={{ marginTop: 9 }}>{busy === j.key ? 'Running…' : 'Run now'}</button>
                  : <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>Runs on schedule; it deletes data.</div>}
              </div>
            ))}
          </div>
        )}

        {!isPhone && job && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, flex: 1 }}>{job.name} · every run</h3>
              <button type="button" className="om-btn" onClick={() => copy(jobText(job), setFlash)}>Copy details for Claude</button>
              {job.canRun
                ? <button type="button" className="om-pri" disabled={!!busy} onClick={() => post({ action: 'run', job: job.key }, job.key)}>{busy === job.key ? 'Running…' : 'Run now'}</button>
                : <span style={{ fontSize: 12, color: 'var(--muted)' }}>Deletes data, so it only runs on schedule.</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{job.what}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <thead><tr><th style={th}>NIGHT</th><th style={th}>STARTED</th><th style={th}>TOOK</th><th style={{ ...th, textAlign: 'right' }}>RESTAURANTS</th><th style={th}>RESULT</th><th style={th}>DETAIL</th></tr></thead>
                <tbody>
                  {job.runs.length === 0 && <tr><td colSpan={6} style={{ ...td, color: 'var(--muted)' }}>No runs recorded yet.</td></tr>}
                  {job.runs.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{shortDate(r.night)}</td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{clock(r.at)}{r.trigger === 'manual' && <span style={{ display: 'block', fontFamily: 'inherit', fontSize: 11, color: 'var(--muted)' }}>by hand</span>}</td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{took(r.ms)}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.restaurants ?? '—'}</td>
                      <td style={td}><RunChip status={r.status} /></td>
                      <td style={{ ...td, fontSize: 12.5 }}>{r.summary}{r.details.map((d) => <span key={d} style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{d}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card title="Errors">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Every new error also lands on Today as a to-do. A job that fails or has problems adds one here by itself.</div>
        <Pills label="Error status" value={errTab} onChange={(value) => {
          setErrTab(value);
          if (isPhone) router.push({ pathname: '/admin/health', query: { status: value } }, undefined, { shallow: true });
        }} options={[{ key: 'open', label: 'New', n: count('open') }, { key: 'investigating', label: 'Watching', n: count('investigating') }, { key: 'resolved', label: 'Fixed', n: count('resolved') }]} />
        {isPhone && (
          <div style={{ display: 'grid', gap: 10 }}>
            {errs.length === 0 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Nothing {ERR[errTab].toLowerCase()}.</div>}
            {errs.map((e) => (
              <button key={e.id} type="button" onClick={() => router.push({ pathname: '/admin/health', query: { error: e.id, status: errTab } }, undefined, { shallow: true })} style={{ width: '100%', minWidth: 0, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--shell)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{String(e.feature || 'Error').replace(/[_-]+/g, ' ').replace(/^\\w/, (c) => c.toUpperCase())}</strong>
                <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{e.message}</span>
                <span style={{ display: 'block', marginTop: 7, fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>{e.restaurant || 'Platform'} · {e.times} time{e.times === 1 ? '' : 's'} · {when(e.last)}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: isPhone ? 'none' : undefined, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
            <thead><tr><th style={th}>WHAT HAPPENED</th><th style={th}>WHERE</th><th style={{ ...th, textAlign: 'right' }}>TIMES</th><th style={th}>LAST SEEN</th><th style={{ ...th, textAlign: 'right' }}>ACTIONS</th></tr></thead>
            <tbody>
              {errs.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Nothing {ERR[errTab].toLowerCase()}.</td></tr>}
              {errs.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, maxWidth: 420 }}>
                    <b style={{ display: 'block' }}>{String(e.feature || 'Error').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)', wordBreak: 'break-word' }}>{e.message}</span>
                    {e.stack && (
                      <>
                        <button type="button" onClick={() => setStackOpen(stackOpen === e.id ? null : e.id)} style={{ display: 'block', border: 0, background: 'none', padding: '4px 0 0', color: 'var(--accent-deep)', cursor: 'pointer', font: "600 12px 'Manrope',sans-serif" }}>{stackOpen === e.id ? 'Hide details' : 'Show details'}</button>
                        {stackOpen === e.id && <pre style={{ margin: '6px 0 0', padding: 10, background: 'var(--panel)', borderRadius: 8, fontFamily: MONO, fontSize: 11.5, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{e.stack}</pre>}
                      </>
                    )}
                  </td>
                  <td style={td}>{e.restaurant ? <Link href={`/admin/restaurants/${e.restaurant_id}`} style={{ color: 'var(--text)' }}>{e.restaurant}</Link> : <span style={{ color: 'var(--muted)' }}>Platform</span>}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{e.times}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{when(e.last)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => copy(errText(e), setFlash)}>Copy for Claude</button>{' '}
                    {e.status === 'open' && <><button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => post({ action: 'error', id: e.id, status: 'investigating' }, e.id)}>Watch</button>{' '}</>}
                    {e.status !== 'resolved'
                      ? <button type="button" className="om-pri" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => post({ action: 'error', id: e.id, status: 'resolved' }, e.id)}>Mark fixed</button>
                      : <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => post({ action: 'error', id: e.id, status: 'open' }, e.id)}>Reopen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function PhoneJobDetail({ job, busy, onRun, onCopy, flash }) {
  return (
    <>
      <PageHead kicker={`PLATFORM · ${job.time}`} title={job.name} sub={job.what}>
        {job.canRun
          ? <button type="button" className="om-pri" disabled={!!busy} onClick={onRun}>{busy === job.key ? 'Running…' : 'Run now'}</button>
          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>Runs on schedule; it deletes data.</span>}
        <button type="button" className="om-btn" onClick={onCopy}>Copy details for Claude</button>
      </PageHead>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}
      <Card title="Last 14 runs">
        {job.runs.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No runs recorded yet.</div>}
        <div style={{ display: 'grid', gap: 10 }}>
          {job.runs.map((r) => (
            <div key={r.id} style={{ minWidth: 0, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <strong>{shortDate(r.night)}</strong>
                <RunChip status={r.status} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 5, fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>
                <span>{clock(r.at)}{r.trigger === 'manual' ? ' · by hand' : ''}</span>
                <span>{took(r.ms)}</span>
                <span>{r.restaurants ?? '—'} restaurants</span>
              </div>
              <div style={{ marginTop: 5, fontSize: 13, overflowWrap: 'anywhere' }}>
                {r.summary}
                {r.details.map((detail) => <span key={detail} style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 12 }}>{detail}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function PhoneErrorDetail({ error, busy, flash, onCopy, onStatus }) {
  const feature = String(error.feature || 'Error').replace(/[_-]+/g, ' ').replace(/^\\w/, (c) => c.toUpperCase());

  return (
    <>
      <PageHead kicker={`PLATFORM · ${ERR[error.status] || 'Error'}`} title={feature} sub={`${error.times} occurrence${error.times === 1 ? '' : 's'} · first ${when(error.first)} · last ${when(error.last)}`} />
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}
      <Card title="Error details">
        <div style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{error.message}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {error.restaurant
            ? <Link href={`/admin/restaurants/${error.restaurant_id}`} style={{ color: 'var(--accent-deep)' }}>{error.restaurant}</Link>
            : <span style={{ color: 'var(--muted)' }}>Platform</span>}
        </div>
        {error.stack && <pre style={{ margin: '12px 0 0', padding: 10, background: 'var(--panel)', borderRadius: 8, fontFamily: MONO, fontSize: 11.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{error.stack}</pre>}
      </Card>
      <Card title="Actions">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="om-btn" disabled={!!busy} onClick={onCopy}>Copy details for Claude</button>
          {error.status === 'open' && <button type="button" className="om-btn" disabled={!!busy} onClick={() => onStatus('investigating')}>Watch</button>}
          {error.status !== 'resolved'
            ? <button type="button" className="om-pri" disabled={!!busy} onClick={() => onStatus('resolved')}>Mark fixed</button>
            : <button type="button" className="om-btn" disabled={!!busy} onClick={() => onStatus('open')}>Reopen</button>}
        </div>
      </Card>
    </>
  );
}

export default function Page() {
  const router = useRouter();
  const isPhone = useIsPhone();
  const hasDetail = router.isReady && (router.query.job || router.query.error);
  const status = String(router.query.status || 'open');
  const back = isPhone && hasDetail
    ? { label: 'Jobs & health', href: router.query.error ? `/admin/health?status=${encodeURIComponent(status)}` : '/admin/health' }
    : undefined;

  return (
    <AdminShell section="Platform" sub="Jobs & health" title="Jobs & health" back={back}>
      <HealthPage />
    </AdminShell>
  );
}
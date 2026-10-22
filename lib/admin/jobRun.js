// lib/admin/jobRun.js
// Records every nightly job run in admin_job_runs, so Jobs & health (and
// Today) can show what ran, how long it took and what went wrong.
//
// Each cron file wraps its handler:
//   export default withJobRun('sync-all-pos', handler);
//
// The wrapper holds the handler's response until the run is saved, then
// sends it. (On Vercel, work after the response is sent can be cut off.)
// A failed or partly failed run also opens an entry in error_queue, which
// puts a to-do on Today. Calls without the cron secret pass straight
// through and are not recorded.

import { adminDb as db } from './requireAdmin';

const len = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const lines = (list, fmt) => (Array.isArray(list) ? list.map(fmt) : []);

// In run order. utc is the vercel.json schedule (minute hour).
export const JOBS = [
    {
    key: 'refresh-shift4-tokens', name: 'Shift4 sign-in', utc: [15, 6],
    what: 'Every 6 hours, renews each Shift4 connection’s sign-in before it expires and checks the renewed one works.',
    summary: (b) => `${len(b.refreshed)} renewed · ${len(b.failed)} failed · ${Math.max(0, (b.checked ?? 0) - (b.due ?? 0))} not due yet`,
    problems: (b) => len(b.failed),
    details: (b) => lines(b.failed, (f) => `${f.restaurant || `Restaurant ${f.restaurantId}`}: ${f.error}`),
    restaurants: (b) => b.checked ?? 0,
  },
  {
    key: 'reconcile-shift4', name: 'Shift4 check', utc: [0, 7],
    what: 'Checks which Shift4 locations still have OptiMenu installed and saves their time zones.',
    summary: (b) => `${b.installed ?? 0} installed · ${b.disconnected ?? 0} disconnected · ${len(b.unlinked)} not linked`,
    problems: (b) => (b.disconnected || 0) + len(b.unlinked),
    details: (b) => [...(b.disconnected ? [`${b.disconnected} connection(s) set to disconnected`] : []), ...lines(b.unlinked, (id) => `Shift4 location ${id} is not linked to a restaurant`)],
  },
  {
    key: 'sync-pos-menu', name: 'POS menus', utc: [45, 7],
    what: 'Pulls each Shift4 location’s menu and matches new POS items to dishes.',
    summary: (b) => `${len(b.success)} menus saved · ${len(b.failed)} failed`,
    problems: (b) => len(b.failed),
    details: (b) => lines(b.failed, (f) => `Location ${f.locationId}: ${f.error}`),
    restaurants: (b) => len(b.success) + len(b.failed),
  },
  {
    key: 'sync-all-pos', name: 'POS sales', utc: [0, 8],
    what: 'Pulls the last 3 days of sales and tickets from every connected POS.',
    summary: (b) => `${b.synced ?? 0} synced · ${b.failed ?? 0} failed`,
    problems: (b) => len(b.failed),
    details: (b) => lines(b.results?.failed, (f) => `${f.provider}, restaurant ${f.restaurantId}: ${f.error}`),
    restaurants: (b) => (b.synced || 0) + (b.failed || 0),
  },
  {
    key: 'snapshot-waste-risk', name: 'Inventory & waste', utc: [0, 9],
    what: 'Rebuilds each kitchen’s inventory after the sales sync and snapshots what is at risk of waste.',
    summary: (b) => `${len(b.success)} snapshots · ${len(b.skipped)} already done · ${len(b.failed) + len(b.inventoryFailed)} failed`,
    problems: (b) => len(b.failed) + len(b.inventoryFailed),
    details: (b) => [...lines(b.inventoryFailed, (f) => `Inventory, ${f.name}: ${f.error}`), ...lines(b.failed, (f) => `Snapshot, ${f.name}: ${f.error}`)],
    restaurants: (b) => len(b.success) + len(b.skipped) + len(b.failed),
  },
  {
    key: 'purge-deactivated-accounts', name: 'Account purge', utc: [0, 10], noRunNow: true,
    what: 'Permanently deletes restaurants deactivated more than 60 days ago.',
    summary: (b) => `${b.purged ?? 0} purged · ${len(b.failed)} failed`,
    problems: (b) => len(b.failed),
    details: (b) => [...lines(b.names, (n) => `Purged ${n}`), ...lines(b.failed, (f) => `${f.name || f.id}: ${f.error}`)],
  },
  {
    key: 'generate-recommendations', name: 'Tonight’s Dish', utc: [0, 11],
    what: 'Writes tonight’s dish tickets for every paying restaurant.',
    summary: (b) => `${len(b.success)} generated · ${len(b.skipped)} already had today · ${len(b.failed)} failed`,
    problems: (b) => len(b.failed),
    details: (b) => lines(b.failed, (f) => `${f.name}: ${f.error}`),
    restaurants: (b) => len(b.success) + len(b.skipped) + len(b.failed),
  },
];
export const JOB_BY_KEY = new Map(JOBS.map((j) => [j.key, j]));

// Opens an error_queue entry for a job, or bumps the open one.
export async function noteJobError(job, message, stack) {
  const feature = `${JOB_BY_KEY.get(job)?.name || job} job`;
  const fingerprint = `job:${job}`;
  const now = new Date().toISOString();
  const { data: open } = await db.from('error_queue').select('id, times')
    .eq('fingerprint', fingerprint).neq('status', 'resolved').order('created_at', { ascending: false }).limit(1);
  if (open?.[0]) {
    await db.from('error_queue').update({ times: (open[0].times || 1) + 1, last_seen_at: now, error_message: message, error_stack: stack || null }).eq('id', open[0].id);
  } else {
    await db.from('error_queue').insert({ feature, error_message: message, error_stack: stack || null, status: 'open', fingerprint, times: 1, last_seen_at: now });
  }
}

export function withJobRun(key, handler) {
  return async function jobRun(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return handler(req, res);

    const meta = JOB_BY_KEY.get(key);
    const started = new Date();
    let code = 200;
    let body;
    let thrown = null;
    const send = { status: res.status.bind(res), json: res.json.bind(res) };
    res.status = (c) => { code = c; return res; };
    res.json = (b) => { body = b; return res; };

    try {
      await handler(req, res);
    } catch (err) {
      thrown = err;
      code = 500;
      body = { error: err.message };
    }

    try {
      const b = body || {};
      const problems = meta && code < 400 ? meta.problems(b) : 0;
      const status = code >= 400 ? 'failed' : problems > 0 ? 'partial' : 'ok';
      const summary = code >= 400 ? (b.error || b.message || `Failed with status ${code}`) : meta ? meta.summary(b) : 'Done';
      const details = code < 400 && meta ? meta.details(b) : [];
      let result = b;
      if (JSON.stringify(b).length > 20000) result = { truncated: true, summary };
      await db.from('admin_job_runs').insert({
        job: key,
        trigger: req.query?.manual ? 'manual' : 'schedule',
        started_at: started.toISOString(),
        finished_at: new Date().toISOString(),
        ms: Date.now() - started.getTime(),
        http_status: code,
        status,
        summary,
        details,
        restaurants: meta?.restaurants && code < 400 ? meta.restaurants(b) : null,
        result,
      });
      if (status !== 'ok') {
        const name = meta?.name || key;
        await noteJobError(key, status === 'failed' ? `${name} failed: ${summary}` : `${name} ran with problems: ${summary}`, [...details, thrown?.stack].filter(Boolean).join('\n') || null);
      }
    } catch (err) {
      console.error(`[jobRun] Could not record ${key}:`, err.message);
    }

    res.status = send.status;
    res.json = send.json;
    if (body === undefined) return res.status(code).end();
    return res.status(code).json(body);
  };
}

// When a job's scheduled run happens on an Eastern date, as "3:00 AM".
export function etTimeOf([minute, hour], dateStr) {
  const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);
}
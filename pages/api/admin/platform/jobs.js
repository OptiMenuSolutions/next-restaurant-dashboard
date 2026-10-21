// pages/api/admin/platform/jobs.js
// Jobs & health.
//
// GET              -> the nightly chain (today's run of each job), the last
//                     14 nights per job, every recorded run, and the errors
// GET ?services=1  -> live check of each outside service (timed now)
// POST { action: 'run', job }           runs a job now (not the purge)
// POST { action: 'error', id, status }  open | investigating | resolved

import { adminDb as db, requireAdmin, etDate, addDays } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { JOBS, JOB_BY_KEY, etTimeOf } from '../../../../lib/admin/jobRun';
import stripe from '../../../../lib/stripeServer';
import shift4 from '../../../../lib/pos/providers/shift4';

const NIGHTS = 14;

async function load() {
  const today = etDate();
  const since = addDays(today, -40);
  const [runs, { data: errors }, { data: rest }] = await Promise.all([
    fetchAll(() => db.from('admin_job_runs').select('id, job, trigger, started_at, ms, status, summary, details, restaurants').gte('started_at', since).order('started_at', { ascending: false })),
    db.from('error_queue').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('restaurants').select('id, name'),
  ]);
  const names = new Map((rest || []).map((r) => [r.id, r.name]));
  const firstEver = runs.length ? etDate(new Date(runs[runs.length - 1].started_at)) : null;
  const nights = Array.from({ length: NIGHTS }, (_, i) => addDays(today, i - NIGHTS + 1));
  const now = Date.now();

  const jobs = JOBS.map((j) => {
    const mine = runs.filter((r) => r.job === j.key);
    const onDate = (d) => mine.find((r) => etDate(new Date(r.started_at)) === d && r.trigger === 'schedule') || mine.find((r) => etDate(new Date(r.started_at)) === d) || null;
    const due = (d) => Date.parse(`${d}T${String(j.utc[1]).padStart(2, '0')}:${String(j.utc[0]).padStart(2, '0')}:00Z`) + 30 * 60000;
    const stateOn = (d) => {
      const r = onDate(d);
      if (r) return r.status;
      if (!firstEver || d < firstEver) return 'none';
      return due(d) < now ? 'missed' : 'waiting';
    };
    const last = onDate(today);
    return {
      key: j.key, name: j.name, what: j.what, time: etTimeOf(j.utc, today), canRun: !j.noRunNow,
      today: { status: stateOn(today), summary: last?.summary || null, ms: last?.ms ?? null, details: last?.details || [], at: last?.started_at || null },
      nights: nights.map((d) => ({ date: d, status: stateOn(d) })),
      runs: mine.slice(0, 40).map((r) => ({ id: r.id, at: r.started_at, night: etDate(new Date(r.started_at)), trigger: r.trigger, ms: r.ms, status: r.status, summary: r.summary, details: r.details || [], restaurants: r.restaurants })),
    };
  });

  const errs = (errors || []).map((e) => ({
    id: e.id, feature: e.feature, message: e.error_message, stack: e.error_stack || null, status: e.status || 'open',
    restaurant_id: e.restaurant_id || null, restaurant: e.restaurant_id ? names.get(e.restaurant_id) || null : null,
    times: e.times || 1, first: e.created_at, last: e.last_seen_at || e.created_at,
  }));
  return { today, nights, tracking: !!firstEver, jobs, errors: errs };
}

async function timed(name, use, fn) {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('No answer in 6 seconds')), 6000))]);
    const ms = Date.now() - t0;
    return { name, use, status: ms > 2500 ? 'SLOW' : 'UP', ms, error: null };
  } catch (err) {
    return { name, use, status: err.message === 'not set' ? 'NOT SET' : 'DOWN', ms: Date.now() - t0, error: err.message === 'not set' ? 'The API key is not set in Vercel.' : err.message };
  }
}

async function getOk(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`);
}
const need = (v) => { if (!v) throw new Error('not set'); return v; };

async function services() {
  const env = process.env;
  return Promise.all([
    timed('Supabase', 'Database, logins and file storage', async () => {
      const { error } = await db.from('restaurants').select('id').limit(1);
      if (error) throw new Error(error.message);
    }),
    timed('Stripe', 'Subscriptions and payments', async () => { need(env.STRIPE_SECRET_KEY); await stripe.balance.retrieve(); }),
    timed('Anthropic (Claude)', 'Reading invoices and menus, Tonight’s Dish', () => getOk('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': need(env.ANTHROPIC_API_KEY), 'anthropic-version': '2023-06-01' })),
    timed('Mistral', 'Reading text off photos and PDFs', () => getOk('https://api.mistral.ai/v1/models', { Authorization: `Bearer ${need(env.MISTRAL_API_KEY)}` })),
    timed('Shift4', 'POS sales, tickets and menus', async () => { need(env.SHIFT4_CLIENT_ID); await shift4.listInstalledLocations(); }),
    timed('Resend', 'Alert emails and replies to owners', () => getOk('https://api.resend.com/domains', { Authorization: `Bearer ${need(env.RESEND_API_KEY)}` })),
  ]);
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      if (req.query.services) return res.status(200).json({ services: await services(), checkedAt: new Date().toISOString() });
      return res.status(200).json(await load());
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'run') {
      const job = JOB_BY_KEY.get(b.job);
      if (!job || job.noRunNow) return res.status(400).json({ error: 'That job cannot be run from here' });
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Ran ${job.name} by hand` });
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(`${proto}://${req.headers.host}/api/cron/${job.key}?manual=1`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: ctrl.signal });
        const json = await r.json().catch(() => ({}));
        return res.status(200).json({ ok: r.ok, finished: true, message: r.ok ? `${job.name} finished.` : `${job.name} failed: ${json.error || r.status}` });
      } catch (err) {
        if (err.name === 'AbortError') return res.status(200).json({ ok: true, finished: false, message: `${job.name} is running. It takes a while; reload in a minute or two to see the result.` });
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    if (b.action === 'error') {
      if (!['open', 'investigating', 'resolved'].includes(b.status)) return res.status(400).json({ error: 'Bad status' });
      const { error } = await db.from('error_queue').update({ status: b.status }).eq('id', b.id);
      if (error) throw new Error(error.message);
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Set error ${b.id} to ${b.status}` });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/platform/jobs]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}
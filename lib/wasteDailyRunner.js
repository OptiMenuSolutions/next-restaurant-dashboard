import { randomUUID } from 'node:crypto';
import { sendCronAlert } from './cronAlert.js';
import { readAllInventoryRows } from './currentInventory.js';
import { readWasteDailyInput } from './wasteDailyInput.js';
import { prepareWasteDailyInventory } from './wasteDailyInventory.js';
import { prepareWasteRiskAssessment } from './wasteRiskStorage.js';

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export async function dispatchWasteDailyAssessments(db, {
  elapsed = () => performance.now(),
  now = () => new Date().toISOString(),
  prepareInventory = prepareWasteDailyInventory,
  readInput = readWasteDailyInput,
  prepareAssessment = prepareWasteRiskAssessment,
  alert = sendCronAlert,
} = {}) {
  const start = elapsed();
  const canClaim = () => elapsed() - start < 200_000;
  const candidates = await readAllInventoryRows(() => db.from('projection_restaurant_config')
    .select('restaurant_id').eq('enabled', true).order('restaurant_id'), 'enabled projections');
  const counts = { completed: 0, skipped: 0, failed: 0, waiting: 0, retrying: 0, deferred: 0 };

  for (const [index, { restaurant_id: target }] of candidates.entries()) {
    if (!canClaim()) {
      counts.deferred = candidates.length - index;
      break;
    }

    let job;
    let stage = 'claim';
    const claim = day => rpc(db, 'waste_projection_daily_claim', { target, assessment_day: day });
    const args = () => ({ jid: job.id, tok: job.lease_token });
    const checkpoint = (evidence, failure = null) =>
      rpc(db, 'waste_projection_daily_checkpoint', { ...args(), evidence, failure });

    try {
      job = await claim(null);
      if (job.status === 'pending') {
        stage = 'inventory';
        const saved = await checkpoint(await prepareInventory(db, job));
        job = saved.status === 'ready' && canClaim() ? await claim(job.assessment_date) : saved;
      }

      if (job.status === 'ready' && job.lease_token) {
        if (!job.envelope) {
          stage = 'prepare';
          const input = await readInput(db, job, now());
          const envelope = await prepareAssessment(db, input, randomUUID());
          await rpc(db, 'waste_projection_daily_save', { ...args(), prepared: envelope });
        }
        stage = 'commit';
        job = await rpc(db, 'waste_projection_daily_commit', args());
      }

      if (job.status === 'disabled') continue;
      if (['completed', 'skipped', 'failed'].includes(job.status)) counts[job.status]++;
      else if (job.error) counts.retrying++;
      else counts.waiting++;
    } catch (error) {
      counts.retrying++;
      const failure = `${stage} | ${error.code || 'ERROR'} | ${error.message}`;
      console.error('[waste-daily]', target, job?.assessment_date, failure);
      if (job?.lease_token) {
        try {
          const saved = await checkpoint(null, failure);
          if (saved.status === 'skipped') {
            counts.retrying--;
            counts.skipped++;
          }
        } catch (checkpointError) {
          console.error('[waste-daily] Checkpoint failed:', target, checkpointError.message);
        }
      }
    }

    // This RPC reserves only a terminal alert, once per restaurant and date.
    try {
      const terminal = await rpc(db, 'waste_projection_daily_take_alert', { target });
      if (terminal) {
        await alert(
          'Daily waste assessment',
          `Assessment ${terminal.status} for restaurant ${target} on ${terminal.assessment_date}.`,
          [`Stage ${terminal.stage}`, terminal.reason]
        );
      }
    } catch (error) {
      console.error('[waste-daily] Terminal alert failed:', target, error.message);
    }
  }

  return counts;
}
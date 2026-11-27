async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export function scheduleWasteCorrectionSources(db, sources, schedule) {
  if (!sources.length) return;
  try {
    schedule(Promise.all(sources.map(async source => {
      try {
        await rpc(db, 'waste_projection_record_correction_source', source);
      } catch (error) {
        console.error('[waste-correction] Record failed:', source.target, error.message);
      }
    })));
  } catch (error) {
    console.error('[waste-correction] Schedule failed:', sources[0].target, error.message);
  }
}

export function sweepWasteCorrectionSources(db, restaurantId) {
  return rpc(db, 'waste_projection_sweep_correction_sources', { target: restaurantId });
}

export function readWasteDailyCorrectionSources(db, job) {
  return rpc(db, 'waste_projection_daily_correction_sources', { jid: job.id, tok: job.lease_token });
}
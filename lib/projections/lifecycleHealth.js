// Included in the existing service monitor, including its alert/recovery state.
export async function projectionMenuRepairStatus(db, at = new Date()) {
  const started = Date.now();
  const base = { name: 'Projection menu repairs', use: 'Menu lifecycle repairs older than 24 hours' };
  try {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('Invalid repair monitor time.');
    const cutoff = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const reply = await db.from('projection_menu_repairs').select('id', { count: 'exact', head: true })
      .lt('first_failure_at', cutoff).abortSignal(AbortSignal.timeout(6000));
    if (!reply || reply.error || !Number.isSafeInteger(reply.count) || reply.count < 0) {
      throw new Error(reply?.error?.message || 'Could not check projection menu repairs.');
    }
    return { ...base, status: reply.count ? 'DOWN' : 'UP', ms: Date.now() - started,
      error: reply.count ? `${reply.count} menu repair(s) older than 24 hours need attention. Unaffected categories continue forecasting.` : null };
  } catch (error) { return { ...base, status: 'DOWN', ms: Date.now() - started, error: error.message }; }
}
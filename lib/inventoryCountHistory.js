export async function inventoryCountHistory(
  db,
  restaurantId,
  throughDate,
  candidate = null
) {
  async function all(query) {
    const rows = [];

    for (let from = 0; ; ) {
      const { data, error } = await query().range(from, from + 499);

      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new Error('Could not read count history.');
      }
      if (!data.length) return rows;

      rows.push(...data);
      from += data.length;
    }
  }

  const sessions = await all(() =>
    db
      .from('inventory_count_sessions')
      .select('id,status,revision,effective_date,count_timing,submitted_at')
      .eq('restaurant_id', restaurantId)
      .in('status', ['submitted', 'draft'])
      .order('id')
  );

  const counts = [];

  for (const saved of sessions) {
    const submitting = saved.id === candidate?.session_id;

    if (!submitting && saved.status !== 'submitted') continue;

    if (
      submitting &&
      (
        saved.status !== 'draft' ||
        String(saved.revision) !== String(candidate.expected_revision)
      )
    ) {
      throw new Error(
        'The count changed. Reload its saved values and review again.'
      );
    }

    const session = submitting ? { ...saved, ...candidate } : saved;

    if (
      !session.effective_date ||
      session.effective_date > throughDate
    ) {
      continue;
    }

    const lines = await all(() =>
      db
        .from('inventory_count_lines')
        .select('id,ingredient_id,quantity,unit,ingredients(id,name,unit)')
        .eq('restaurant_id', restaurantId)
        .eq('session_id', saved.id)
        .not('quantity', 'is', null)
        .order('id')
    );

    for (const line of lines) {
      counts.push({
        ...line,
        effective_date: session.effective_date,
        count_timing: session.count_timing,
        submitted_at: session.submitted_at,
      });
    }
  }

  if (
    candidate &&
    !sessions.some((session) => session.id === candidate.session_id)
  ) {
    throw new Error('Count not found.');
  }

  return counts;
}
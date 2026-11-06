import { useEffect, useState } from 'react';

export default function InvoiceMatchRejections({
  api,
  refreshVersion = 0,
  onChanged,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError('');

    api('/api/admin/invoice-review/rejections')
      .then(result => {
        if (active) {
          setRows(result.rejections || []);
        }
      })
      .catch(err => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, refreshVersion]);

  async function reverse(row) {
    const reason = window.prompt(
      `Reverse rejection?\n\n` +
      `Restaurant: ${row.restaurant_name}\n` +
      `Supplier: ${row.supplier_key}\n` +
      `Product: ${row.product_key}\n` +
      `Rejected ingredient: ${row.ingredient_name}\n\n` +
      'Enter the reason for reversing this decision:'
    );

    if (reason === null) return;

    const explanation = reason.trim();

    if (
      explanation.length < 5 ||
      explanation.length > 2000
    ) {
      setError(
        'A reversal reason must contain 5–2000 characters.'
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove this specific rejection?\n\n` +
      `${row.restaurant_name}\n` +
      `${row.supplier_key}\n` +
      `${row.product_key}\n` +
      `${row.ingredient_name}\n\n` +
      `Reason: ${explanation}\n\n` +
      'This does not approve a future mapping.'
    );

    if (!confirmed) return;

    setBusyId(row.id);
    setError('');

    try {
      await api(
        '/api/admin/invoice-review/reverse-rejection',
        {
          restaurant_id: row.restaurant_id,
          supplier: row.supplier_key,
          product_description: row.product_key,
          ingredient_id: row.ingredient_id,
          reason: explanation,
        }
      );

      setRows(previous =>
        previous.filter(item => item.id !== row.id)
      );

      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      style={{
        marginTop: 20,
        padding: 18,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--shell)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text)',
        }}
      >
        Rejected relationships
      </div>

      <p
        style={{
          color: 'var(--muted)',
          fontSize: 12.5,
          marginTop: 6,
        }}
      >
        Relationships administrators have explicitly rejected.
        Removing a rejection does not approve the ingredient
        for future invoices.
      </p>

      {loading && (
        <p role="status">Loading rejections…</p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--red)',
            fontSize: 12.5,
          }}
        >
          {error}
        </p>
      )}

      {!loading && rows.length === 0 && (
        <p
          style={{
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          No active rejected relationships.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 10,
          }}
        >
          {rows.map(row => (
            <div
              key={row.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 9,
                padding: 13,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text)',
                  }}
                >
                  {row.product_key}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    marginTop: 4,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {row.restaurant_name}
                  {' · '}
                  {row.supplier_key}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    marginTop: 5,
                    color: 'var(--text)',
                  }}
                >
                  Rejected ingredient:{' '}
                  <strong>{row.ingredient_name}</strong>
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginTop: 4,
                  }}
                >
                  {new Date(row.created_at)
                    .toLocaleString()}
                </div>
              </div>

              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => reverse(row)}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '9px 13px',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: busyId ? 'wait' : 'pointer',
                }}
              >
                {busyId === row.id
                  ? 'Reversing…'
                  : 'Reverse rejection'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
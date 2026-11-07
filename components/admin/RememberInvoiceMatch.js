import { useState } from 'react';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

export default function RememberInvoiceMatch({
  invoice,
  line,
  ingredient,
  disabled = false,
}) {
  const { adminFetch } = useAdminFetch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!line?.ingredient_id || !ingredient || !invoice?.supplier) {
    return null;
  }

  async function request(action, payload) {
    const response = await adminFetch(
      '/api/admin/invoice-review/resolve-conflict',
      {
        method: 'POST',
        body: JSON.stringify({
          action,
          ...payload,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error || 'Approval could not be completed.'
      );
    }

    return result;
  }

  async function remember() {
    if (busy || disabled) return;

    setBusy(true);
    setMessage('');

    try {
      const payload = {
        restaurant_id: invoice.restaurant_id,
        supplier: invoice.supplier,
        product_description: line.item_name,

        // Prove this approval belongs to an existing invoice
        // line and its currently saved ingredient relationship.
        // Since the old and new IDs are identical, this does
        // not change the historical invoice.
        changes: [
          {
            invoice_item_id: line.id,
            expected_ingredient_id: line.ingredient_id,
            ingredient_id: line.ingredient_id,
          },
        ],

        approve_future: true,
        future_ingredient_id: line.ingredient_id,
        expected_mapping_updated_at: null,
      };

      const preview = await request('preview', payload);

      const existing = preview.future_mapping;

      if (
        existing?.existing_ingredient_id &&
        existing.existing_ingredient_id !== line.ingredient_id
      ) {
        setMessage(
          'A different future mapping already exists. ' +
          'Use the Match Conflicts review workflow.'
        );
        return;
      }

      if (
        existing?.existing_ingredient_id === line.ingredient_id
      ) {
        setMessage(
          'This supplier-product relationship is already approved.'
        );
        return;
      }

      const approved = window.confirm(
        'Approve future ingredient matching?\n\n' +
        `Supplier: ${invoice.supplier}\n` +
        `Product: ${line.item_name}\n` +
        `Ingredient: ${ingredient.name}\n\n` +
        'This approval applies to future invoices from ' +
        'this restaurant and supplier only.\n\n' +
        'Existing invoice relationships and ingredient ' +
        'prices will not be changed.'
      );

      if (!approved) return;

      const result = await request('save', {
        ...payload,
        expected_mapping_updated_at:
          preview.expected_mapping_updated_at ?? null,
        confirmation_token: preview.confirmation_token,
      });

      if (!result.saved) {
        throw new Error('Mapping approval was not confirmed.');
      }

      setMessage('Future supplier matching approved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={remember}
        disabled={busy || disabled}
        style={{
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '6px 9px',
          background: 'var(--panel)',
          color: 'var(--text)',
          fontSize: 11,
          fontWeight: 700,
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
          opacity: busy || disabled ? 0.5 : 1,
        }}
      >
        {busy ? 'Checking approval…' : 'Remember for future invoices'}
      </button>

      {message && (
        <div
          role="status"
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginTop: 5,
            maxWidth: 260,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
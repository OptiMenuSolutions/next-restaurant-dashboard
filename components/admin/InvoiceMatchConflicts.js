
import { useState } from 'react';

export default function InvoiceMatchConflicts({
  conflicts,
  loading,
  error,
}) {
  const [expanded, setExpanded] = useState({});

  const colors = {
    border: '#272b36',
    background: '#111318',
    secondary: '#858b9f',
    text: '#e4e6f0',
    warning: '#f5a623',
  };

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}>
        <div>
          <div style={{
            fontSize: 15,
            fontWeight: 700,
            color: colors.text,
          }}>
            Ingredient Match Conflicts
          </div>
          <div style={{
            fontSize: 11,
            color: colors.secondary,
            marginTop: 4,
          }}>
            Historical supplier products linked to different ingredients
          </div>
        </div>
        <span style={{
          color: colors.warning,
          fontSize: 12,
          fontWeight: 700,
        }}>
          {loading ? 'Loading…' : `${conflicts.length} conflicts`}
        </span>
      </div>

      {error && (
        <div style={{ color: '#e85454', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && conflicts.length === 0 && (
        <div style={{
          padding: 16,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          color: colors.secondary,
          fontSize: 12,
        }}>
          No historical ingredient-link conflicts found.
        </div>
      )}

      {conflicts.map(group => (
        <div key={group.key} style={{
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          marginBottom: 10,
          overflow: 'hidden',
        }}>
          <button
            type="button"
            onClick={() => setExpanded(prev => ({
              ...prev,
              [group.key]: !prev[group.key],
            }))}
            style={{
              width: '100%',
              background: 'transparent',
              border: 0,
              padding: 14,
              cursor: 'pointer',
              textAlign: 'left',
              color: colors.text,
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {group.product_description}
                </div>
                <div style={{
                  color: colors.secondary,
                  fontSize: 11,
                  marginTop: 4,
                }}>
                  {group.restaurant_name || group.restaurant_id}
                  {' · '}
                  {group.supplier}
                </div>
              </div>
              <div style={{
                color: colors.warning,
                fontSize: 11,
                textAlign: 'right',
              }}>
                {group.distinct_ingredient_count} different links
                <div style={{ color: colors.secondary, marginTop: 4 }}>
                  {group.purchase_count} purchases
                  {' '}
                  {expanded[group.key] ? '▲' : '▼'}
                </div>
              </div>
            </div>
          </button>

          {expanded[group.key] && (
            <div style={{
              padding: 14,
              borderTop: `1px solid ${colors.border}`,
            }}>
              <div style={{ marginBottom: 14 }}>
                {group.ingredients.map(ingredient => (
                  <div key={ingredient.ingredient_id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '5px 0',
                    fontSize: 12,
                    color: colors.text,
                  }}>
                    <span>{ingredient.ingredient_name || 'Unknown ingredient'}</span>
                    <span style={{ color: colors.secondary }}>
                      {ingredient.purchase_count} purchases
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 11,
                  color: colors.text,
                }}>
                  <thead>
                    <tr>
                      {['Date', 'Invoice', 'Supplier description', 'Linked ingredient'].map(label => (
                        <th key={label} style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          color: colors.secondary,
                          borderBottom: `1px solid ${colors.border}`,
                          whiteSpace: 'nowrap',
                        }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.purchases.map(purchase => (
                      <tr key={purchase.invoice_item_id}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {purchase.invoice_date || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {purchase.invoice_number || '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {purchase.product_description}
                        </td>
                        <td style={{
                          padding: '8px 10px',
                          color: purchase.ingredient_id
                            ? colors.text
                            : colors.warning,
                        }}>
                          {purchase.matched_ingredient || 'Unlinked'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{
                marginTop: 12,
                fontSize: 11,
                color: colors.secondary,
              }}>
                Read-only review. Mapping approvals and historical corrections
                will be enabled in a later step.
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

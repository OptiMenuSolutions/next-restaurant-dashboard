
import { useState } from 'react';

export default function InvoiceMatchConflicts({
  conflicts,
  ingredientsByRestaurant = {},
  onPreview,
  onSave,
  onSaved,
  loading,
  error,
}) {
  const [expanded, setExpanded] = useState({});
  const [proposedLinks, setProposedLinks] = useState({});
  const [manualOverrides, setManualOverrides] = useState({});
  const [automaticProposals, setAutomaticProposals] = useState({});
  const [selectedPurchases, setSelectedPurchases] = useState({});
  const [bulkIngredients, setBulkIngredients] = useState({});

    const [previews, setPreviews] = useState({});
  const [previewLoading, setPreviewLoading] = useState({});
  const [previewErrors, setPreviewErrors] = useState({});
  const [confirmedPreviews, setConfirmedPreviews] = useState({});
  const [saveLoading, setSaveLoading] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  
  const [futureMappings, setFutureMappings] = useState({});

  function updateFutureMapping(group, updates) {
    const groupKey = group.key;

    setConfirmedPreviews(previous => ({
      ...previous,
      [groupKey]: false,
    }));
    const current = futureMappings[groupKey] || {
      ingredientId: '',
      approved: false,
    };
    const next = { ...current, ...updates };

    setFutureMappings(previous => ({
      ...previous,
      [groupKey]: next,
    }));

    setProposedLinks(previous => {
      const updated = { ...previous };
      const nextAutomatic = { ...automaticProposals };

      for (const purchase of group.purchases) {
        const id = purchase.invoice_item_id;
        const currentId = purchase.ingredient_id || '';

        if (manualOverrides[id]) {
          delete nextAutomatic[id];
          continue;
        }

        if (next.approved && next.ingredientId) {
          if (currentId === next.ingredientId) {
            delete updated[id];
            delete nextAutomatic[id];
          } else {
            updated[id] = next.ingredientId;
            nextAutomatic[id] = true;
          }
        } else if (nextAutomatic[id]) {
          delete updated[id];
          delete nextAutomatic[id];
        }
      }

      setAutomaticProposals(nextAutomatic);
      return updated;
    });

    setPreviews(previous => ({
      ...previous,
      [groupKey]: null,
    }));

    setPreviewErrors(previous => ({
      ...previous,
      [groupKey]: null,
    }));
  }

  async function previewGroup(group) {
    setConfirmedPreviews(previous => ({
      ...previous,
      [group.key]: false,
    }));

    const changes = group.purchases
      .filter(purchase =>
        Object.prototype.hasOwnProperty.call(
          proposedLinks,
          purchase.invoice_item_id
        )
      )
      .map(purchase => ({
        invoice_item_id: purchase.invoice_item_id,
        expected_ingredient_id: purchase.ingredient_id || null,
        ingredient_id: proposedLinks[purchase.invoice_item_id] || null,
      }));

    const futureMapping = futureMappings[group.key];
    const approveFuture = Boolean(
      futureMapping?.approved && futureMapping?.ingredientId
    );

    if (!changes.length && !approveFuture) return;

    setPreviewLoading(previous => ({
      ...previous,
      [group.key]: true,
    }));

    setPreviewErrors(previous => ({
      ...previous,
      [group.key]: null,
    }));

    setPreviews(previous => ({
      ...previous,
      [group.key]: null,
    }));

    try {
      const request = {
        restaurant_id: group.restaurant_id,
        product_description: group.product_description,
        changes,
        approve_future: approveFuture,
        future_ingredient_id: approveFuture
          ? futureMapping.ingredientId
          : null,
      };

      const result = await onPreview(request);

      setPreviews(previous => ({
        ...previous,
        [group.key]: {
          ...result,
          confirmedRequest: {
            ...request,
            expected_mapping_updated_at:
              result.expected_mapping_updated_at ?? null,
          },
        },
      }));

    } catch (err) {
      setPreviewErrors(previous => ({
        ...previous,
        [group.key]: err.message,
      }));
    } finally {
      setPreviewLoading(previous => ({
        ...previous,
        [group.key]: false,
      }));
    }
  }

  async function saveGroup(group) {
    const preview = previews[group.key];

    if (
      !confirmedPreviews[group.key] ||
      !preview?.confirmation_token ||
      !preview?.confirmedRequest ||
      !onSave
    ) {
      return;
    }

    setSaveLoading(previous => ({
      ...previous,
      [group.key]: true,
    }));

    setSaveErrors(previous => ({
      ...previous,
      [group.key]: null,
    }));

    try {
      await onSave({
        ...preview.confirmedRequest,
        confirmation_token: preview.confirmation_token,
      });

      setPreviews(previous => ({
        ...previous,
        [group.key]: null,
      }));

      setConfirmedPreviews(previous => ({
        ...previous,
        [group.key]: false,
      }));

      if (onSaved) {
        await onSaved();
      }
    } catch (error) {
      setSaveErrors(previous => ({
        ...previous,
        [group.key]: error.message || 'Unable to save changes.',
      }));
    } finally {
      setSaveLoading(previous => ({
        ...previous,
        [group.key]: false,
      }));
    }
  }

  function togglePurchase(groupKey, purchaseId, checked) {
    setSelectedPurchases(previous => {
      const next = { ...previous };
      const selected = new Set(previous[groupKey] || []);

      if (checked) {
        selected.add(purchaseId);
      } else {
        selected.delete(purchaseId);
      }

      next[groupKey] = [...selected];
      return next;
    });
  }

  function toggleAllPurchases(group, checked) {
    setSelectedPurchases(previous => ({
      ...previous,
      [group.key]: checked
        ? group.purchases.map(purchase => purchase.invoice_item_id)
        : [],
    }));
  }

  function applyBulkIngredient(group) {
    const ingredientId = bulkIngredients[group.key];

    setConfirmedPreviews(previous => ({
      ...previous,
      [group.key]: false,
    }));

    if (ingredientId === undefined) return;

    setPreviews(previous => ({
      ...previous,
      [group.key]: null,
    }));

    setPreviewErrors(previous => ({
      ...previous,
      [group.key]: null,
    }));

    const selected = new Set(selectedPurchases[group.key] || []);

    setManualOverrides(previous => {
      const next = { ...previous };
      for (const id of selected) {
        next[id] = true;
      }
      return next;
    });

    setAutomaticProposals(previous => {
      const next = { ...previous };
      for (const id of selected) {
        delete next[id];
      }
      return next;
    });

    setProposedLinks(previous => {
      const next = { ...previous };

      for (const purchase of group.purchases) {
        if (!selected.has(purchase.invoice_item_id)) continue;

        if (ingredientId === (purchase.ingredient_id || '')) {
          delete next[purchase.invoice_item_id];
        } else {
          next[purchase.invoice_item_id] = ingredientId;
        }
      }

      return next;
    });

    setSelectedPurchases(previous => ({
      ...previous,
      [group.key]: [],
    }));
  }

  function setProposedIngredient(groupKey, purchase, ingredientId) {
    setConfirmedPreviews(previous => ({
      ...previous,
      [groupKey]: false,
    }));
    setManualOverrides(previous => ({
      ...previous,
      [purchase.invoice_item_id]: true,
    }));

    setAutomaticProposals(previous => {
      const next = { ...previous };
      delete next[purchase.invoice_item_id];
      return next;
    });

    setPreviews(previous => ({
      ...previous,
      [groupKey]: null,
    }));

    setPreviewErrors(previous => ({
      ...previous,
      [groupKey]: null,
    }));

    setProposedLinks(previous => {
      const next = { ...previous };

      if (ingredientId === (purchase.ingredient_id || '')) {
        delete next[purchase.invoice_item_id];
      } else {
        next[purchase.invoice_item_id] = ingredientId;
      }

      return next;
    });
  }

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
                  {(group.suppliers || []).length} supplier(s)
                  {' · '}
                  {(group.suppliers || []).join(', ')}
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

                            <div style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 12,
              }}>
                <span style={{
                  color: colors.secondary,
                  fontSize: 12,
                }}>
                  {(selectedPurchases[group.key] || []).length} selected
                </span>

                <select
                  aria-label={`Bulk ingredient for ${group.product_description}`}
                  value={bulkIngredients[group.key] ?? ''}
                  onChange={event =>
                    setBulkIngredients(previous => ({
                      ...previous,
                      [group.key]: event.target.value,
                    }))
                  }
                  style={{
                    minHeight: 34,
                    minWidth: 200,
                    padding: '6px 8px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    background: colors.background,
                    color: colors.text,
                  }}
                >
                  <option value="" disabled>
                    Choose ingredient for selected purchases
                  </option>
                  {(ingredientsByRestaurant[group.restaurant_id] || [])
                    .map(ingredient => (
                      <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.name}
                      </option>
                    ))}
                </select>

                <button
                  type="button"
                  disabled={
                    !(selectedPurchases[group.key] || []).length ||
                    !bulkIngredients[group.key]
                  }
                  onClick={() => applyBulkIngredient(group)}
                  style={{
                    minHeight: 34,
                    padding: '6px 12px',
                    cursor: 'pointer',
                  }}
                >
                  Apply to selected
                </button>
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
                      <th style={{
                        padding: '8px 10px',
                        borderBottom: `1px solid ${colors.border}`,
                      }}>
                        <input
                          type="checkbox"
                          aria-label={`Select all purchases for ${group.product_description}`}
                          checked={
                            group.purchases.length > 0 &&
                            (selectedPurchases[group.key] || []).length === group.purchases.length
                          }
                          onChange={event =>
                            toggleAllPurchases(group, event.target.checked)
                          }
                        />
                      </th>
                      {['Date', 'Invoice', 'Supplier', 'Supplier description', 'Current ingredient', 'Proposed ingredient'].map(label => (
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
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="checkbox"
                            aria-label={`Select purchase ${purchase.invoice_number || purchase.invoice_item_id}`}
                            checked={(selectedPurchases[group.key] || [])
                              .includes(purchase.invoice_item_id)}
                            onChange={event =>
                              togglePurchase(
                                group.key,
                                purchase.invoice_item_id,
                                event.target.checked
                              )
                            }
                          />
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {purchase.invoice_date || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {purchase.invoice_number || '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {purchase.supplier || 'Unknown supplier'}
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
                        <td style={{ padding: '8px 10px', minWidth: 220 }}>
                          <select
                            aria-label={`Proposed ingredient for invoice ${purchase.invoice_number || purchase.invoice_item_id}`}
                            value={
                              Object.prototype.hasOwnProperty.call(
                                proposedLinks,
                                purchase.invoice_item_id
                              )
                                ? proposedLinks[purchase.invoice_item_id]
                                : purchase.ingredient_id || ''
                            }
                            onChange={event =>
                              setProposedIngredient(
                                group.key,
                                purchase,
                                event.target.value
                              )
                            }
                            style={{
                              width: '100%',
                              minHeight: 34,
                              padding: '6px 8px',
                              border: `1px solid ${
                                Object.prototype.hasOwnProperty.call(
                                  proposedLinks,
                                  purchase.invoice_item_id
                                )
                                  ? colors.warning
                                  : colors.border
                              }`,
                              borderRadius: 6,
                              background: colors.background,
                              color: colors.text,
                              fontSize: 12,
                            }}
                          >
                            <option value="">Unlinked</option>
                            {(ingredientsByRestaurant[group.restaurant_id] || [])
                              .map(ingredient => (
                                <option key={ingredient.id} value={ingredient.id}>
                                  {ingredient.name}
                                </option>
                              ))}
                          </select>
                          {Object.prototype.hasOwnProperty.call(
                            proposedLinks,
                            purchase.invoice_item_id
                          ) && (
                            <div style={{
                              marginTop: 5,
                              color: colors.warning,
                              fontSize: 11,
                            }}>
                              Unsaved proposed change
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div style={{
                marginTop: 18,
                padding: 14,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
              }}>
                <div style={{
                  color: colors.text,
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 6,
                }}>
                  Remember this supplier product for future invoices
                </div>

                <div style={{
                  color: colors.secondary,
                  fontSize: 12,
                  marginBottom: 12,
                }}>
                  {group.supplier} → {group.product_description}
                </div>

                <select
                  aria-label={`Future ingredient for ${group.product_description}`}
                  value={futureMappings[group.key]?.ingredientId || ''}
                  onChange={event =>
                    updateFutureMapping(group, {
                      ingredientId: event.target.value,
                      approved: false,
                    })
                  }
                  style={{
                    width: '100%',
                    maxWidth: 420,
                    minHeight: 36,
                    padding: '7px 10px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    background: colors.background,
                    color: colors.text,
                  }}
                >
                  <option value="">Choose future ingredient</option>
                  {(ingredientsByRestaurant[group.restaurant_id] || [])
                    .map(ingredient => (
                      <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.name}
                      </option>
                    ))}
                </select>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  marginTop: 12,
                  color: colors.text,
                  fontSize: 12,
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    disabled={!futureMappings[group.key]?.ingredientId}
                    checked={Boolean(futureMappings[group.key]?.approved)}
                    onChange={event =>
                      updateFutureMapping(group, {
                        approved: event.target.checked,
                      })
                    }
                  />
                  Approve this ingredient for future invoices
                </label>

                <div style={{
                  marginTop: 10,
                  color: colors.secondary,
                  fontSize: 11,
                }}>
                  This selection does not change historical invoice links.
                  Approval is not saved until you explicitly confirm it.
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  disabled={
                    !onPreview ||
                    previewLoading[group.key] ||
                    (
                      !group.purchases.some(purchase =>
                        Object.prototype.hasOwnProperty.call(
                          proposedLinks,
                          purchase.invoice_item_id
                        )
                      ) &&
                      !(
                        futureMappings[group.key]?.approved &&
                        futureMappings[group.key]?.ingredientId
                      )
                    )
                  }
                  onClick={() => previewGroup(group)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 6,
                    border: '1px solid #02a4ba',
                    background: '#02a4ba',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {previewLoading[group.key]
                    ? 'Previewing...'
                    : 'Preview changes'}
                </button>

                {previewErrors[group.key] && (
                  <p style={{ color: '#e85454', fontSize: 12 }}>
                    {previewErrors[group.key]}
                  </p>
                )}

                {previews[group.key] && (
                  <div style={{
                    marginTop: 14,
                    padding: 14,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    color: colors.text,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                      Resolution preview — not saved
                    </div>

                    <div style={{ fontSize: 12, marginBottom: 12 }}>
                      {previews[group.key].summary.changed} changes
                      {' · '}
                      {previews[group.key].summary.newly_linked} newly linked
                      {' · '}
                      {previews[group.key].summary.unchanged} unchanged
                    </div>

                                        {previews[group.key].future_mapping?.approve && (
                      <div style={{
                        padding: '10px 0',
                        marginBottom: 10,
                        borderTop: `1px solid ${colors.border}`,
                        fontSize: 12,
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 5 }}>
                          Future supplier-product mapping
                        </div>
                        <div>
                          {group.supplier}
                          {' → '}
                          {group.product_description}
                          {' → '}
                          {previews[group.key].future_mapping.ingredient_name}
                        </div>
                        <div style={{
                          marginTop: 5,
                          color: colors.secondary,
                          fontSize: 11,
                        }}>
                          {previews[group.key].summary.future_mapping_would_change
                            ? 'New or updated mapping will be approved.'
                            : 'This mapping is already approved.'}
                        </div>
                        <div style={{
                          marginTop: 5,
                          color: colors.secondary,
                          fontSize: 11,
                        }}>
                          Historical invoice links will not be changed by this approval.
                        </div>
                      </div>
                    )}

                    {previews[group.key].changes.map(change => (
                      <div
                        key={change.invoice_item_id}
                        style={{
                          padding: '8px 0',
                          borderTop: `1px solid ${colors.border}`,
                          fontSize: 12,
                        }}
                      >
                        <strong>
                          {change.invoice_number || 'Invoice without number'}
                        </strong>
                        {' · '}
                        {change.invoice_date || 'No date'}
                        <div style={{ marginTop: 4 }}>
                          {group.purchases.find(purchase =>
                            purchase.invoice_item_id === change.invoice_item_id
                          )?.matched_ingredient || 'Unlinked'}
                          {' → '}
                          {change.new_ingredient_name || 'Unlinked'}
                        </div>
                      </div>
                    ))}

                    <div style={{
                      marginTop: 12,
                      fontSize: 11,
                      color: colors.secondary,
                    }}>
                      Preview only. No invoice records have been changed.
                    </div>

                    <div style={{
                      marginTop: 16,
                      paddingTop: 14,
                      borderTop: `1px solid ${colors.border}`,
                    }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        color: colors.text,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={Boolean(confirmedPreviews[group.key])}
                          onChange={event =>
                            setConfirmedPreviews(previous => ({
                              ...previous,
                              [group.key]: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          I have reviewed the historical corrections and
                          future ingredient mapping shown above, and confirm
                          that these are the changes I want to save.
                        </span>
                      </label>

                      <button
                        type="button"
                        disabled={
                          !confirmedPreviews[group.key] ||
                          !previews[group.key]?.confirmation_token ||
                          saveLoading[group.key] ||
                          previewLoading[group.key]
                        }
                        onClick={() => saveGroup(group)}
                        style={{
                          marginTop: 14,
                          padding: '10px 18px',
                          borderRadius: 6,
                          border: '1px solid #02a4ba',
                          background: confirmedPreviews[group.key]
                            ? '#02a4ba'
                            : '#272b36',
                          color: '#ffffff',
                          fontWeight: 700,
                          opacity: 0.55,
                          cursor: 'not-allowed',
                        }}
                      >
                        {saveLoading[group.key]
                          ? 'Saving changes...'
                          : 'Confirm and save changes'}
                      </button>
                      
                      {saveErrors[group.key] && (
                        <div style={{
                          marginTop: 8,
                          color: '#e85454',
                          fontSize: 12,
                        }}>
                          {saveErrors[group.key]}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

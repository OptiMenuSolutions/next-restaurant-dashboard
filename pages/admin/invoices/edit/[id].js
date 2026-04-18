// pages/admin/invoices/edit/[id].js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../../components/AdminLayout';
import supabase from '../../../../lib/supabaseClient';
import { standardizeInvoiceItem, calculateStandardizedCost, validateUnit } from '../../../../lib/standardizedUnits';
import {
  IconPlus,
  IconTrash,
  IconSearch,
  IconDeviceFloppy,
  IconFileText,
  IconExternalLink,
  IconEdit,
  IconAlertTriangle,
  IconX,
} from '@tabler/icons-react';

export default function InvoiceEditor() {
  const router = useRouter();
  const { id } = router.query;

  const [invoice, setInvoice]     = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  const [invoiceDetails, setInvoiceDetails] = useState({
    number: '', date: '', supplier: '', amount: '',
  });

  const [invoiceItems, setInvoiceItems]       = useState([]);
  const [ingredients, setIngredients]         = useState([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(null);
  const [filteredIngredients, setFilteredIngredients] = useState([]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      if (id) fetchInvoiceData();
    };
    checkUser();
  }, [id, router]);

  async function fetchInvoiceData() {
    try {
      const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', id).single();
      if (invErr) throw invErr;
      setInvoice(inv);

      const { data: rest } = await supabase.from('restaurants').select('*').eq('id', inv.restaurant_id).single();
      setRestaurant(rest);

      setInvoiceDetails({
        number:   inv.number   || '',
        date:     inv.date     || '',
        supplier: inv.supplier || '',
        amount:   inv.amount   || '',
      });

      const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', id);
      setInvoiceItems(items || []);

      const { data: ings } = await supabase.from('ingredients').select('*').eq('restaurant_id', inv.restaurant_id).order('name');
      setIngredients(ings || []);
    } catch (err) {
      alert('Failed to load invoice: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDetailsChange(e) {
    const { name, value } = e.target;
    setInvoiceDetails(prev => ({ ...prev, [name]: value }));
  }

  function addItem() {
    setInvoiceItems(prev => [...prev, {
      id: Date.now(), item_name: '', quantity: '', unit: '',
      amount: '', unit_cost: 0, ingredient_id: null, ingredient_search: '', isNew: true,
    }]);
  }

  function removeItem(index) {
    setInvoiceItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleItemChange(index, field, value) {
    setInvoiceItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'amount' || field === 'quantity') {
        const amt = parseFloat(updated[index].amount) || 0;
        const qty = parseFloat(updated[index].quantity) || 0;
        updated[index].unit_cost = qty > 0 ? amt / qty : 0;
      }
      return updated;
    });
  }

  function handleIngredientSearch(index, term) {
    handleItemChange(index, 'ingredient_search', term);
    setActiveSearchIndex(index);
    if (term.length > 1) {
      setFilteredIngredients(ingredients.filter(i => i.name.toLowerCase().includes(term.toLowerCase())));
    } else {
      setFilteredIngredients([]);
      setActiveSearchIndex(null);
    }
  }

  function selectIngredient(index, ingredient) {
    handleItemChange(index, 'ingredient_id', ingredient.id);
    handleItemChange(index, 'ingredient_search', ingredient.name);
    setFilteredIngredients([]);
    setActiveSearchIndex(null);
  }

  async function handleSubmit() {
    if (!invoiceDetails.number || !invoiceDetails.date || !invoiceDetails.supplier || !invoiceDetails.amount) {
      alert('Please fill in all invoice details');
      return;
    }
    if (invoiceItems.length === 0) {
      alert('Please add at least one invoice item');
      return;
    }

    // Validate units
    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      if (!item.item_name || !item.unit || !item.quantity || !item.amount) {
        alert(`Please complete all fields for item ${i + 1}`);
        return;
      }
      const v = validateUnit(item.unit);
      if (!v.valid) { alert(`Invalid unit "${item.unit}" for item "${item.item_name}". ${v.message}`); return; }
    }

    try {
      setSaving(true);

      await supabase.from('invoices').update({
        number:   invoiceDetails.number,
        date:     invoiceDetails.date,
        supplier: invoiceDetails.supplier,
        amount:   parseFloat(invoiceDetails.amount),
      }).eq('id', id);

      await supabase.from('invoice_items').delete().eq('invoice_id', id);

      await supabase.from('invoice_items').insert(
        invoiceItems.map(item => ({
          invoice_id:    id,
          item_name:     item.item_name || '',
          quantity:      parseFloat(item.quantity) || 0,
          unit:          item.unit || '',
          amount:        parseFloat(item.amount) || 0,
          unit_cost:     parseFloat(item.unit_cost) || 0,
          ingredient_id: item.ingredient_id || null,
        }))
      );

      router.push('/admin/pending-invoices');
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Shared input style ─────────────────────────────────────────────────
  const cellInput = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-body)',
    fontSize: '0.82rem',
    padding: '7px 10px',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s ease',
    boxSizing: 'border-box',
  };

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout pageTitle="Invoice Editor" pageDescription="Loading…" pageIcon={IconEdit}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading invoice…</p>
        </div>
      </AdminLayout>
    );
  }

  if (!invoice) {
    return (
      <AdminLayout pageTitle="Invoice Not Found" pageDescription="" pageIcon={IconFileText}>
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty-icon" style={{ background: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.2)', color: '#f43f5e' }}>
              <IconAlertTriangle size={22} />
            </div>
            <h3>Invoice not found</h3>
            <p>The requested invoice could not be found.</p>
            <button className="admin-btn admin-btn-ghost" style={{ marginTop: 8 }} onClick={() => router.push('/admin/pending-invoices')}>
              ← Back to Pending Invoices
            </button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const isPDF   = invoice.file_url?.toLowerCase().includes('.pdf');
  const isImage = !isPDF && invoice.file_url;

  return (
    <AdminLayout
      pageTitle={`Edit Invoice`}
      pageDescription={restaurant?.name || ''}
      pageIcon={IconEdit}
    >
      {/* ── Top action bar ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <>
              <div style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Saving…
            </>
          ) : (
            <><IconDeviceFloppy size={16} /> Save Invoice</>
          )}
        </button>
      </div>

      {/* ── Two-pane layout: form left, file right ────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>

        {/* ── Left: form ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Invoice details */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Invoice Details</h2>
            </div>
            <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { id: 'number',   label: 'Invoice Number', type: 'text',   placeholder: 'INV-001' },
                { id: 'date',     label: 'Invoice Date',   type: 'date',   placeholder: '' },
                { id: 'supplier', label: 'Supplier',       type: 'text',   placeholder: 'Supplier name' },
                { id: 'amount',   label: 'Total Amount',   type: 'number', placeholder: '0.00', step: '0.01' },
              ].map(field => (
                <div key={field.id}>
                  <label className="admin-label">{field.label}</label>
                  <input
                    className="admin-input"
                    id={field.id}
                    name={field.id}
                    type={field.type}
                    step={field.step}
                    placeholder={field.placeholder}
                    value={invoiceDetails[field.id]}
                    onChange={handleDetailsChange}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Invoice items */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Invoice Items</h2>
              <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={addItem}>
                <IconPlus size={14} /> Add Item
              </button>
            </div>

            {invoiceItems.length === 0 ? (
              <div className="admin-empty">
                <div className="admin-empty-icon"><IconFileText size={22} /></div>
                <h3>No items yet</h3>
                <p>Click "Add Item" to start entering line items from the invoice.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Item Name', 'Qty', 'Unit', 'Amount ($)', 'Unit Cost', 'Ingredient', ''].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '10px 14px', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map((item, index) => (
                      <tr key={item.id || index} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {/* Item name */}
                        <td style={{ padding: '8px 14px', minWidth: 160 }}>
                          <input
                            style={cellInput}
                            placeholder="Item name"
                            value={item.item_name}
                            onChange={e => handleItemChange(index, 'item_name', e.target.value)}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                          />
                        </td>

                        {/* Qty */}
                        <td style={{ padding: '8px 8px', width: 80 }}>
                          <input
                            style={cellInput}
                            type="number"
                            step="0.01"
                            placeholder="0"
                            value={item.quantity}
                            onChange={e => handleItemChange(index, 'quantity', e.target.value)}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                          />
                        </td>

                        {/* Unit */}
                        <td style={{ padding: '8px 8px', width: 90 }}>
                          <input
                            style={cellInput}
                            placeholder="lbs"
                            value={item.unit}
                            onChange={e => handleItemChange(index, 'unit', e.target.value)}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                          />
                        </td>

                        {/* Amount */}
                        <td style={{ padding: '8px 8px', width: 100 }}>
                          <input
                            style={cellInput}
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={item.amount}
                            onChange={e => handleItemChange(index, 'amount', e.target.value)}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                          />
                        </td>

                        {/* Unit cost (read only) */}
                        <td style={{ padding: '8px 8px', width: 90 }}>
                          <div style={{
                            padding: '7px 10px', borderRadius: 6, fontSize: '0.82rem',
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            color: 'var(--text-muted)', fontFamily: 'var(--font-display)',
                          }}>
                            ${(item.unit_cost || 0).toFixed(3)}
                          </div>
                        </td>

                        {/* Ingredient search */}
                        <td style={{ padding: '8px 8px', minWidth: 160, position: 'relative' }}>
                          <div style={{ position: 'relative' }}>
                            <IconSearch size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                            <input
                              style={{ ...cellInput, paddingLeft: 26 }}
                              placeholder="Link ingredient…"
                              value={item.ingredient_search || ''}
                              onChange={e => handleIngredientSearch(index, e.target.value)}
                              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                              onBlur={e => e.target.style.borderColor = 'var(--border)'}
                            />
                            {filteredIngredients.length > 0 && activeSearchIndex === index && (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                borderRadius: 8, marginTop: 3, maxHeight: 160, overflowY: 'auto',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                              }}>
                                {filteredIngredients.map(ing => (
                                  <div
                                    key={ing.id}
                                    onClick={() => selectIngredient(index, ing)}
                                    style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s ease' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>{ing.name}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ing.unit} · ${ing.last_price?.toFixed(4) || '0.0000'}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Remove */}
                        <td style={{ padding: '8px 8px', width: 36 }}>
                          <button
                            onClick={() => removeItem(index)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, transition: 'all 0.15s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#f43f5e'; e.currentTarget.style.background = 'rgba(244,63,94,0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals row */}
                {invoiceItems.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 32,
                    padding: '12px 20px', borderTop: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {invoiceItems.length} item{invoiceItems.length !== 1 ? 's' : ''}
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginRight: 8 }}>Items Total</span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        ${invoiceItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: file viewer ─────────────────────────────────────── */}
        <div style={{ position: 'sticky', top: 88 }}>
          <div className="admin-card" style={{ overflow: 'hidden' }}>
            <div className="admin-card-header">
              <h2 className="admin-card-title">Uploaded Invoice</h2>
              {invoice.file_url && (
                <a
                  href={invoice.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                >
                  <IconExternalLink size={13} /> Open
                </a>
              )}
            </div>

            <div style={{ padding: invoice.file_url ? 0 : 24 }}>
              {!invoice.file_url ? (
                <div className="admin-empty" style={{ padding: '40px 24px' }}>
                  <div className="admin-empty-icon"><IconFileText size={20} /></div>
                  <h3>No file</h3>
                  <p>No invoice file was uploaded.</p>
                </div>
              ) : isPDF ? (
                <iframe
                  src={invoice.file_url}
                  title="Invoice PDF"
                  style={{ width: '100%', height: 560, border: 'none', display: 'block' }}
                />
              ) : (
                <img
                  src={invoice.file_url}
                  alt="Invoice"
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
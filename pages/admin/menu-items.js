// pages/admin/menu-items.js
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  calculateStandardizedCost,
  getUnitSuggestions,
  validateUnit,
  getStandardUnitForUnit,
  getUnitCategory,
} from '../../lib/standardizedUnits';
import {
  IconX,
  IconPlus,
  IconPencil,
  IconTrash,
  IconEye,
  IconCheck,
  IconBuilding,
  IconChevronLeft,
  IconSearch,
  IconCurrencyDollar,
  IconPercentage,
  IconRefresh,
  IconChevronRight,
} from '@tabler/icons-react';

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant selector (step 1)
// ─────────────────────────────────────────────────────────────────────────────
function RestaurantSelector({ restaurants, onSelect }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen]   = useState(null);
  const [confirm, setConfirm] = useState('');
  const [highlighted, setHighlighted] = useState(-1);

  function search(val) {
    setQuery(val);
    setChosen(null);
    setConfirm('');
    if (val.length > 0) {
      setResults(restaurants.filter(r => r.name.toLowerCase().includes(val.toLowerCase())));
      setHighlighted(0);
    } else {
      setResults([]);
      setHighlighted(-1);
    }
  }

  function pick(restaurant) {
    setChosen(restaurant);
    setQuery(restaurant.name);
    setResults([]);
    setHighlighted(-1);
    setConfirm('');
  }

  function handleKeyDown(e) {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && highlighted >= 0) { e.preventDefault(); pick(results[highlighted]); }
    if (e.key === 'Escape')    { setResults([]); setHighlighted(-1); }
  }

  const canConfirm = chosen && confirm.trim() === chosen.name;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
          Select a Restaurant
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Choose a restaurant to manage its menu items
        </p>
      </div>

      <div className="admin-card" style={{ padding: 24 }}>
        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <label className="admin-label">Search Restaurant</label>
          <div style={{ position: 'relative' }}>
            <IconSearch size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              className="admin-input"
              style={{ paddingLeft: 36 }}
              placeholder="Type to search…"
              value={query}
              onChange={e => search(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {results.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {results.map((r, i) => (
                  <div
                    key={r.id}
                    onClick={() => pick(r)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: '0.85rem',
                      background: i === highlighted ? 'var(--accent-dim)' : 'transparent',
                      color: i === highlighted ? 'var(--accent)' : 'var(--text-secondary)',
                      transition: 'all 0.1s ease',
                      borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}
                    onMouseEnter={() => setHighlighted(i)}
                  >
                    {r.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Confirmation */}
        {chosen && (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 8, marginBottom: 14,
              background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(2,164,186,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
                <IconBuilding size={15} />
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{chosen.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>Selected restaurant</div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="admin-label">Type the restaurant name to confirm</label>
              <input
                className="admin-input"
                placeholder={`Type "${chosen.name}" to confirm`}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>

            <button
              className="admin-btn admin-btn-primary"
              style={{ width: '100%', justifyContent: 'center', opacity: canConfirm ? 1 : 0.4 }}
              disabled={!canConfirm}
              onClick={() => canConfirm && onSelect(chosen)}
            >
              <IconCheck size={15} /> Confirm & Manage Menu
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component ingredient row
// ─────────────────────────────────────────────────────────────────────────────
function IngredientRow({ ingredient, componentIndex, ingredientIndex, allIngredients, onChange, onRemove }) {
  const [ingResults, setIngResults]   = useState([]);
  const [unitResults, setUnitResults] = useState([]);
  const [unitHighlight, setUnitHighlight] = useState(-1);

  function searchIngredient(val) {
    onChange('ingredient_search', val);
    onChange('ingredient_id', null);
    if (val.length > 1) setIngResults(allIngredients.filter(i => i.name.toLowerCase().includes(val.toLowerCase())));
    else setIngResults([]);
  }

  function pickIngredient(ing) {
    onChange('ingredient_id', ing.id);
    onChange('ingredient_search', ing.name);
    setIngResults([]);
  }

  function searchUnit(val) {
    onChange('unit', val);
    if (val.length > 0) {
      setUnitResults(getUnitSuggestions(val, 6));
      setUnitHighlight(0);
    } else { setUnitResults([]); setUnitHighlight(-1); }
  }

  function pickUnit(u) {
    onChange('unit', typeof u === 'string' ? u : u.unit);
    setUnitResults([]);
    setUnitHighlight(-1);
  }

  function handleUnitKey(e) {
    if (!unitResults.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setUnitHighlight(h => Math.min(h + 1, unitResults.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setUnitHighlight(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && unitHighlight >= 0) { e.preventDefault(); pickUnit(unitResults[unitHighlight]); }
    if (e.key === 'Escape') { setUnitResults([]); setUnitHighlight(-1); }
  }

  const baseInput = {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: '0.78rem',
    padding: '6px 10px', outline: 'none', width: '100%', transition: 'border-color 0.15s ease',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 90px 28px', gap: 6, alignItems: 'center' }}>
      {/* Ingredient search */}
      <div style={{ position: 'relative' }}>
        <input
          style={baseInput}
          placeholder="Ingredient name…"
          value={ingredient.ingredient_search || ''}
          onChange={e => searchIngredient(e.target.value)}
        />
        {ingResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, maxHeight: 140, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0,0,0,0.4)' }}>
            {ingResults.map(ing => (
              <div key={ing.id} onClick={() => pickIngredient(ing)} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{ing.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{ing.unit} · ${ing.last_price?.toFixed(2) || '0.00'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quantity */}
      <input
        style={baseInput}
        type="number"
        step="0.01"
        placeholder="Qty"
        value={ingredient.quantity || ''}
        onChange={e => onChange('quantity', e.target.value)}
      />

      {/* Unit */}
      <div style={{ position: 'relative' }}>
        <input
          style={baseInput}
          placeholder="Unit"
          value={ingredient.unit || ''}
          onChange={e => searchUnit(e.target.value)}
          onKeyDown={handleUnitKey}
        />
        {unitResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, maxHeight: 140, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0,0,0,0.4)' }}>
            {unitResults.map((u, i) => (
              <div key={u.unit} onClick={() => pickUnit(u)} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.75rem', background: i === unitHighlight ? 'var(--accent-dim)' : 'transparent', color: i === unitHighlight ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={() => setUnitHighlight(i)}
              >
                <div style={{ fontWeight: 500 }}>{u.unit}</div>
                <div style={{ fontSize: '0.68rem', opacity: 0.7 }}>{u.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Remove */}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
        onMouseEnter={e => { e.currentTarget.style.color = '#f43f5e'; e.currentTarget.style.background = 'rgba(244,63,94,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
      >
        <IconX size={13} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component card
// ─────────────────────────────────────────────────────────────────────────────
function ComponentCard({ component, index, allIngredients, onChange, onAddIngredient, onRemoveIngredient, onIngredientChange, onRemove }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Component {index + 1}
        </span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => e.currentTarget.style.color = '#f43f5e'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <IconTrash size={14} />
        </button>
      </div>

      {/* Name */}
      <input
        style={{
          background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 7,
          color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: '0.83rem',
          padding: '8px 12px', outline: 'none', width: '100%', marginBottom: 12,
          transition: 'border-color 0.15s ease',
        }}
        placeholder="Component name (e.g. Patty, Sauce, Bun)"
        value={component.name}
        onChange={e => onChange('name', e.target.value)}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />

      {/* Ingredients */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Ingredients
          </span>
          <button
            onClick={onAddIngredient}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.2)', borderRadius: 5, color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 600, padding: '3px 8px', cursor: 'pointer' }}
          >
            <IconPlus size={11} /> Add
          </button>
        </div>

        {!component.ingredients?.length ? (
          <div style={{ padding: '12px', borderRadius: 7, border: '1px dashed var(--border)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            No ingredients added
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 90px 28px', gap: 6 }}>
              {['Ingredient', 'Qty', 'Unit', ''].map((h, i) => (
                <div key={i} style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', paddingLeft: 2 }}>{h}</div>
              ))}
            </div>
            {component.ingredients.map((ing, ingIdx) => (
              <IngredientRow
                key={ing.id}
                ingredient={ing}
                componentIndex={index}
                ingredientIndex={ingIdx}
                allIngredients={allIngredients}
                onChange={(field, val) => onIngredientChange(ingIdx, field, val)}
                onRemove={() => onRemoveIngredient(ingIdx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function MenuItemsManagement() {
  const router = useRouter();
  const [restaurants, setRestaurants]     = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [menuItems, setMenuItems]         = useState([]);
  const [ingredients, setIngredients]     = useState([]);
  const [categories, setCategories]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showForm, setShowForm]           = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [saving, setSaving]               = useState(false);

  // Category autocomplete
  const [catQuery, setCatQuery]           = useState('');
  const [catResults, setCatResults]       = useState([]);
  const [catHighlight, setCatHighlight]   = useState(-1);
  const [creatingCat, setCreatingCat]     = useState(false);

  // Form
  const [formData, setFormData] = useState({ name: '', price: '', category_id: null });
  const [components, setComponents]       = useState([]);

  const fetchMenuItems = useCallback(async () => {
    if (!selectedRestaurant) return;
    const { data } = await supabase.from('menu_items').select('*, menu_item_components(id, name, cost), menu_categories(id, name)').eq('restaurant_id', selectedRestaurant.id).order('name');
    setMenuItems(data || []);
  }, [selectedRestaurant?.id]);

  const fetchIngredients = useCallback(async () => {
    if (!selectedRestaurant) return;
    const { data } = await supabase.from('ingredients').select('*').eq('restaurant_id', selectedRestaurant.id).order('name');
    setIngredients(data || []);
  }, [selectedRestaurant?.id]);

  const fetchCategories = useCallback(async () => {
    if (!selectedRestaurant) return;
    const { data } = await supabase.from('menu_categories').select('*').eq('restaurant_id', selectedRestaurant.id).order('name');
    setCategories(data || []);
  }, [selectedRestaurant?.id]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      const { data } = await supabase.from('restaurants').select('*').order('name');
      setRestaurants(data || []);
      setLoading(false);
    };
    checkUser();
  }, [router]);

  useEffect(() => {
    if (selectedRestaurant) { fetchMenuItems(); fetchIngredients(); fetchCategories(); }
  }, [selectedRestaurant, fetchMenuItems, fetchIngredients, fetchCategories]);

  // ── Category autocomplete ──────────────────────────────────────────────
  function searchCategory(val) {
    setCatQuery(val);
    setFormData(prev => ({ ...prev, category_id: null }));
    if (val.length > 0) {
      setCatResults(categories.filter(c => c.name.toLowerCase().includes(val.toLowerCase())));
      setCatHighlight(0);
    } else { setCatResults([]); setCatHighlight(-1); }
  }

  function pickCategory(cat) {
    setFormData(prev => ({ ...prev, category_id: cat.id }));
    setCatQuery(cat.name);
    setCatResults([]);
    setCatHighlight(-1);
  }

  async function handleCategoryKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCatHighlight(h => Math.min(h + 1, catResults.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCatHighlight(h => Math.max(h - 1, 0)); return; }
    if (e.key === 'Escape')    { setCatResults([]); setCatHighlight(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = catQuery.trim();
      if (!trimmed) return;
      if (catHighlight >= 0 && catResults[catHighlight]) { pickCategory(catResults[catHighlight]); return; }
      const existing = categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) { pickCategory(existing); return; }
      try {
        setCreatingCat(true);
        const { data: newCat, error } = await supabase.from('menu_categories').insert({ restaurant_id: selectedRestaurant.id, name: trimmed }).select().single();
        if (error) throw error;
        setCategories(prev => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
        pickCategory(newCat);
      } catch (err) { alert('Failed to create category: ' + err.message); }
      finally { setCreatingCat(false); }
    }
  }

  // ── Component management ───────────────────────────────────────────────
  function addComponent() {
    setComponents(prev => [...prev, { id: `c-${Date.now()}`, name: '', ingredients: [], isNew: true }]);
  }

  function removeComponent(i) {
    setComponents(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateComponent(i, field, val) {
    setComponents(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }

  function addIngredient(compIdx) {
    setComponents(prev => prev.map((c, i) => i === compIdx
      ? { ...c, ingredients: [...(c.ingredients || []), { id: `ing-${Date.now()}`, ingredient_id: null, ingredient_search: '', quantity: '', unit: '', isNew: true }] }
      : c
    ));
  }

  function removeIngredient(compIdx, ingIdx) {
    setComponents(prev => prev.map((c, i) => i === compIdx
      ? { ...c, ingredients: c.ingredients.filter((_, j) => j !== ingIdx) }
      : c
    ));
  }

  function updateIngredient(compIdx, ingIdx, field, val) {
    setComponents(prev => prev.map((c, i) => i === compIdx
      ? { ...c, ingredients: c.ingredients.map((ing, j) => j === ingIdx ? { ...ing, [field]: val } : ing) }
      : c
    ));
  }

  // ── Form open/close ────────────────────────────────────────────────────
  function startAdd() {
    setFormData({ name: '', price: '', category_id: null });
    setCatQuery('');
    setComponents([]);
    setEditingItem(null);
    setShowForm(true);
  }

  async function startEdit(item) {
    const selectedCat = categories.find(c => c.id === item.category_id);
    setFormData({ name: item.name, price: item.price.toString(), category_id: item.category_id || null });
    setCatQuery(selectedCat?.name || '');
    setEditingItem(item);
    setShowForm(true);

    const { data: existingComps } = await supabase.from('menu_item_components').select('*, component_ingredients(*, ingredients:ingredient_id(id, name, unit))').eq('menu_item_id', item.id);
    setComponents((existingComps || []).map(comp => ({
      id: comp.id, name: comp.name, isNew: false,
      ingredients: (comp.component_ingredients || []).map(ing => ({
        id: ing.id, ingredient_id: ing.ingredient_id,
        ingredient_search: ing.ingredients?.name || '',
        quantity: ing.quantity.toString(), unit: ing.unit || 'each', isNew: false,
      })),
    })));
  }

  function cancelForm() {
    setShowForm(false);
    setEditingItem(null);
    setComponents([]);
    setCatQuery('');
    setCatResults([]);
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!formData.name || !formData.price) { alert('Please fill in name and price'); return; }
    if (!components.length) { alert('Please add at least one component'); return; }

    setSaving(true);
    try {
      // Validate & auto-create ingredients
      for (const comp of components) {
        if (!comp.name) { alert('Please name all components'); return; }
        if (!comp.ingredients?.length) { alert(`Add ingredients to "${comp.name}"`); return; }
        for (const ing of comp.ingredients) {
          if (!ing.quantity || !ing.unit) { alert(`Complete all ingredient fields in "${comp.name}"`); return; }
          const v = validateUnit(ing.unit);
          if (!v.valid) { alert(`Invalid unit "${ing.unit}" — ${v.message}`); return; }
          if (!ing.ingredient_id && ing.ingredient_search) {
            const { data: existing } = await supabase.from('ingredients').select('id, name').eq('restaurant_id', selectedRestaurant.id).ilike('name', ing.ingredient_search.trim()).maybeSingle();
            if (existing) { ing.ingredient_id = existing.id; }
            else {
              const { data: created } = await supabase.from('ingredients').insert({ restaurant_id: selectedRestaurant.id, name: ing.ingredient_search.trim(), unit: getStandardUnitForUnit(ing.unit), last_price: 0 }).select().single();
              ing.ingredient_id = created.id;
              setIngredients(prev => [...prev, created]);
            }
          }
          if (!ing.ingredient_id) { alert(`Select or type an ingredient name in "${comp.name}"`); return; }
        }
      }

      let menuItemId;
      if (editingItem) {
        await supabase.from('menu_items').update({ name: formData.name, price: parseFloat(formData.price), category_id: formData.category_id || null }).eq('id', editingItem.id);
        await supabase.from('menu_item_components').delete().eq('menu_item_id', editingItem.id);
        menuItemId = editingItem.id;
      } else {
        const { data: newItem } = await supabase.from('menu_items').insert({ restaurant_id: selectedRestaurant.id, name: formData.name, price: parseFloat(formData.price), category_id: formData.category_id || null, cost: 0 }).select().single();
        menuItemId = newItem.id;
      }

      // Insert components + ingredients
      for (const comp of components) {
        const { data: newComp } = await supabase.from('menu_item_components').insert({ menu_item_id: menuItemId, name: comp.name, cost: 0 }).select().single();
        await supabase.from('component_ingredients').insert(
          comp.ingredients.map(ing => ({ component_id: newComp.id, ingredient_id: ing.ingredient_id, quantity: parseFloat(ing.quantity), unit: ing.unit }))
        );
        await calculateComponentCost(newComp.id);
      }
      await calculateMenuItemCost(menuItemId);

      cancelForm();
      fetchMenuItems();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function calculateComponentCost(componentId) {
    const { data: items } = await supabase.from('component_ingredients').select('quantity, unit, ingredients:ingredient_id(name, last_price, unit)').eq('component_id', componentId);
    let total = 0;
    (items || []).forEach(item => {
      if (item.ingredients?.last_price > 0) {
        try { total += calculateStandardizedCost(item.quantity, item.unit, item.ingredients.last_price, item.ingredients.name); }
        catch { total += item.quantity * item.ingredients.last_price; }
      }
    });
    await supabase.from('menu_item_components').update({ cost: total }).eq('id', componentId);
    return total;
  }

  async function calculateMenuItemCost(menuItemId) {
    const { data: comps } = await supabase.from('menu_item_components').select('cost').eq('menu_item_id', menuItemId);
    const total = (comps || []).reduce((s, c) => s + (c.cost || 0), 0);
    await supabase.from('menu_items').update({ cost: total }).eq('id', menuItemId);
  }

  async function deleteMenuItem(item) {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    await supabase.from('menu_items').delete().eq('id', item.id);
    fetchMenuItems();
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout pageTitle="Menu Items" pageDescription="Manage menu items and components" pageIcon={IconSearch}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Menu Items" pageDescription="Manage menu items and their components" pageIcon={IconSearch}>

      {/* ── Step 1: select restaurant ──────────────────────────────────── */}
      {!selectedRestaurant ? (
        <RestaurantSelector restaurants={restaurants} onSelect={setSelectedRestaurant} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Restaurant header bar ─────────────────────────────────── */}
          <div className="admin-card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <IconBuilding size={18} />
                </div>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{selectedRestaurant.name}</h2>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{menuItems.length} menu items</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="admin-btn admin-btn-ghost" onClick={() => { setSelectedRestaurant(null); setShowForm(false); }}>
                  <IconChevronLeft size={15} /> Change
                </button>
                <button className="admin-btn admin-btn-primary" onClick={startAdd}>
                  <IconPlus size={15} /> Add Item
                </button>
              </div>
            </div>
          </div>

          {/* ── Add / Edit form ───────────────────────────────────────── */}
          {showForm && (
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">{editingItem ? 'Edit Menu Item' : 'New Menu Item'}</h2>
                <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={cancelForm}>
                  <IconX size={14} /> Cancel
                </button>
              </div>

              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Basic info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <div>
                    <label className="admin-label">Item Name</label>
                    <input className="admin-input" placeholder="e.g. Caesar Salad" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="admin-label">Price ($)</label>
                    <input className="admin-input" type="number" step="0.01" placeholder="0.00" value={formData.price} onChange={e => setFormData(p => ({ ...p, price: e.target.value }))} />
                  </div>
                  <div>
                    <label className="admin-label">Category {creatingCat && <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Creating…</span>}</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="admin-input"
                        placeholder="Type to search or create…"
                        value={catQuery}
                        onChange={e => searchCategory(e.target.value)}
                        onKeyDown={handleCategoryKeyDown}
                      />
                      {(catResults.length > 0 || (catQuery && !categories.find(c => c.name.toLowerCase() === catQuery.toLowerCase()))) && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                          {catResults.map((c, i) => (
                            <div key={c.id} onClick={() => pickCategory(c)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.83rem', background: i === catHighlight ? 'var(--accent-dim)' : 'transparent', color: i === catHighlight ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                              onMouseEnter={() => setCatHighlight(i)}>
                              {c.name}
                            </div>
                          ))}
                          {catQuery && !categories.find(c => c.name.toLowerCase() === catQuery.toLowerCase()) && (
                            <div style={{ padding: '8px 12px', fontSize: '0.78rem', color: 'var(--accent)', borderTop: catResults.length ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <IconPlus size={12} /> Press Enter to create "{catQuery}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Components */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Components</h3>
                    <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={addComponent} style={{ color: 'var(--accent)' }}>
                      <IconPlus size={13} /> Add Component
                    </button>
                  </div>

                  {components.length === 0 ? (
                    <div style={{ padding: 24, borderRadius: 10, border: '1px dashed var(--border)', textAlign: 'center' }}>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', margin: '0 0 10px' }}>No components yet</p>
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={addComponent}>
                        <IconPlus size={13} /> Add First Component
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                      {components.map((comp, i) => (
                        <ComponentCard
                          key={comp.id}
                          component={comp}
                          index={i}
                          allIngredients={ingredients}
                          onChange={(field, val) => updateComponent(i, field, val)}
                          onAddIngredient={() => addIngredient(i)}
                          onRemoveIngredient={ingIdx => removeIngredient(i, ingIdx)}
                          onIngredientChange={(ingIdx, field, val) => updateIngredient(i, ingIdx, field, val)}
                          onRemove={() => removeComponent(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Save */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button className="admin-btn admin-btn-primary" onClick={handleSubmit} disabled={saving}>
                    {saving ? 'Saving…' : editingItem ? 'Update Item' : 'Save Item'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Menu Items table ──────────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Current Menu Items</h2>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={fetchMenuItems}>
                <IconRefresh size={13} />
              </button>
            </div>

            {menuItems.length === 0 ? (
              <div className="admin-empty">
                <div className="admin-empty-icon"><IconSearch size={22} /></div>
                <h3>No menu items yet</h3>
                <p>Add your first menu item to start tracking costs and margins.</p>
                <button className="admin-btn admin-btn-primary" style={{ marginTop: 8 }} onClick={startAdd}>
                  <IconPlus size={15} /> Add First Item
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Components</th>
                      <th>Price</th>
                      <th>Cost</th>
                      <th>Margin</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuItems.map(item => {
                      const margin = item.price > 0 ? ((item.price - item.cost) / item.price) * 100 : 0;
                      const marginColor = margin > 30 ? '#10b981' : margin > 15 ? '#f59e0b' : '#f43f5e';
                      const compCount = item.menu_item_components?.length || 0;
                      return (
                        <tr key={item.id}>
                          <td className="primary">
                            <div
                              style={{ cursor: 'pointer' }}
                              onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)}
                            >
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{item.name}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginTop: 1 }}>View breakdown →</div>
                            </div>
                          </td>
                          <td>
                            <span className="admin-badge neutral">
                              {item.menu_categories?.name || 'Uncategorized'}
                            </span>
                          </td>
                          <td>
                            <span className="admin-badge teal">{compCount} {compCount === 1 ? 'component' : 'components'}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <IconCurrencyDollar size={13} style={{ color: 'var(--text-muted)' }} />
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>${item.price.toFixed(2)}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <IconCurrencyDollar size={13} style={{ color: 'var(--text-muted)' }} />
                              <span>${item.cost.toFixed(2)}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <IconPercentage size={13} style={{ color: 'var(--text-muted)' }} />
                              <span style={{ fontWeight: 600, color: marginColor }}>{margin.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)} title="View breakdown">
                                <IconEye size={14} />
                              </button>
                              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => startEdit(item)} title="Edit" style={{ color: 'var(--accent)' }}>
                                <IconPencil size={14} />
                              </button>
                              <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => deleteMenuItem(item)} title="Delete">
                                <IconTrash size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
// pages/admin/prospective-clients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconUsers,
  IconCalendar,
  IconBuilding,
  IconSortAscending,
  IconSortDescending,
  IconMail,
  IconPhone,
  IconRefresh,
  IconPlus,
  IconEdit,
  IconTrash,
  IconUserPlus,
  IconClock,
  IconNotes,
  IconX,
  IconMapPin,
} from '@tabler/icons-react';
import { logActivity, ACTIVITY_TYPES } from '../../lib/activityLogger';

// ── Shared field component ────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="admin-label">{label}</label>
      {children}
    </div>
  );
}

// ── Modal backdrop ────────────────────────────────────────────────────────
function Modal({ onClose, children, width = 640 }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 14, width: '100%', maxWidth: width,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────
function ProspectModal({ prospect, onClose, onSave }) {
  const [formData, setFormData] = useState({
    restaurant_name:    prospect?.restaurant_name    || '',
    contact_name:       prospect?.contact_name       || '',
    phone_number:       prospect?.phone_number       || '',
    email:              prospect?.email              || '',
    street_address:     prospect?.street_address     || '',
    city:               prospect?.city               || '',
    state:              prospect?.state              || '',
    zipcode:            prospect?.zipcode            || '',
    last_contacted_date:prospect?.last_contacted_date|| '',
    notes:              prospect?.notes              || '',
  });
  const [saving, setSaving] = useState(false);
  const [notContacted, setNotContacted] = useState(!prospect?.last_contacted_date);

  const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

  function formatPhone(val) {
    const d = val.replace(/\D/g, '').slice(0, 10);
    if (d.length >= 6) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length >= 3) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    if (d.length > 0)  return `(${d}`;
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, last_contacted_date: notContacted ? null : formData.last_contacted_date || null };

      if (prospect) {
        const { error } = await supabase.from('prospective_clients').update(payload).eq('id', prospect.id);
        if (error) throw error;
        await logActivity({
          activityType: ACTIVITY_TYPES.PROSPECT_UPDATED,
          title: `Prospect "${payload.restaurant_name}" updated`,
          subtitle: `Contact: ${payload.contact_name || 'Not provided'}`,
          metadata: { prospect_id: prospect.id },
        });
      } else {
        const { data: newProspect, error } = await supabase.from('prospective_clients').insert([payload]).select().single();
        if (error) throw error;
        await logActivity({
          activityType: ACTIVITY_TYPES.PROSPECT_CREATED,
          title: `New prospect "${payload.restaurant_name}" added`,
          subtitle: `Contact: ${payload.contact_name || 'Not provided'} · ${payload.phone_number || 'No phone'}`,
          metadata: { prospect_id: newProspect.id },
        });
      }

      onSave();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { marginBottom: 0 };

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          {prospect ? 'Edit Prospect' : 'Add New Prospect'}
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <IconX size={18} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <Field label="Restaurant Name *">
            <input className="admin-input" required value={formData.restaurant_name} onChange={e => set('restaurant_name', e.target.value)} placeholder="e.g. The Rustic Table" style={inputStyle} />
          </Field>
          <Field label="Contact Name">
            <input className="admin-input" value={formData.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Owner / Manager" style={inputStyle} />
          </Field>
          <Field label="Phone Number">
            <input className="admin-input" type="tel" value={formData.phone_number} onChange={e => set('phone_number', formatPhone(e.target.value))} placeholder="(555) 123-4567" style={inputStyle} />
          </Field>
          <Field label="Email">
            <input className="admin-input" type="email" value={formData.email} onChange={e => set('email', e.target.value)} placeholder="owner@restaurant.com" style={inputStyle} />
          </Field>
        </div>

        {/* Address */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Address</p>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Street Address">
              <input className="admin-input" value={formData.street_address} onChange={e => set('street_address', e.target.value)} placeholder="123 Main Street" style={inputStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 12 }}>
              <Field label="City">
                <input className="admin-input" value={formData.city} onChange={e => set('city', e.target.value)} placeholder="New York" style={inputStyle} />
              </Field>
              <Field label="State">
                <input className="admin-input" value={formData.state} onChange={e => set('state', e.target.value)} placeholder="NY" style={inputStyle} />
              </Field>
              <Field label="ZIP">
                <input className="admin-input" value={formData.zipcode} onChange={e => set('zipcode', e.target.value)} placeholder="10001" style={inputStyle} />
              </Field>
            </div>
          </div>
        </div>

        {/* Last contacted */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Contact History</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
            <Field label="Last Contacted Date">
              <input
                className="admin-input"
                type="date"
                value={formData.last_contacted_date}
                onChange={e => { set('last_contacted_date', e.target.value); if (e.target.value) setNotContacted(false); }}
                disabled={notContacted}
                style={{ ...inputStyle, opacity: notContacted ? 0.4 : 1 }}
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 10, whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={notContacted}
                onChange={e => { setNotContacted(e.target.checked); if (e.target.checked) set('last_contacted_date', ''); }}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Not contacted yet</span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 24 }}>
          <Field label="Notes">
            <textarea
              className="admin-input"
              rows={3}
              value={formData.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any notes about this prospect…"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            />
          </Field>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : prospect ? 'Update Prospect' : 'Add Prospect'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── View modal ────────────────────────────────────────────────────────────
function ViewModal({ prospect, onClose, onEdit }) {
  const needsFollowUp = !prospect.last_contacted_date ||
    new Date(prospect.last_contacted_date) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const InfoRow = ({ icon: Icon, label, value }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <Icon size={15} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: '0.85rem', color: value ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: value ? 'normal' : 'italic' }}>
          {value || 'Not provided'}
        </div>
      </div>
    </div>
  );

  const address = [prospect.street_address, prospect.city && prospect.state ? `${prospect.city}, ${prospect.state}` : (prospect.city || prospect.state), prospect.zipcode].filter(Boolean).join('\n');

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
            <IconBuilding size={18} />
          </div>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {prospect.restaurant_name}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Prospective Client</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {needsFollowUp && <span className="admin-badge amber"><IconClock size={11} /> Follow-up</span>}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <IconX size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '8px 24px 24px' }}>
        <InfoRow icon={IconUsers}    label="Contact Name"    value={prospect.contact_name} />
        <InfoRow icon={IconPhone}    label="Phone"           value={prospect.phone_number} />
        <InfoRow icon={IconMail}     label="Email"           value={prospect.email} />
        <InfoRow icon={IconMapPin}   label="Address"         value={address || null} />
        <InfoRow icon={IconCalendar} label="Last Contacted"  value={
          prospect.last_contacted_date
            ? new Date(prospect.last_contacted_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
            : null
        } />
        {prospect.notes && <InfoRow icon={IconNotes} label="Notes" value={prospect.notes} />}

        {/* Timeline */}
        <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Timeline</p>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>Added: {new Date(prospect.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            {prospect.updated_at !== prospect.created_at && (
              <div>Updated: {new Date(prospect.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="admin-btn admin-btn-ghost" onClick={onClose}>Close</button>
        <button className="admin-btn admin-btn-primary" onClick={onEdit}>
          <IconEdit size={15} /> Edit Prospect
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function ProspectiveClientManagement() {
  const router = useRouter();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('restaurant_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProspect, setEditingProspect] = useState(null);
  const [viewingProspect, setViewingProspect] = useState(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchProspects();
    };
    checkUser();
  }, [router]);

  async function fetchProspects() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('prospective_clients').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setProspects(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this prospect?')) return;
    try {
      const prospect = prospects.find(p => p.id === id);
      const { error } = await supabase.from('prospective_clients').delete().eq('id', id);
      if (error) throw error;
      await logActivity({
        activityType: ACTIVITY_TYPES.PROSPECT_DELETED,
        title: `Prospect "${prospect?.restaurant_name}" removed`,
        subtitle: `Contact: ${prospect?.contact_name || 'Not provided'}`,
        metadata: { prospect_id: id },
      });
      setProspects(prev => prev.filter(p => p.id !== id));
    } catch (e) { alert('Failed to delete: ' + e.message); }
  }

  function handleSort(field) {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  }

  const thirtyDaysAgo   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const filteredAndSorted = prospects
    .filter(p =>
      p.restaurant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.contact_name   || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.email          || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.phone_number   || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.city           || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.state          || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (['last_contacted_date', 'created_at'].includes(sortField)) {
        av = av ? new Date(av) : new Date(0);
        bv = bv ? new Date(bv) : new Date(0);
        return sortDirection === 'asc' ? av - bv : bv - av;
      }
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
      return sortDirection === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

  const recentlyContacted = prospects.filter(p => p.last_contacted_date && new Date(p.last_contacted_date) > thirtyDaysAgo).length;
  const needsFollowUp     = prospects.filter(p => !p.last_contacted_date || new Date(p.last_contacted_date) < fourteenDaysAgo).length;

  const SortIcon = ({ field }) => sortField === field
    ? (sortDirection === 'asc' ? <IconSortAscending size={13} /> : <IconSortDescending size={13} />)
    : null;

  if (loading) {
    return (
      <AdminLayout pageTitle="Prospective Clients" pageDescription="Manage potential restaurant partners" pageIcon={IconUserPlus}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading prospects…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Prospective Clients" pageDescription="Manage potential restaurant partners and leads" pageIcon={IconUserPlus}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div className="admin-search-inline" style={{ flex: 1, minWidth: 220 }}>
          <IconSearch size={15} />
          <input
            placeholder="Search by name, contact, email, city…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <button className="admin-btn admin-btn-ghost" onClick={fetchProspects}>
          <IconRefresh size={15} /> Refresh
        </button>
        <button className="admin-btn admin-btn-ghost" onClick={() => router.push('/admin/clients')}>
          <IconUsers size={15} /> View Clients
        </button>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAddModal(true)}>
          <IconPlus size={15} /> Add Prospect
        </button>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-icon teal"><IconUserPlus size={20} /></div>
          <div>
            <div className="admin-stat-value">{prospects.length}</div>
            <div className="admin-stat-label">Total Prospects</div>
            <div className="admin-stat-sub">Potential partners</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon emerald"><IconClock size={20} /></div>
          <div>
            <div className="admin-stat-value">{recentlyContacted}</div>
            <div className="admin-stat-label">Recently Contacted</div>
            <div className="admin-stat-sub">Within 30 days</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon amber"><IconCalendar size={20} /></div>
          <div>
            <div className="admin-stat-value">{needsFollowUp}</div>
            <div className="admin-stat-label">Needs Follow-up</div>
            <div className="admin-stat-sub">14+ days since contact</div>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Prospective Clients</h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {filteredAndSorted.length} prospect{filteredAndSorted.length !== 1 ? 's' : ''}
          </span>
        </div>

        {filteredAndSorted.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon"><IconUserPlus size={22} /></div>
            <h3>{searchTerm ? 'No prospects found' : 'No prospective clients yet'}</h3>
            <p>
              {searchTerm
                ? `No prospects match "${searchTerm}"`
                : 'Start building your pipeline by adding potential restaurant partners.'
              }
            </p>
            {!searchTerm && (
              <button className="admin-btn admin-btn-primary" style={{ marginTop: 8 }} onClick={() => setShowAddModal(true)}>
                <IconPlus size={15} /> Add First Prospect
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('restaurant_name')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Restaurant <SortIcon field="restaurant_name" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('contact_name')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Contact <SortIcon field="contact_name" /></span>
                  </th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th className="sortable" onClick={() => handleSort('city')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Location <SortIcon field="city" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('last_contacted_date')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Last Contacted <SortIcon field="last_contacted_date" /></span>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map(prospect => {
                  const followUp = !prospect.last_contacted_date || new Date(prospect.last_contacted_date) < fourteenDaysAgo;
                  return (
                    <tr
                      key={prospect.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setViewingProspect(prospect)}
                    >
                      {/* Restaurant */}
                      <td className="primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                            background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
                          }}>
                            <IconBuilding size={14} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {prospect.restaurant_name}
                            </div>
                            {followUp && <span className="admin-badge amber" style={{ marginTop: 2 }}>Follow-up</span>}
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td>{prospect.contact_name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>}</td>

                      {/* Phone */}
                      <td>
                        {prospect.phone_number ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconPhone size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: '0.83rem' }}>{prospect.phone_number}</span>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>}
                      </td>

                      {/* Email */}
                      <td>
                        {prospect.email ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconMail size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: '0.83rem' }}>{prospect.email}</span>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>}
                      </td>

                      {/* Location */}
                      <td>
                        {prospect.city || prospect.state ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconMapPin size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: '0.83rem' }}>{[prospect.city, prospect.state].filter(Boolean).join(', ')}</span>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>}
                      </td>

                      {/* Last contacted */}
                      <td>
                        {prospect.last_contacted_date ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconCalendar size={13} style={{ color: 'var(--text-muted)' }} />
                            <span>{new Date(prospect.last_contacted_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>Never</span>}
                      </td>

                      {/* Actions */}
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => setEditingProspect(prospect)}
                            title="Edit"
                            style={{ color: 'var(--accent)' }}
                          >
                            <IconEdit size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn-danger admin-btn-sm"
                            onClick={() => handleDelete(prospect.id)}
                            title="Delete"
                          >
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

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {(showAddModal || editingProspect) && (
        <ProspectModal
          prospect={editingProspect}
          onClose={() => { setShowAddModal(false); setEditingProspect(null); }}
          onSave={fetchProspects}
        />
      )}
      {viewingProspect && (
        <ViewModal
          prospect={viewingProspect}
          onClose={() => setViewingProspect(null)}
          onEdit={() => { setEditingProspect(viewingProspect); setViewingProspect(null); }}
        />
      )}
    </AdminLayout>
  );
}
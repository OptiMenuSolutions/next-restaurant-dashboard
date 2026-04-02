// pages/client/profile.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import { restartTour } from '../../lib/useTour';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  input::placeholder { color: #3a3630 !important; }
  textarea::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .pr-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; min-height: 100vh; display: flex; flex-direction: column; }

  /* NAV */
  .pr-nav { background: #0f0e0c; border-bottom: 1px solid #2a2620; height: clamp(36px,4vh,52px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; position: sticky; top: 0; z-index: 10; }
  .pr-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: #e8e2d8; letter-spacing: -.3px; cursor: pointer; }
  .pr-logo span { color: #02a4ba; }
  .pr-back { display: flex; align-items: center; gap: 6px; font-size: clamp(11px,.85vw,14px); background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; color: #02a4ba; padding: 0; }
  .pr-nav-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.1vw,18px); color: #e8e2d8; }

  /* AVATAR HEADER */
  .pr-avatar-header { display: flex; align-items: center; gap: clamp(12px,1.2vw,18px); padding: clamp(16px,1.6vw,24px) clamp(14px,1.2vw,18px); background: #13120f; border: 1px solid #2a2620; border-radius: 10px; margin-bottom: clamp(12px,1.2vw,18px); }
  .pr-avatar-circle { width: clamp(48px,4.5vw,64px); height: clamp(48px,4.5vw,64px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(16px,1.4vw,22px); font-weight: 700; color: #0a0908; flex-shrink: 0; letter-spacing: -.5px; }
  .pr-avatar-name { font-size: clamp(15px,1.2vw,20px); font-weight: 600; color: #e8e2d8; line-height: 1.2; }
  .pr-avatar-email { font-size: clamp(11px,.82vw,13px); color: #4a453e; margin-top: 3px; }
  .pr-avatar-badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; font-size: clamp(9px,.68vw,11px); font-weight: 600; padding: 3px 9px; border-radius: 20px; background: rgba(2,164,186,.1); border: 1px solid rgba(2,164,186,.2); color: #02a4ba; text-transform: uppercase; letter-spacing: .5px; }
  .pr-avatar-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: #02a4ba; }

  /* PAGE BODY */
  .pr-body { flex: 1; padding: clamp(16px,2vw,32px) clamp(16px,2vw,32px); max-width: 640px; margin: 0 auto; width: 100%; }

  /* SECTIONS */
  .pr-section { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; overflow: hidden; margin-bottom: clamp(12px,1.2vw,18px); }
  .pr-section-title { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; padding: clamp(10px,1vw,14px) clamp(14px,1.2vw,18px); border-bottom: 1px solid #2a2620; }

  /* FIELDS */
  .pr-field { padding: clamp(11px,1.1vw,16px) clamp(14px,1.2vw,18px); border-bottom: 1px solid #1a1915; }
  .pr-field:last-child { border-bottom: none; }
  .pr-field-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .pr-field-lbl { font-size: clamp(9px,.68vw,11px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; }
  .pr-field-val { font-size: clamp(13px,1vw,15px); color: #e8e2d8; font-weight: 500; }
  .pr-field-val.accent { color: #02a4ba; }
  .pr-field-val.muted { color: #6b6358; font-style: italic; }
  .pr-field-hint { font-size: clamp(9px,.68vw,11px); color: #4a453e; margin-top: 4px; line-height: 1.45; }
  .pr-edit-btn { font-size: clamp(11px,.82vw,13px); color: #02a4ba; background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; padding: 0; transition: opacity .15s; }
  .pr-edit-btn:hover { opacity: .75; }

  /* INLINE EDIT */
  .pr-input { width: 100%; background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,11px) clamp(10px,.9vw,14px); font-size: clamp(13px,1vw,15px); color: #e8e2d8; outline: none; font-family: 'Inter', sans-serif; margin-top: 6px; transition: border-color .15s; }
  .pr-input:focus { border-color: #02a4ba; }
  .pr-input-row { display: flex; gap: 8px; margin-top: 6px; }
  .pr-input-row .pr-input { margin-top: 0; }
  .pr-save-btn { background: #02a4ba; border: none; border-radius: 7px; padding: clamp(8px,.8vw,11px) clamp(12px,1vw,18px); font-size: clamp(12px,.9vw,14px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; flex-shrink: 0; }
  .pr-save-btn:hover { background: #01bcd4; }
  .pr-save-btn:disabled { opacity: .5; cursor: not-allowed; }
  .pr-cancel-btn { background: none; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,11px) clamp(12px,1vw,18px); font-size: clamp(12px,.9vw,14px); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: all .15s; flex-shrink: 0; color: #4a453e; }
  .pr-cancel-btn:hover { color: #e8e2d8; border-color: #3a3630; }

  /* TOGGLE */
  .pr-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: clamp(11px,1.1vw,16px) clamp(14px,1.2vw,18px); border-bottom: 1px solid #1a1915; }
  .pr-toggle-row:last-child { border-bottom: none; }
  .pr-toggle-label { font-size: clamp(13px,1vw,15px); color: #e8e2d8; font-weight: 500; }
  .pr-toggle-sub { font-size: clamp(10px,.75vw,12px); color: #4a453e; margin-top: 3px; }
  .pr-toggle { width: 38px; height: 22px; border-radius: 11px; background: #2a2620; position: relative; cursor: pointer; transition: background .2s; flex-shrink: 0; border: none; outline: none; }
  .pr-toggle.on { background: #02a4ba; }
  .pr-toggle-thumb { width: 18px; height: 18px; border-radius: 50%; background: #e8e2d8; position: absolute; top: 2px; left: 2px; transition: left .2s; pointer-events: none; }
  .pr-toggle.on .pr-toggle-thumb { left: 18px; }
  .pr-toggle-saving { opacity: .5; pointer-events: none; }

  /* LINK ROWS */
  .pr-link-row { display: flex; align-items: center; justify-content: space-between; padding: clamp(12px,1.2vw,16px) clamp(14px,1.2vw,18px); border-bottom: 1px solid #1a1915; cursor: pointer; transition: background .15s; }
  .pr-link-row:last-child { border-bottom: none; }
  .pr-link-row:hover { background: #1a1915; }
  .pr-link-label { font-size: clamp(13px,1vw,15px); color: #e8e2d8; }
  .pr-link-sub { font-size: clamp(10px,.75vw,12px); color: #4a453e; margin-top: 2px; }
  .pr-link-arrow { font-size: 14px; color: #4a453e; flex-shrink: 0; }
  .pr-link-row.danger .pr-link-label { color: #c04040; }
  .pr-link-row.danger:hover { background: rgba(192,64,64,.05); }

  /* SIGN OUT */
  .pr-signout-btn { width: 100%; padding: clamp(11px,1.1vw,14px); border-radius: 8px; font-size: clamp(13px,1vw,15px); font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; background: none; color: #c04040; border: 1px solid rgba(192,64,64,.2); transition: all .15s; margin-bottom: clamp(12px,1.2vw,18px); }
  .pr-signout-btn:hover { background: rgba(192,64,64,.08); border-color: rgba(192,64,64,.4); }

  /* TABS */
  .pr-tabs { display: flex; background: #13120f; border-bottom: 1px solid #2a2620; padding: 0 clamp(16px,2vw,32px); margin-bottom: clamp(14px,1.4vw,20px); position: sticky; top: clamp(36px,4vh,52px); z-index: 5; overflow-x: auto; }
  .pr-tabs::-webkit-scrollbar { display: none; }
  .pr-tab { padding: clamp(10px,1vh,14px) clamp(12px,1.2vw,18px); font-size: clamp(11px,.85vw,14px); color: #4a453e; border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .15s; white-space: nowrap; flex-shrink: 0; }
  .pr-tab.active { color: #02a4ba; border-bottom-color: #02a4ba; }
  .pr-tab:hover:not(.active) { color: #9a9086; }

  /* CONFIRM MODAL */
  .pr-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .pr-modal { background: #13120f; border: 1px solid #2a2620; border-radius: 12px; padding: clamp(20px,2vw,28px); max-width: 400px; width: 100%; }
  .pr-modal-title { font-size: clamp(15px,1.2vw,18px); font-weight: 600; color: #e8e2d8; margin-bottom: 8px; }
  .pr-modal-body { font-size: clamp(12px,.9vw,14px); color: #6b6358; line-height: 1.55; margin-bottom: 20px; }
  .pr-modal-body strong { color: #c04040; }
  .pr-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .pr-modal-cancel { background: none; border: 1px solid #2a2620; border-radius: 7px; padding: 9px 16px; font-size: 13px; color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .pr-modal-cancel:hover { color: #e8e2d8; border-color: #3a3630; }
  .pr-modal-confirm { background: rgba(192,64,64,.15); border: 1px solid rgba(192,64,64,.3); border-radius: 7px; padding: 9px 16px; font-size: 13px; font-weight: 600; color: #c04040; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .pr-modal-confirm:hover { background: rgba(192,64,64,.25); }

  /* MOBILE BOTTOM NAV */
  .mob-bottom-nav { background: #0f0e0c; border-top: 1px solid #2a2620; padding: 8px 0; padding-bottom: max(8px, env(safe-area-inset-bottom)); display: flex; position: sticky; bottom: 0; }
  .mob-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; padding: 4px 0; -webkit-tap-highlight-color: transparent; }
  .mob-nav-icon svg { width: 20px; height: 20px; stroke: #4a453e; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-nav-label { font-size: 10px; color: #4a453e; }
`;

// ─── Toggle Component ─────────────────────────────────────────────────────────

function Toggle({ on, onChange, saving }) {
  return (
    <button
      className={`pr-toggle${on ? ' on' : ''}${saving ? ' pr-toggle-saving' : ''}`}
      onClick={() => !saving && onChange(!on)}
    >
      <div className="pr-toggle-thumb" />
    </button>
  );
}

// ─── Delete Account Modal ─────────────────────────────────────────────────────

function DeleteAccountModal({ onConfirm, onCancel }) {
  return (
    <div className="pr-modal-overlay" onClick={onCancel}>
      <div className="pr-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-modal-title">Delete Account</div>
        <div className="pr-modal-body">
          This will permanently delete your account, restaurant, all invoices, ingredients, and menu items. <strong>This cannot be undone.</strong>
          <br /><br />
          If you'd like to keep your data, export it first from the Data &amp; Privacy section.
        </div>
        <div className="pr-modal-actions">
          <button className="pr-modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="pr-modal-confirm" onClick={onConfirm}>Yes, Delete Everything</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const { tab: tabParam } = router.query;

  const [activeTab, setActiveTab] = useState('account');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [exporting, setExporting] = useState(false);

  // User data
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantId, setRestaurantId] = useState(null);
  const [targetFoodCost, setTargetFoodCost] = useState(30);

  // Edit states
  const [editingName, setEditingName] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState(false);
  const [editingFoodCost, setEditingFoodCost] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);

  // Temp edit values
  const [tempName, setTempName] = useState('');
  const [tempRestaurant, setTempRestaurant] = useState('');
  const [tempFoodCost, setTempFoodCost] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [tempPasswordConfirm, setTempPasswordConfirm] = useState('');

  // Notifications — loaded from Supabase
  const [notifWeekly, setNotifWeekly] = useState(true);
  const [notifPriceAlert, setNotifPriceAlert] = useState(true);
  const [notifLowMargin, setNotifLowMargin] = useState(false);

  // Feedback
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (tabParam === 'notifications') setActiveTab('notifications');
    else if (tabParam === 'support') setActiveTab('support');
  }, [tabParam]);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserId(user.id);
    setUserEmail(user.email || '');
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, restaurant_id')
      .eq('id', user.id)
      .single();
    if (profile) {
      setUserName(profile.full_name || '');
      setRestaurantId(profile.restaurant_id);
      if (profile.restaurant_id) {
        const { data: rest } = await supabase
          .from('restaurants')
          .select('name, target_food_cost, notif_weekly_summary, notif_price_alerts, notif_low_margin')
          .eq('id', profile.restaurant_id)
          .single();
        if (rest) {
          setRestaurantName(rest.name || '');
          setTargetFoodCost(rest.target_food_cost || 30);
          setNotifWeekly(rest.notif_weekly_summary ?? true);
          setNotifPriceAlert(rest.notif_price_alerts ?? true);
          setNotifLowMargin(rest.notif_low_margin ?? false);
        }
      }
    }
    setLoading(false);
  }

  function flash(msg, isError = false) {
    if (isError) { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 3500); }
    else { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3500); }
  }

  // ── Save handlers ────────────────────────────────────────────────────────────

  async function saveName() {
    if (!tempName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: tempName.trim() }).eq('id', userId);
    setSaving(false);
    if (error) { flash('Failed to update name', true); return; }
    setUserName(tempName.trim());
    setEditingName(false);
    flash('Name updated');
  }

  async function saveRestaurant() {
    if (!tempRestaurant.trim() || !restaurantId) return;
    setSaving(true);
    const { error } = await supabase.from('restaurants').update({ name: tempRestaurant.trim() }).eq('id', restaurantId);
    setSaving(false);
    if (error) { flash('Failed to update restaurant name', true); return; }
    setRestaurantName(tempRestaurant.trim());
    setEditingRestaurant(false);
    flash('Restaurant name updated');
  }

  async function saveFoodCost() {
    const val = parseFloat(tempFoodCost);
    if (isNaN(val) || val < 1 || val > 99 || !restaurantId) return;
    setSaving(true);
    const { error } = await supabase.from('restaurants').update({ target_food_cost: val }).eq('id', restaurantId);
    setSaving(false);
    if (error) { flash('Failed to update target', true); return; }
    setTargetFoodCost(val);
    setEditingFoodCost(false);
    flash('Target food cost updated');
  }

  async function savePassword() {
    if (!tempPassword || tempPassword !== tempPasswordConfirm) {
      flash('Passwords do not match', true); return;
    }
    if (tempPassword.length < 8) { flash('Password must be at least 8 characters', true); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: tempPassword });
    setSaving(false);
    if (error) { flash('Failed to update password', true); return; }
    setEditingPassword(false);
    setTempPassword('');
    setTempPasswordConfirm('');
    flash('Password updated');
  }

  // ── Notification toggles — persist immediately on change ─────────────────────

  async function handleNotifToggle(field, value) {
    if (!restaurantId) return;
    // Optimistic update
    if (field === 'notif_weekly_summary') setNotifWeekly(value);
    if (field === 'notif_price_alerts') setNotifPriceAlert(value);
    if (field === 'notif_low_margin') setNotifLowMargin(value);

    setNotifSaving(true);
    const { error } = await supabase
      .from('restaurants')
      .update({ [field]: value })
      .eq('id', restaurantId);
    setNotifSaving(false);

    if (error) {
      // Revert on failure
      if (field === 'notif_weekly_summary') setNotifWeekly(!value);
      if (field === 'notif_price_alerts') setNotifPriceAlert(!value);
      if (field === 'notif_low_margin') setNotifLowMargin(!value);
      flash('Failed to save preference', true);
    }
  }

  async function handleManageBilling() {
    if (!restaurantId) return;
    try {
      const res = await fetch('/api/stripe/customer-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId }),
      });
      const { url, error } = await res.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch {
      flash('Could not open billing portal — please try again', true);
    }
  }

  // ── Sign out ─────────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/client/login');
  }

  // ── Export data ──────────────────────────────────────────────────────────────

  async function handleExport() {
    if (!restaurantId) return;
    setExporting(true);
    try {
      const [{ data: invoices }, { data: ingredients }, { data: menuItems }] = await Promise.all([
        supabase.from('invoices').select('*').eq('restaurant_id', restaurantId),
        supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId),
        supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId),
      ]);
      const exportData = {
        exported_at: new Date().toISOString(),
        restaurant: { id: restaurantId, name: restaurantName, target_food_cost: targetFoodCost },
        invoices: invoices || [],
        ingredients: ingredients || [],
        menu_items: menuItems || [],
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `optimenu-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash('Data exported successfully');
    } catch {
      flash('Export failed — please try again', true);
    }
    setExporting(false);
  }

  // ── Delete account ───────────────────────────────────────────────────────────

  async function handleDeleteAccount() {
    setShowDeleteModal(false);
    if (!restaurantId || !userId) return;
    try {
      // Delete restaurant data in order (respects FK constraints)
      await supabase.from('menu_items').delete().eq('restaurant_id', restaurantId);
      await supabase.from('ingredients').delete().eq('restaurant_id', restaurantId);
      await supabase.from('invoices').delete().eq('restaurant_id', restaurantId);
      await supabase.from('restaurants').delete().eq('id', restaurantId);
      await supabase.from('profiles').delete().eq('id', userId);
      await supabase.auth.signOut();
      router.push('/');
    } catch {
      flash('Something went wrong. Please contact support@opti-menu.com', true);
    }
  }

  // ── Feedback ─────────────────────────────────────────────────────────────────

  async function sendFeedback() {
    if (!feedbackText.trim()) return;
    await supabase.from('feedback').insert([{
      user_id: userId,
      message: feedbackText.trim(),
      created_at: new Date().toISOString(),
    }]).catch(() => {});
    setFeedbackText('');
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  }

  // ── Nav ──────────────────────────────────────────────────────────────────────

  const navItems = [
    { label: 'Dashboard', path: '/client/dashboard', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { label: 'Invoices', path: '/client/invoices', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
    { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
    { label: 'Menu', path: '/client/menu-items', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  ];

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 26, height: 26, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      {showDeleteModal && (
        <DeleteAccountModal
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
      <div className="pr-root">

        {/* NAV */}
        <div className="pr-nav">
          <button className="pr-back" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <div className="pr-nav-title">Profile & Settings</div>
          <div style={{ width: 50 }} />
        </div>

        {/* TABS */}
        <div className="pr-tabs">
          {[
            { id: 'account', label: 'Account' },
            { id: 'restaurant', label: 'Restaurant' },
            { id: 'notifications', label: 'Notifications' },
            { id: 'support', label: 'Support' },
          ].map(t => (
            <button key={t.id} className={`pr-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* SUCCESS / ERROR BANNER */}
        {(successMsg || errorMsg) && (
          <div style={{
            margin: '0 clamp(16px,2vw,32px) 12px',
            maxWidth: 640,
            marginLeft: 'auto',
            marginRight: 'auto',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 'clamp(11px,.85vw,13px)',
            background: successMsg ? 'rgba(42,138,90,.1)' : 'rgba(192,64,64,.1)',
            border: `1px solid ${successMsg ? 'rgba(42,138,90,.25)' : 'rgba(192,64,64,.25)'}`,
            color: successMsg ? '#2a8a5a' : '#c04040',
          }}>
            {successMsg || errorMsg}
          </div>
        )}

        {/* PAGE BODY */}
        <div className="pr-body">

          {/* ── AVATAR HEADER — shown on all tabs ── */}
          <div className="pr-avatar-header">
            <div className="pr-avatar-circle">{getUserInitials(userName)}</div>
            <div>
              <div className="pr-avatar-name">{userName || userEmail}</div>
              <div className="pr-avatar-email">{userEmail}</div>
              <div className="pr-avatar-badge">
                <div className="pr-avatar-badge-dot" />
                Founding Member
              </div>
            </div>
          </div>

          {/* ── ACCOUNT TAB ── */}
          {activeTab === 'account' && (
            <>
              {/* Account info */}
              <div className="pr-section">
                <div className="pr-section-title">Account Information</div>

                {/* Full name */}
                <div className="pr-field">
                  <div className="pr-field-row">
                    <div className="pr-field-lbl">Full Name</div>
                    {!editingName && <button className="pr-edit-btn" onClick={() => { setTempName(userName); setEditingName(true); }}>Edit</button>}
                  </div>
                  {editingName ? (
                    <div className="pr-input-row">
                      <input className="pr-input" style={{ marginTop: 0 }} value={tempName} onChange={e => setTempName(e.target.value)}
                        placeholder="Your full name" onKeyDown={e => e.key === 'Enter' && saveName()} autoFocus />
                      <button className="pr-save-btn" onClick={saveName} disabled={saving}>{saving ? '...' : 'Save'}</button>
                      <button className="pr-cancel-btn" onClick={() => setEditingName(false)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="pr-field-val">{userName || <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Not set</span>}</div>
                  )}
                </div>

                {/* Email */}
                <div className="pr-field">
                  <div className="pr-field-lbl">Email Address</div>
                  <div className="pr-field-val">{userEmail}</div>
                </div>

                {/* Password */}
                <div className="pr-field">
                  <div className="pr-field-row">
                    <div className="pr-field-lbl">Password</div>
                    {!editingPassword && <button className="pr-edit-btn" onClick={() => setEditingPassword(true)}>Change</button>}
                  </div>
                  {editingPassword ? (
                    <>
                      <input className="pr-input" type="password" placeholder="New password (min 8 chars)"
                        value={tempPassword} onChange={e => setTempPassword(e.target.value)} autoFocus />
                      <input className="pr-input" type="password" placeholder="Confirm new password"
                        value={tempPasswordConfirm} onChange={e => setTempPasswordConfirm(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && savePassword()} />
                      <div className="pr-input-row" style={{ marginTop: 0 }}>
                        <button className="pr-save-btn" onClick={savePassword} disabled={saving}>{saving ? '...' : 'Update Password'}</button>
                        <button className="pr-cancel-btn" onClick={() => { setEditingPassword(false); setTempPassword(''); setTempPasswordConfirm(''); }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div className="pr-field-val muted">••••••••••</div>
                  )}
                </div>
              </div>

              {/* Billing */}
              <div className="pr-section">
                <div className="pr-section-title">Billing</div>
                <div className="pr-field">
                  <div className="pr-field-row">
                    <div className="pr-field-lbl">Current Plan</div>
                    <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: '#02a4ba', fontWeight: 600 }}>$59 / month</div>
                  </div>
                  <div className="pr-field-val">Founding Member</div>
                  <div className="pr-field-hint">Locked-in rate for life. Renews monthly.</div>
                </div>
                <div className="pr-link-row" onClick={handleManageBilling}>
                  <div>
                    <div className="pr-link-label">Manage Billing</div>
                    <div className="pr-link-sub">Update payment method, view invoices</div>
                  </div>
                  <div className="pr-link-arrow">→</div>
                </div>
              </div>

              {/* Data & Privacy */}
              <div className="pr-section">
                <div className="pr-section-title">Data &amp; Privacy</div>
                <div className="pr-link-row" onClick={handleExport}>
                  <div>
                    <div className="pr-link-label">{exporting ? 'Exporting...' : 'Export My Data'}</div>
                    <div className="pr-link-sub">Download all your invoices, ingredients &amp; menu items as JSON</div>
                  </div>
                  <div className="pr-link-arrow">↓</div>
                </div>
                <div className="pr-link-row danger" onClick={() => setShowDeleteModal(true)}>
                  <div>
                    <div className="pr-link-label">Delete Account</div>
                    <div className="pr-link-sub" style={{ color: 'rgba(192,64,64,.6)' }}>Permanently delete all data — cannot be undone</div>
                  </div>
                  <div className="pr-link-arrow" style={{ color: '#c04040' }}>→</div>
                </div>
              </div>

              <button className="pr-signout-btn" onClick={handleSignOut}>Sign Out</button>
            </>
          )}

          {/* ── RESTAURANT TAB ── */}
          {activeTab === 'restaurant' && (
            <div className="pr-section">
              <div className="pr-section-title">Restaurant Settings</div>

              <div className="pr-field">
                <div className="pr-field-row">
                  <div className="pr-field-lbl">Restaurant Name</div>
                  {!editingRestaurant && <button className="pr-edit-btn" onClick={() => { setTempRestaurant(restaurantName); setEditingRestaurant(true); }}>Edit</button>}
                </div>
                {editingRestaurant ? (
                  <div className="pr-input-row">
                    <input className="pr-input" style={{ marginTop: 0 }} value={tempRestaurant} onChange={e => setTempRestaurant(e.target.value)}
                      placeholder="Restaurant name" onKeyDown={e => e.key === 'Enter' && saveRestaurant()} autoFocus />
                    <button className="pr-save-btn" onClick={saveRestaurant} disabled={saving}>{saving ? '...' : 'Save'}</button>
                    <button className="pr-cancel-btn" onClick={() => setEditingRestaurant(false)}>Cancel</button>
                  </div>
                ) : (
                  <div className="pr-field-val">{restaurantName || <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Not set</span>}</div>
                )}
              </div>

              <div className="pr-field">
                <div className="pr-field-row">
                  <div className="pr-field-lbl">Target Food Cost %</div>
                  {!editingFoodCost && <button className="pr-edit-btn" onClick={() => { setTempFoodCost(String(targetFoodCost)); setEditingFoodCost(true); }}>Edit</button>}
                </div>
                {editingFoodCost ? (
                  <div className="pr-input-row">
                    <input className="pr-input" style={{ marginTop: 0 }} type="number" min="1" max="99" value={tempFoodCost}
                      onChange={e => setTempFoodCost(e.target.value)} placeholder="e.g. 30"
                      onKeyDown={e => e.key === 'Enter' && saveFoodCost()} autoFocus />
                    <button className="pr-save-btn" onClick={saveFoodCost} disabled={saving}>{saving ? '...' : 'Save'}</button>
                    <button className="pr-cancel-btn" onClick={() => setEditingFoodCost(false)}>Cancel</button>
                  </div>
                ) : (
                  <div className="pr-field-val accent">{targetFoodCost}%</div>
                )}
                <div className="pr-field-hint">Menu items with food cost above this threshold are flagged as low margin across the app.</div>
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS TAB ── */}
          {activeTab === 'notifications' && (
            <div className="pr-section">
              <div className="pr-section-title">Email Notifications</div>
              <div className="pr-toggle-row">
                <div>
                  <div className="pr-toggle-label">Weekly cost summary</div>
                  <div className="pr-toggle-sub">Email every Monday with your top cost changes</div>
                </div>
                <Toggle
                  on={notifWeekly}
                  saving={notifSaving}
                  onChange={v => handleNotifToggle('notif_weekly_summary', v)}
                />
              </div>
              <div className="pr-toggle-row">
                <div>
                  <div className="pr-toggle-label">Ingredient price alerts</div>
                  <div className="pr-toggle-sub">When an ingredient price rises more than 10%</div>
                </div>
                <Toggle
                  on={notifPriceAlert}
                  saving={notifSaving}
                  onChange={v => handleNotifToggle('notif_price_alerts', v)}
                />
              </div>
              <div className="pr-toggle-row">
                <div>
                  <div className="pr-toggle-label">Low margin alerts</div>
                  <div className="pr-toggle-sub">When menu items drop below your target food cost</div>
                </div>
                <Toggle
                  on={notifLowMargin}
                  saving={notifSaving}
                  onChange={v => handleNotifToggle('notif_low_margin', v)}
                />
              </div>
            </div>
          )}

          {/* ── SUPPORT TAB ── */}
          {activeTab === 'support' && (
            <>
              <div className="pr-link-row" onClick={() => restartTour(router)}>
                <div className="pr-link-label">Restart Tour</div>
                <div className="pr-link-arrow">→</div>
              </div>
              <div className="pr-section">
                <div className="pr-section-title">Send Feedback</div>
                <div className="pr-field">
                  <div className="pr-field-lbl" style={{ marginBottom: 8 }}>What's on your mind?</div>
                  <textarea
                    className="pr-input"
                    rows={4}
                    style={{ resize: 'vertical', lineHeight: 1.5 }}
                    placeholder="Feature requests, bugs, or anything else..."
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value)}
                  />
                  <button className="pr-save-btn" style={{ marginTop: 10, width: '100%' }} onClick={sendFeedback} disabled={!feedbackText.trim()}>
                    {feedbackSent ? '✓ Sent — thank you!' : 'Send Feedback'}
                  </button>
                </div>
              </div>

              <div className="pr-section">
                <div className="pr-section-title">Contact</div>
                <div className="pr-link-row" onClick={() => window.open('mailto:support@opti-menu.com', '_blank')}>
                  <div className="pr-link-label">Email Support</div>
                  <div className="pr-link-arrow">→</div>
                </div>
                <div className="pr-link-row" onClick={() => window.open('https://www.opti-menu.com', '_blank')}>
                  <div className="pr-link-label">Visit opti-menu.com</div>
                  <div className="pr-link-arrow">→</div>
                </div>
              </div>

              <div style={{ textAlign: 'center', fontSize: 'clamp(10px,.75vw,12px)', color: '#4a453e', marginBottom: 24 }}>
                OptiMenu · Founding Member Plan · v1.0
              </div>
            </>
          )}

        </div>

        {/* MOBILE BOTTOM NAV */}
        {isMobile && (
          <div className="mob-bottom-nav">
            {navItems.map(({ label, path, icon }) => (
              <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
                <div className="mob-nav-icon">{icon}</div>
                <div className="mob-nav-label">{label}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </>
  );
}
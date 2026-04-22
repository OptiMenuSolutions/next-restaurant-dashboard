// pages/admin/messaging.js
// Direct message UI — compose and send emails to any customer via Resend.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TEMPLATES = [
  {
    label: 'Welcome check-in',
    subject: 'Getting started with OptiMenu',
    message: `I wanted to personally reach out and see how things are going with OptiMenu so far.\n\nHave you had a chance to upload any invoices or set up your menu items? If you run into anything or have questions, just reply here — I'm happy to help.\n\nThanks for being a Founding Member.`,
  },
  {
    label: 'Feature announcement',
    subject: 'New feature: [Feature Name]',
    message: `I wanted to give you a heads up about a new feature we just shipped: [Feature Name].\n\n[Brief description of what it does and why it's useful for them]\n\nYou can access it from [location in app]. Let me know what you think — your feedback directly shapes what we build next.`,
  },
  {
    label: 'Invoice parse issue',
    subject: 'Issue with your recent invoice upload',
    message: `I noticed one of your recent invoice uploads ran into a parsing issue on our end. I've manually re-processed it and it should now appear correctly in your Invoice Center.\n\nIf anything still looks off, just reply here and I'll sort it out for you.\n\nSorry for the inconvenience.`,
  },
  {
    label: 'Churn save',
    subject: 'Checking in — anything I can help with?',
    message: `I noticed you haven't logged into OptiMenu in a little while and wanted to check in.\n\nIs there anything I can help you get set up, or anything about the product that isn't working for you? I'd love to get your honest feedback — even if it's critical.\n\nHappy to jump on a quick call too if that's easier.`,
  },
];

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MessagingPage() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Compose state
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [toEmail, setToEmail] = useState('');
  const [toName, setToName] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sent log (session only)
  const [sentLog, setSentLog] = useState([]);
  const [result, setResult] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => { fetchRestaurants(); }, []);

  async function fetchRestaurants() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/restaurants?action=list');
      const data = await res.json();
      setRestaurants(data.restaurants || []);
    } catch {
      // fallback: query directly
      const { data } = await supabase
        .from('restaurants')
        .select('id, name, owner_email, owner_name')
        .order('created_at', { ascending: false });
      setRestaurants(data || []);
    }
    setLoading(false);
  }

  function selectRestaurant(r) {
    setSelectedRestaurant(r);
    setToEmail(r.owner_email || r.email || '');
    setToName(r.owner_name || r.name || '');
    setResult(null);
  }

  function applyTemplate(t) {
    setSubject(t.subject);
    setMessage(t.message);
  }

  async function handleSend() {
    if (!toEmail || !subject || !message.trim()) return;
    setSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, toName, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');

      setSentLog((prev) => [{
        id: data.id,
        to: toEmail,
        toName,
        subject,
        sentAt: new Date().toISOString(),
        restaurant: selectedRestaurant?.name,
      }, ...prev]);

      setResult({ type: 'success', text: `Email sent to ${toEmail}` });
      setSubject('');
      setMessage('');
    } catch (err) {
      setResult({ type: 'error', text: err.message });
    }
    setSending(false);
  }

  const filtered = restaurants.filter((r) => {
    const q = searchQuery.toLowerCase();
    return (
      r.name?.toLowerCase().includes(q) ||
      r.owner_email?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q)
    );
  });

  return (
    <AdminLayout title="Messaging">
      <div style={s.page}>

        {/* ── HEADER ── */}
        <div style={s.header}>
          <div>
            <div style={s.headerTitle}>Direct Messaging</div>
            <div style={s.headerSub}>Send emails to customers via nick@opti-menu.com</div>
          </div>
        </div>

        <div style={s.grid}>

          {/* ── LEFT: Customer picker ── */}
          <div style={s.panel}>
            <div style={s.panelHeader}>
              <div style={s.panelTitle}>Customers</div>
              <input
                style={s.search}
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div style={s.customerList}>
              {loading ? (
                <div style={s.empty}>Loading...</div>
              ) : filtered.length === 0 ? (
                <div style={s.empty}>No customers found</div>
              ) : filtered.map((r) => {
                const email = r.owner_email || r.email || '';
                const active = selectedRestaurant?.id === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => selectRestaurant(r)}
                    style={{ ...s.customerRow, ...(active ? s.customerRowActive : {}) }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#1a1d24'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ ...s.customerAvatar, background: active ? 'rgba(2,164,186,0.2)' : '#1e2028', color: active ? '#02a4ba' : '#5a6080' }}>
                      {(r.name || 'R').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...s.customerName, color: active ? '#e4e6f0' : '#9aa0b8' }}>{r.name}</div>
                      <div style={s.customerEmail}>{email || 'No email'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT: Compose ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Templates */}
            <div style={s.panel}>
              <div style={s.panelHeader}>
                <div style={s.panelTitle}>Templates</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px' }}>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => applyTemplate(t)}
                    style={s.templateBtn}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#02a4ba'; e.currentTarget.style.color = '#02a4ba'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2028'; e.currentTarget.style.color = '#5a6080'; }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Compose form */}
            <div style={s.panel}>
              <div style={s.panelHeader}>
                <div style={s.panelTitle}>Compose</div>
                {selectedRestaurant && (
                  <span style={s.toChip}>To: {toName || toEmail}</span>
                )}
              </div>
              <div style={s.composeBody}>

                {/* To */}
                <div style={s.field}>
                  <label style={s.label}>To (email)</label>
                  <input
                    style={s.input}
                    placeholder="customer@example.com"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...s.field, flex: 1 }}>
                    <label style={s.label}>Name (optional)</label>
                    <input
                      style={s.input}
                      placeholder="Customer name"
                      value={toName}
                      onChange={(e) => setToName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Subject */}
                <div style={s.field}>
                  <label style={s.label}>Subject</label>
                  <input
                    style={s.input}
                    placeholder="Email subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                {/* Message */}
                <div style={s.field}>
                  <label style={s.label}>Message</label>
                  <textarea
                    style={{ ...s.input, minHeight: 180, resize: 'vertical', lineHeight: 1.6 }}
                    placeholder="Write your message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>

                {/* Result banner */}
                {result && (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 500,
                    background: result.type === 'success' ? 'rgba(2,164,186,0.1)' : 'rgba(232,84,84,0.1)',
                    border: `1px solid ${result.type === 'success' ? 'rgba(2,164,186,0.3)' : 'rgba(232,84,84,0.3)'}`,
                    color: result.type === 'success' ? '#02a4ba' : '#e85454',
                  }}>
                    {result.type === 'success' ? '✓ ' : '✕ '}{result.text}
                  </div>
                )}

                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={sending || !toEmail || !subject || !message.trim()}
                  style={{
                    ...s.sendBtn,
                    opacity: (sending || !toEmail || !subject || !message.trim()) ? 0.5 : 1,
                    cursor: (sending || !toEmail || !subject || !message.trim()) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {sending ? 'Sending...' : 'Send Email →'}
                </button>

                <div style={s.fromNote}>Sending from nick@opti-menu.com</div>
              </div>
            </div>

            {/* Sent log (session) */}
            {sentLog.length > 0 && (
              <div style={s.panel}>
                <div style={s.panelHeader}>
                  <div style={s.panelTitle}>Sent this session</div>
                </div>
                {sentLog.map((log) => (
                  <div key={log.id} style={s.logRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.logSubject}>{log.subject}</div>
                      <div style={s.logTo}>{log.toName ? `${log.toName} <${log.to}>` : log.to}</div>
                    </div>
                    <div style={s.logTime}>{timeAgo(log.sentAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 20, fontWeight: 700, color: '#e4e6f0', fontFamily: "'Playfair Display', serif" },
  headerSub: { fontSize: 11, color: '#4a5068', marginTop: 4 },

  grid: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' },

  panel: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, overflow: 'hidden' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e2028' },
  panelTitle: { fontSize: 10, fontWeight: 700, color: '#4a5068', textTransform: 'uppercase', letterSpacing: '0.8px' },

  search: { background: '#0a0908', border: '1px solid #1e2028', borderRadius: 6, padding: '5px 10px', fontSize: 11, color: '#e4e6f0', outline: 'none', width: 120, fontFamily: "'Inter', sans-serif" },

  customerList: { maxHeight: 480, overflowY: 'auto' },
  customerRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', fontFamily: "'Inter', sans-serif", borderBottom: '1px solid #1a1d24' },
  customerRowActive: { background: 'rgba(2,164,186,0.07)', borderLeft: '2px solid #02a4ba' },
  customerAvatar: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  customerName: { fontSize: 12, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  customerEmail: { fontSize: 10, color: '#3a3e50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { padding: '24px 16px', fontSize: 12, color: '#3a3e50', textAlign: 'center' },

  templateBtn: { background: 'none', border: '1px solid #1e2028', borderRadius: 20, padding: '4px 12px', fontSize: 10, fontWeight: 500, color: '#5a6080', cursor: 'pointer', transition: 'all 0.15s', fontFamily: "'Inter', sans-serif" },

  composeBody: { padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px' },
  input: { background: '#0a0908', border: '1px solid #1e2028', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#e4e6f0', outline: 'none', fontFamily: "'Inter', sans-serif', width: '100%", boxSizing: 'border-box', transition: 'border-color 0.15s' },

  toChip: { fontSize: 10, color: '#02a4ba', background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.2)', borderRadius: 20, padding: '2px 8px' },

  sendBtn: { background: '#02a4ba', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 12, fontWeight: 700, color: '#0a0908', fontFamily: "'Inter', sans-serif", transition: 'background 0.15s', alignSelf: 'flex-start' },
  fromNote: { fontSize: 10, color: '#3a3e50' },

  logRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #1a1d24' },
  logSubject: { fontSize: 12, color: '#9aa0b8', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  logTo: { fontSize: 10, color: '#3a3e50', marginTop: 2 },
  logTime: { fontSize: 10, color: '#3a3e50', flexShrink: 0 },
};
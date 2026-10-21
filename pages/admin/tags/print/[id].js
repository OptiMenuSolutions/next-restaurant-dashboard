// pages/admin/tags/print/[id].js
// 4 × 6 print pages for a kit. ?kind=label is the mailing label (from and
// to); ?kind=card is the intro card that goes in the box. Opens the print
// dialog on its own. Print at 100% on 4 × 6 paper or labels, or save as PDF.

import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import supabase from '../../../../lib/supabaseClient';
import { useAdminFetch } from '../../../../lib/admin/useAdminFetch';

export default function PrintPage() {
  const router = useRouter();
  const { id, kind = 'label' } = router.query;
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/admin/login'); return; }
      try {
        const res = await adminFetch(`/api/admin/tags?kit=${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load the kit');
        setData(json);
        setTimeout(() => window.print(), 400);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [id, adminFetch, router]);

  if (error) return <p style={{ fontFamily: 'sans-serif', padding: 24 }}>{error}</p>;
  if (!data) return <p style={{ fontFamily: 'sans-serif', padding: 24 }}>Loading…</p>;

  const labels = data.tags.map((t) => t.label);
  const range = labels.length > 1 ? `${labels[0]} to ${labels[labels.length - 1]}` : labels[0] || '';

  return (
    <>
      <Head>
        <title>{`${kind === 'card' ? 'Intro card' : 'Label'} · ${data.restaurant?.name || ''}`}</title>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        html, body { margin: 0; padding: 0; background: #e6e4e0; }
        .sheet { width: 4in; height: 6in; box-sizing: border-box; padding: 0.3in; background: #fff; color: #111819; font-family: Manrope, sans-serif; margin: 20px auto; display: flex; flex-direction: column; }
        .mono { font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.12em; font-size: 9pt; color: #4b585b; }
        @media print { html, body { background: #fff; } .sheet { margin: 0; } }
      `}</style>

      {kind === 'card' ? (
        <div className="sheet">
          <div className="mono">OPTIMENU · TONIGHT’S DISH</div>
          <div style={{ fontSize: '20pt', fontWeight: 800, lineHeight: 1.15, marginTop: '0.15in' }}>Welcome, {data.restaurant?.name}</div>
          <div style={{ fontSize: '11pt', lineHeight: 1.5, marginTop: '0.2in' }}>
            Your tags show your team tonight’s three dishes to push, every shift.
          </div>
          <ol style={{ fontSize: '11pt', lineHeight: 1.55, paddingLeft: '0.22in', marginTop: '0.15in' }}>
            <li>Stick each tag where your team stands before service: the host stand, a server station, the kitchen pass.</li>
            <li>Tap a tag with any phone. No app needed.</li>
            <li>The first tap on each tag asks where it is. Pick the spot once.</li>
          </ol>
          <div style={{ marginTop: 'auto', fontSize: '10pt', color: '#4b585b' }}>Questions? Profile → Send feedback in the app, or nick@opti-menu.com</div>
          <div className="mono" style={{ marginTop: '0.1in' }}>{range}</div>
        </div>
      ) : (
        <div className="sheet">
          <div className="mono">FROM</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '10pt', lineHeight: 1.4, marginTop: 4 }}>{data.shipFrom || 'OptiMenu'}</div>
          <div style={{ borderTop: '2px solid #111819', margin: '0.3in 0 0.2in' }} />
          <div className="mono">SHIP TO</div>
          <div style={{ fontSize: '15pt', fontWeight: 800, lineHeight: 1.3, marginTop: 6 }}>{data.restaurant?.name}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '14pt', fontWeight: 700, lineHeight: 1.35, marginTop: 4 }}>{data.kit.ship_to}</div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div className="mono">NFC TAG KIT · {range}</div>
            <div className="mono">{labels.length} TAG{labels.length === 1 ? '' : 'S'}</div>
          </div>
        </div>
      )}
    </>
  );
}
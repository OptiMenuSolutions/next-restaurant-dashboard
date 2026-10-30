// lib/admin/withAdminAuth.js
// Wrap every admin API route with this to verify the caller is an admin.
// Usage: export default withAdminAuth(async function handler(req, res, session) { ... })

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './requireAdmin';
import { sendCronAlert } from '../cronAlert';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export function withAdminAuth(handler) {
  return async function (req, res) {
    try {
      // ── 1. Verify admin session, role, and MFA ──────────────────────────
      // All admin routes share the same authentication requirements.
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { user, profile } = admin;

      // ── 2. Write audit log entry ──────────────────────────────────────────
      // Every admin API call is logged automatically.
      await writeAuditLog({
        admin_id: user.id,
        admin_name: profile.full_name || profile.email,
        action: req.method + ' ' + req.url,
        metadata: {
          body_keys: req.body ? Object.keys(req.body) : [],
          query: req.query,
        },
      });

      // ── 3. Call the actual handler ────────────────────────────────────────
      return handler(req, res, { user, profile });

    } catch (err) {
      console.error('[withAdminAuth] Error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ── Audit log writer ─────────────────────────────────────────────────────────
export async function writeAuditLog({ admin_id, admin_name, action, target_restaurant_id, target_restaurant_name, metadata, reason }) {
  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_id,
      admin_name: admin_name || 'Unknown',
      action,
      target_restaurant_id: target_restaurant_id || null,
      target_restaurant_name: target_restaurant_name || null,
      metadata: metadata || {},
      reason: reason || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }
  } catch (err) {
    // Audit logging failures must not interrupt administrative actions.
    console.error('[audit] Failed to write log entry:', err);

    await sendCronAlert(
      'Admin audit logging',
      'An administrative audit log entry could not be saved.',
      [
        `Error: ${err?.message || 'Unknown database error'}`,
        'Check the Vercel runtime logs for additional details.',
      ]
    );
  }
}
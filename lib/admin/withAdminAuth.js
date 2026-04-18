// lib/admin/withAdminAuth.js
// Wrap every admin API route with this to verify the caller is an admin.
// Usage: export default withAdminAuth(async function handler(req, res, session) { ... })

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export function withAdminAuth(handler) {
  return async function (req, res) {
    try {
      // ── 1. Verify ADMIN_SECRET header ────────────────────────────────────
      // Admin pages send this header on every API call.
      // This is a second layer on top of the middleware session check.
      const secret = req.headers['x-admin-secret'];
      if (!secret && secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // ── 2. Get the Supabase session from the Authorization header ─────────
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No session token' });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      // ── 3. Confirm role === 'admin' in profiles ───────────────────────────
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', user.id)
        .single();

      if (!profile || profile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden — admin only' });
      }

      // ── 4. Write audit log entry ──────────────────────────────────────────
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

      // ── 5. Call the actual handler ────────────────────────────────────────
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
    await supabase.from('admin_audit_log').insert({
      admin_id,
      admin_name: admin_name || 'Unknown',
      action,
      target_restaurant_id: target_restaurant_id || null,
      target_restaurant_name: target_restaurant_name || null,
      metadata: metadata || {},
      reason: reason || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Never let audit log failure break an admin action
    console.error('[audit] Failed to write log entry:', err);
  }
}
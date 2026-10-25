import { sendFromNick } from '../admin/email';
import { noteJobError } from '../admin/jobRun';

const checked = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

async function deliverAlerts(db, restaurantId, { kind, finalize, label }) {
  checked(await db.rpc(finalize, {
    p_restaurant_id: restaurantId,
  }));

  const failures = [];

  for (let index = 0; index < 10; index++) {
    const [email] = checked(await db.rpc(
      'claim_owner_alert_email',
      { p_restaurant_id: restaurantId, p_kind: kind }
    )) || [];

    if (!email) break;

    try {
      await sendFromNick({
        to: email.email,
        subject: email.subject,
        message: email.message,
        button: {
          label,
          url: `https://www.opti-menu.com${email.href}`,
        },
        idempotencyKey: `notification/${email.id}`,
      });

      const saved = checked(
        await db
          .from('notification_email_outbox')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            last_error: null,
            lease_token: null,
            lease_until: null,
          })
          .eq('id', email.id)
          .eq('lease_token', email.lease_token)
          .select('id')
          .single()
      );

      if (!saved) {
        throw new Error(
          'Could not confirm notification delivery'
        );
      }
    } catch (error) {
      const message = error.message || String(error);
      failures.push(message);

      const reset = await db
        .from('notification_email_outbox')
        .update({
          status: 'pending',
          last_error: message,
          lease_token: null,
          lease_until: null,
        })
        .eq('id', email.id)
        .eq('lease_token', email.lease_token);

      if (reset.error) {
        failures.push(reset.error.message);
      }

      break;
    }
  }

  const held = checked(
    await db
      .from('notification_email_outbox')
      .select('id,last_error,notifications!inner(kind)')
      .eq('restaurant_id', restaurantId)
      .eq('notifications.kind', kind)
      .eq('status', 'needs_review')
      .limit(1)
  );

  if (held?.length) {
    failures.push(
      held[0].last_error || 'Email delivery needs review'
    );
  }

  if (failures.length) {
    await noteJobError(
      `${kind}:${restaurantId}`,
      `Owner alert delivery needs attention for ${restaurantId}`,
      failures.join('\n')
    );
  }

  return { failures };
}

export function deliverPriceAlerts(db, restaurantId) {
  return deliverAlerts(db, restaurantId, {
    kind: 'ingredient_price',
    finalize: 'finalize_price_alerts',
    label: 'View ingredients',
  });
}

export function deliverLowMarginAlerts(db, restaurantId) {
  return deliverAlerts(db, restaurantId, {
    kind: 'low_margin',
    finalize: 'finalize_low_margin_alerts',
    label: 'View menu',
  });
}
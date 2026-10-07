// pages/api/webhooks/shift4.js
//
// Shift4 Marketplace Installation Request webhook receiver.
// Writes to pos_connections (unified POS provider table).

import { createClient } from "@supabase/supabase-js";
import { verifyWebhook, buildHmacHeaders } from "../../../lib/pos/hmac-auth.js";
import { Resend } from "resend";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shift4ApiHost = process.env.SHIFT4_API_HOST || "https://conecto-api-sandbox.shift4payments.com";
const clientId = process.env.SHIFT4_CLIENT_ID;
const clientSecret = process.env.SHIFT4_CLIENT_SECRET;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase env vars");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

function log(...args) {
  console.log("[shift4-webhook]", ...args);
}

function err(...args) {
  console.error("[shift4-webhook ERROR]", ...args);
}

// Shift4 signs the exact bytes it sends, so we need the raw body. With Next.js
// parsing it first, re-stringifying can change spacing or key order and break
// the signature match.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Must match the path of the webhook URL registered with Shift4.
const WEBHOOK_PATH = "/api/webhooks/shift4";

// marketplace.Location.deleted: the merchant uninstalled OptiMenu in Shift4.
// Stop syncing that location. Safe to receive twice: a repeat finds nothing
// left to update and still returns 200.
async function handleLocationDeleted(payload, res) {
  const locationId = Number(payload?.locationId);
  if (!Number.isInteger(locationId)) {
    log("Location.deleted without a usable locationId");
    return res.status(400).json({ error: "Missing locationId" });
  }

  const { data, error } = await supabaseAdmin
    .from("pos_connections")
    .update({
      status: "disconnected",
      shift4_location_id: null,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      last_error: "Uninstalled from the Shift4 Marketplace",
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "shift4")
    .eq("shift4_location_id", locationId)
    .select("restaurant_id");

  if (error) {
    err("Failed to disconnect uninstalled location:", error.message);
    return res.status(500).json({ error: "Failed to process uninstall" }); // non-2xx so Shift4 retries
  }

  log(`Location ${locationId} uninstalled, disconnected ${data?.length || 0} connection(s)`);
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ─── 1. Verify signature ────────────────────────────────────────────
    const signature = req.headers["x-signature"];
    const timestamp = req.headers["x-timestamp"];
    const accessKey = req.headers["x-access-key"];

    if (!signature || !timestamp || !accessKey) {
      log("Missing auth headers");
      return res.status(401).json({ error: "Missing auth headers" });
    }
    if (accessKey !== clientId) {
      log("Webhook signed for a different client id");
      return res.status(401).json({ error: "Invalid access key" });
    }

    const rawBody = await readRawBody(req);

    try {
      const valid = verifyWebhook({
        clientId,
        clientSecret,
        signature,
        timestamp: Number(timestamp),
        path: WEBHOOK_PATH,
        body: rawBody,
      });
      if (!valid) {
        log("Signature verification failed");
        return res.status(401).json({ error: "Invalid signature" });
      }
    } catch (e) {
      log("Signature verification error:", e.message);
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // ─── 2. Parse webhook payload ────────────────────────────────────────
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    const { event, payload } = body;

    if (event?.name === "marketplace.Location.deleted") {
      return handleLocationDeleted(payload, res);
    }

    // Installation Request handling below stays until Shift4 moves OptiMenu
    // to the OAuth Token Flow, then it can be removed.
    if (event?.name !== "marketplace.InstallationRequest.created") {
      log("Ignoring event:", event?.name);
      return res.status(200).json({ ok: true });
    }

    const { locationId, guid } = payload;
    if (!locationId || !guid) {
      log("Missing locationId or guid in payload");
      return res.status(400).json({ error: "Missing locationId or guid" });
    }

    // ─── 3. Fetch full request details from Shift4 ───────────────────────
    log(`Fetching installation request for location ${locationId}, guid ${guid}`);

    const requestPath = `/marketplace/v2/locations/${locationId}/requests/installations/${guid}`;
    const headers = buildHmacHeaders({
      clientId,
      clientSecret,
      method: "GET",
      path: requestPath,
    });

    const requestRes = await fetch(`${shift4ApiHost}${requestPath}`, { headers });
    const requestData = await requestRes.json();

    if (!requestRes.ok) {
      err("Failed to fetch installation request:", requestData);
      return res.status(500).json({ error: "Failed to fetch Shift4 request" });
    }

    const { restaurant, contact, location } = requestData;
    if (!restaurant || !contact) {
      log("Missing restaurant or contact in request details");
      return res.status(400).json({ error: "Missing restaurant/contact data" });
    }

    const restaurantName = restaurant.name || "Unnamed Restaurant";
    const merchantEmail = restaurant.email || contact.email;
    const fullName =
      contact.first_name && contact.last_name
        ? `${contact.first_name} ${contact.last_name}`
        : contact.name || "Owner";

    if (!merchantEmail) {
      err("No email found in request");
      return res.status(400).json({ error: "No email in request" });
    }

    log(`Creating account for: ${restaurantName} (${merchantEmail})`);

    // ─── 4. Create auth user ─────────────────────────────────────────────
    const tempPassword = Math.random().toString(36).slice(-16);

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: merchantEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, shift4_location_id: locationId },
    });

    if (authError || !authData.user) {
      err("Failed to create auth user:", authError);
      return res.status(500).json({ error: "Failed to create user" });
    }

    const userId = authData.user.id;
    log(`Created auth user: ${userId}`);

    // ─── 5. Insert profiles row (trigger creates restaurants) ────────────
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      email: merchantEmail,
      full_name: fullName,
    });

    if (profileError) {
      err("Failed to insert profile:", profileError);
    } else {
      log(`Created profile row for ${userId}`);
    }

    // ─── 6. Get the restaurant_id (created by trigger) ───────────────────
    const { data: restaurants, error: restaurantError } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (restaurantError || !restaurants) {
      err("Failed to fetch created restaurant:", restaurantError);
      return res.status(500).json({ error: "Failed to create restaurant" });
    }

    const restaurantId = restaurants.id;
    log(`Restaurant created: ${restaurantId}`);

    // ─── 7. Create pos_connections record for Shift4 ──────────────────────
    const { error: connectionError } = await supabaseAdmin
      .from("pos_connections")
      .insert({
        restaurant_id: restaurantId,
        provider: "shift4",
        shift4_location_id: locationId,
        shift4_merchant_id: location?.merchantId || null,
        status: "connected",
        last_synced_at: null,
      });

    if (connectionError) {
      err("Failed to create pos_connections:", connectionError);
      return res.status(500).json({ error: "Failed to link Shift4 location" });
    }

    log(`Created pos_connections: restaurant ${restaurantId}, provider shift4, location ${locationId}`);

    // ─── 8. Send password reset email via Resend ─────────────────────────
    log(`Sending password reset email to ${merchantEmail}`);

    const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: merchantEmail,
    });

    if (resetError || !resetData.properties?.recovery_link) {
      err("Failed to generate reset link:", resetError);
      return res.status(500).json({ error: "Failed to generate reset link" });
    }

    const resetLink = resetData.properties.recovery_link;

    const emailRes = await resend.emails.send({
      from: "support@opti-menu.com",
      to: merchantEmail,
      subject: "Welcome to OptiMenu – Set Your Password",
      html: `
        <p>Hi ${fullName},</p>
        <p>Your OptiMenu account for <strong>${restaurantName}</strong> has been created. Click the link below to set your password and get started.</p>
        <p><a href="${resetLink}" style="background-color: #02a4ba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Set Password</a></p>
        <p>If you have any questions, reach out to our support team.</p>
        <p>Best,<br />OptiMenu</p>
      `,
    });

    if (!emailRes.data?.id) {
      err("Failed to send email:", emailRes.error);
    } else {
      log(`Email sent: ${emailRes.data.id}`);
    }

    // ─── 9. PATCH request to FULFILLED ───────────────────────────────────
    log("PATCHing request to FULFILLED");

    const patchPath = `/marketplace/v2/locations/${locationId}/requests/installations/${guid}`;
    const patchHeaders = buildHmacHeaders({
      clientId,
      clientSecret,
      method: "PATCH",
      path: patchPath,
      body: JSON.stringify({ state: "FULFILLED" }),
    });

    const patchRes = await fetch(`${shift4ApiHost}${patchPath}`, {
      method: "PATCH",
      headers: patchHeaders,
      body: JSON.stringify({ state: "FULFILLED" }),
    });

    const patchData = await patchRes.json();

    if (!patchRes.ok) {
      err("Failed to PATCH request:", patchData);
    } else {
      log("Request PATCHED to FULFILLED");
    }

    // ─── 10. Success response ────────────────────────────────────────────
    log("Webhook processed successfully");
    return res.status(200).json({
      ok: true,
      restaurantId,
      shift4LocationId: locationId,
    });
  } catch (e) {
    err("Unhandled error:", e.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
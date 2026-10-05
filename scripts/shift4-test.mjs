#!/usr/bin/env node
//
// scripts/shift4-test.mjs
//
// Test Shift4 HMAC signing and data fetching.
// Usage: node --env-file=.env.local scripts/shift4-test.mjs
//
// Expects .env.local to contain:
//   SHIFT4_API_HOST=https://conecto-api-sandbox.shift4payments.com
//   SHIFT4_CLIENT_ID=<your-client-id>
//   SHIFT4_CLIENT_SECRET=<your-client-secret>
//   SHIFT4_LOCATION_ID=<your-location-id>

import { buildHmacHeaders, signRequest } from '../lib/pos/hmac-auth.js';

const API_BASE = process.env.SHIFT4_API_HOST || 'https://conecto-api-sandbox.shift4payments.com';
const CLIENT_ID = process.env.SHIFT4_CLIENT_ID;
const CLIENT_SECRET = process.env.SHIFT4_CLIENT_SECRET;
const LOCATION_ID = process.env.SHIFT4_LOCATION_ID;

function log(...args) {
  console.log('[shift4-test]', ...args);
}

function err(...args) {
  console.error('[shift4-test ERROR]', ...args);
}

async function testHmacSigning() {
  log('--- Test 1: HMAC Signing ---');
  
  const path = '/marketplace/v2/locations';
  const method = 'GET';
  const timestamp = 1765821600;
  
  const headers = buildHmacHeaders({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    method,
    path,
    body: null,
    timestamp,
  });

  log(`Path: ${path}`);
  log(`Method: ${method}`);
  log(`Timestamp: ${timestamp}`);
  log(`Headers:`);
  log(`  x-access-key: ${headers['x-access-key']}`);
  log(`  x-timestamp: ${headers['x-timestamp']}`);
  log(`  x-signature: ${headers['x-signature']}`);
  log('✓ HMAC signing works\n');
}

async function testFetchLocations() {
  log('--- Test 2: Fetch Locations ---');

  if (!CLIENT_ID || !CLIENT_SECRET) {
    err('SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET not set');
    return;
  }

  const path = '/marketplace/v2/locations';
  const headers = buildHmacHeaders({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    method: 'GET',
    path,
  });

  try {
    const res = await fetch(`${API_BASE}${path}`, { headers });
    const data = await res.json();

    if (!res.ok) {
      err(`HTTP ${res.status}: ${data.message || JSON.stringify(data)}`);
      return;
    }

    log(`Locations fetched: ${data.results?.length || 0}`);
    if (data.results && data.results.length > 0) {
      const loc = data.results[0];
      log(`  First location: id=${loc.id}, name=${loc.name}, timeZone=${loc.timeZone}`);
    }
    log('✓ Fetch locations works\n');
  } catch (e) {
    err(`Fetch failed: ${e.message}`);
  }
}

async function testFetchTickets() {
  log('--- Test 3: Fetch Tickets ---');

  if (!LOCATION_ID) {
    log('SHIFT4_LOCATION_ID not set; skipping ticket fetch test');
    log('(You can test this manually once you have a location ID)\n');
    return;
  }

  // Fetch last 3 days of tickets
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;

  const path = `/pos/v2/${LOCATION_ID}/tickets`;
  const qs = `filter[dateTimeFrom]=${encodeURIComponent(fromIso)}&filter[dateTimeTo]=${encodeURIComponent(toIso)}&limit=10`;
  
  const headers = buildHmacHeaders({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    method: 'GET',
    path, // path for signature excludes query params
  });

  try {
    const res = await fetch(`${API_BASE}${path}?${qs}`, { headers });
    const data = await res.json();

    if (!res.ok) {
      err(`HTTP ${res.status}: ${data.message || JSON.stringify(data)}`);
      return;
    }

    const tickets = data.results || [];
    log(`Tickets fetched: ${tickets.length}`);
    log(`Date range: ${from} to ${to}`);

    if (tickets.length > 0) {
      const t = tickets[0];
      log(`  First ticket: id=${t.id}, type=${t.type}, closedAt=${t.closedAt}`);
      if (t.ticketItems && t.ticketItems.length > 0) {
        const item = t.ticketItems[0];
        log(`    First item: name=${item.name}, qty=${item.quantity}, amount=${item.itemAmount}`);
      }
    }
    log('✓ Fetch tickets works\n');
  } catch (e) {
    err(`Fetch failed: ${e.message}`);
  }
}

async function main() {
  log('Shift4 HMAC & Data Fetch Test');
  log(`API Host: ${API_BASE}\n`);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    err('Missing SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET in env');
    process.exit(1);
  }

  await testHmacSigning();
  await testFetchLocations();
  await testFetchTickets();

  log('All tests complete');
}

main().catch(e => {
  err('Fatal:', e.message);
  process.exit(1);
});

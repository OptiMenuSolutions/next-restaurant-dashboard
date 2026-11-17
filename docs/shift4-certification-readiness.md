# Shift4 certification readiness

Scope supplied by Shift4: **POS API v2**, **OAuth Token** onboarding. The scheduling
email does not enumerate capability modules or subscription events. The code
implements historical Ticket v2 and POS Menu v2 retrieval. Confirm the generated
test list with Shift4; the template alone does not make every POS module applicable.

## Deployment order

1. Apply the included `atomic_shift4_sync` migration to the database used by the
   deployment before deploying the application changes. It adds two RPC functions;
   it does not rewrite existing business data. Both functions use invoker permissions,
   and execution is restricted to `service_role`.
2. Deploy the application. Restart any OAuth authorization begun before deployment:
   new callbacks require a fresh, browser-bound state cookie.
3. Smoke-test the chosen certification location. These steps have **not** been run
   against Shift4 by the automated regression suite.

## Changes and certification coverage

| Tests | Changes / evidence available in code |
|---|---|
| CORE-003, OA-007/008 | Server-side eligibility check, guarded installation, recovery when Shift4 installed successfully but the local save failed. Location timezone is saved before sales sync begins. |
| CORE-006/007 | Raw-body signature verification, bounded timestamp skew, repeat uninstall handling, current-state reconciliation for delayed notifications, non-2xx responses on failed processing. |
| CORE-008/009 | Disconnect claims pause sync before remote removal; pending removals can be retried. Stale jobs cannot reactivate removed connections or restore cleared credentials. |
| CORE-010 | Complete, validated installed-location collection; stale reconciliation cannot overwrite new credentials. Missing installations clear credentials as well as active state. |
| CORE-011 | Location-scoped persistence and timezone handling. RPC functions cannot be called by browser roles; tests cover isolation from other restaurants and CSV uploads. |
| CORE-012 | Pagination follows documented `meta.count`/`offset` behavior; throttled requests have bounded retries and fresh signatures. |
| OA-002–006, OA-009 | OAuth callbacks require signed, expiring state bound to the initiating browser. The dedicated refresh job saves rotated tokens, verifies Bearer access and surfaces failures. Sales sync uses HMAC independently of OAuth expiration. |
| TKT2-001/003–008 | Existing financial, modifier, refund and void mapping retained. Atomic persistence saves sales, tickets and lines together, rolls back failures, and rejects stale pulls. Live source-to-output reconciliation is still required. |
| POSM2-001–004 | Existing menu/reference mapping retained. Malformed menu responses fail before any writes or removal marking. Representative menu/modifier data must still be demonstrated. |

## Remaining environment and scope checks

- **CORE-004 and CORE-008:** Shift4 must expose OptiMenu's listing, registered Manage
  destination and merchant uninstall action to the certification sandbox/location.
- **TKT2-002:** Ticket-reference lookup is conditional. The implementation runs only
  when `SHIFT4_SPECIAL_REQUESTS_ENABLED=true`. Confirm lookup permission and a
  successful real request before including typed kitchen requests in the demonstration.
  The flag remains unchanged by this patch.
- **TKT2-009, POSM2-007/008:** The receiver does not consume POS update subscriptions.
  These tests apply only if those events are selected. Confirm they are excluded,
  or implement the selected event handling before claiming support.
- Confirm sandbox API/OAuth hosts, both credential pairs, callback registration,
  the public HTTPS webhook subscription, and test-location visibility. Automated
  tests use synthetic credentials and cannot verify these settings.
- Prepare known tickets covering quantities, modifiers, discounts, refunds/voids,
  totals and local-date boundaries; compare them to Shift4 Dine and OptiMenu.
- Demonstrate OAuth Allow and Deny, location selection, a forced token refresh
  from Jobs & health, partner disconnect/reconnect, and merchant uninstall.

## Verification

`npm run test:shift4` runs route/provider regression tests plus the actual migration
SQL in an isolated embedded PostgreSQL instance (PGlite). It makes no Shift4 calls
and does not modify a hosted database. The SQL tests cover rollback, stale work,
ownership, credential comparisons and RPC permissions.

Also run the existing POS consumption, inventory replay/delivery and restaurant
timezone suites, plus a Next.js production build. Build-only synthetic environment
values validate compilation; they do not establish production or sandbox readiness.

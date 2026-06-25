# Operations

## Goal

Run the phone-order flow in a script-first way so the common case does not require live AI reasoning.

## Current API-first finding

There are two different "order creation" lanes in practice:

- The legacy/private Admin API helper (`mysapo.net` + Basic auth) can create plain order records through `POST /admin/orders.json`.
- The real Sapo Omni "Tao don va giao hang" screen uses the logged-in web session on `mysapogo.com` and submits a richer internal payload to the same path `POST /admin/orders.json`.

The richer Omni payload is the one that creates the expected operational result:

- order code like `SON24416`
- fulfillment / packing record like `FUN32172`
- carrier-linked shipment block
- visible progress in the Omni order-detail workflow

Captured supporting internal endpoints from the real Omni flow:

- `POST /admin/shipping_services/ghn/estimate_fee.json`
- `POST /admin/shipping_services/sapo_express/shipping_services.json`
- `POST /admin/orders.json`

Useful local artifacts:

- `data/sapo-ui-create-order-capture.json`
- `data/sapo-ui-new-customer-capture.json`
- `scripts/capture-sapo-ui-create-order-network.mjs`
- `scripts/create-sapo-omni-order-existing-customer.mjs`
- `scripts/create-sapo-omni-order-from-request.mjs`
- `scripts/run-phone-order-omni-session-queue.mjs`

Important scope note:

- `scripts/create-sapo-omni-order-existing-customer.mjs` was the first narrow prototype for existing customers.
- `scripts/create-sapo-omni-order-from-request.mjs` is now the preferred lane for request-driven execution.
- The current unified session lane can:
  - search active customer by phone
  - create a customer through `POST /admin/customers.json` when none exists
  - resolve Sapo internal city / district / ward ids
  - estimate GHN shipping
  - create a real Omni order through `POST /admin/orders.json`
  - record the created `SON...` order back into the local queue/status files
- Browser automation remains available as a fallback lane, but it is no longer the preferred path for the common case.

## Recommended execution order

1. Fetch inbox queue:

```powershell
node scripts/fetch-phone-order-inbox.mjs
```

2. Import inbox into local queue:

```powershell
node scripts/import-phone-order-requests.mjs
```

3. Validate requests and build the processing plan:

```powershell
node scripts/process-phone-order-requests.mjs
```

4. Claim the next ready request for execution and emit the browser bundle:

```powershell
node scripts/run-phone-order-worker.mjs
```

Optional dry-run claim preview:

```powershell
node scripts/run-phone-order-worker.mjs --dry-run
```

5. Convert the worker bundle into a browser-facing execution plan:

```powershell
node scripts/prepare-phone-order-execution.mjs
```

Optional selection by request ID:

```powershell
node scripts/prepare-phone-order-execution.mjs --request-id <id>
```

Force a clean rebuild from queue + processing-plan state when a stale worker bundle should be ignored:

```powershell
node scripts/prepare-phone-order-execution.mjs --request-id <id> --from-state
```

6. Execute the generated plan in Sapo using the validated browser flow.

Preferred session-API lane for a specific ready request:

```powershell
node scripts/create-sapo-omni-order-from-request.mjs --request-id <id> --submit
```

Preview only:

```powershell
node scripts/create-sapo-omni-order-from-request.mjs --request-id <id>
```

Preferred sequential queue runner for the session-API lane:

```powershell
node scripts/run-phone-order-omni-session-queue.mjs --limit 5
```

Notes:

- this runner is sequential and oldest-first
- on success it writes back `created` status and the `SON...` order URL
- on failure it marks the request `failed` and continues to the next request in later runs

Current lightweight executor scaffold:

```powershell
node scripts/execute-phone-order-browser.mjs --dry-run
```

This prepares or refreshes the final browser-facing checklist payload.

Live browser execution is now supported when the executor is called from a Chrome-capable runtime that injects the adapter layer.

The live wiring now exists at code level through:

- `scripts/lib/chrome-phone-order-live-adapter.mjs`
- `scripts/lib/phone-order-browser-live-runner.mjs`
- `scripts/lib/phone-order-node-repl-live.mjs`

These are intended to be invoked from a Chrome-capable runtime such as the existing Node REPL browser session, not from a plain standalone Node process.

Recommended live entry from a Chrome-capable runtime:

- claim the working Sapo tab
- run `runClaimedSapoExecution(...)`
- limit early trials with `maxSteps`

Important current live coverage:

- existing-customer selection is wired
- new-customer creation is now wired with best-effort modal filling based on phone, name, and normalized address
- GHN carrier preference is now re-checked after switching shipping mode
- total, COD, and declared-value steps remain resumable

Local smoke test for the live executor path without touching Chrome:

```powershell
node scripts/test-phone-order-browser-live-smoke.mjs
```

Local smoke test for browser-step generation:

```powershell
node scripts/test-phone-order-browser-steps.mjs
```

Dedicated automation-profile path for live Sapo execution:

1. Open the dedicated profile once:

```powershell
node scripts/open-sapo-automation-profile.mjs
```

2. Sign into Sapo inside that dedicated automation browser window once.
   The persistent automation profile is stored outside the repo under Local AppData so Playwright can use a space-free path reliably.

3. Probe whether the dedicated profile is ready:

```powershell
node scripts/probe-sapo-automation-session.mjs
```

4. Run the existing live browser executor through Playwright on that dedicated profile:

```powershell
node scripts/run-phone-order-playwright-live.mjs --request-id <id> --max-steps 1
```

Sequential queue runner for multiple ready orders:

```powershell
node scripts/run-phone-order-sequential-queue.mjs --limit 5
```

Notes:

- requests are processed oldest-first
- the runner handles one order at a time
- by default it stops before the final submit step by capping at step `10`
- add `--submit` only when you truly want the runner to continue through real order creation

Quick status view:

```powershell
node scripts/show-phone-order-execution-status.mjs
```

Refresh the prepared execution plan from queue state while preserving the current completed-step checkpoint:

```powershell
node scripts/refresh-phone-order-execution-state.mjs --request-id <id>
```

Current known live checkpoint:

- request id: `sample-0983087947-001`
- progress: `6/11`
- next step: `7 - set_customer_total`
- target total: `350000`

Reset browser execution state before starting over:

```powershell
node scripts/reset-phone-order-execution.mjs
```

Mark a step complete while testing manually:

```powershell
node scripts/execute-phone-order-browser.mjs --complete-step 1 --note "Opened create order page"
```

Clear a failed or completed step before retrying it:

```powershell
node scripts/execute-phone-order-browser.mjs --clear-step 3 --note "Retrying customer selection"
```

7. Record the final outcome:

```powershell
node scripts/record-phone-order-result.mjs --request-id <id> --status created --sapo-order-code SON12345 --sapo-order-url https://example --shipment-code ABC123 --carrier GHN --partner-status "Cho lay hang"
```

Example failure record:

```powershell
node scripts/record-phone-order-result.mjs --request-id <id> --status failed --message "GHN service was not available for this address."
```

## Operational defaults

- preferred carrier: `GHN`
- shipping fee payer: `shop`
- pickup shift: leave blank by default
- only use pickup shift when the admin note explicitly requests it
- COD defaults to the admin-entered total order value
- declared package value defaults to the admin-entered total order value

## Important local output files

- `data/phone-order-execution-plan.json`
- `data/phone-order-worker-output.json`
- `data/phone-order-worker-log.json`

These are generated runtime files and are intentionally not committed.

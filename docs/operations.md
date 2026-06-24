# Operations

## Goal

Run the phone-order flow in a script-first way so the common case does not require live AI reasoning.

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

6. Execute the generated plan in Sapo using the validated browser flow.

Current lightweight executor scaffold:

```powershell
node scripts/execute-phone-order-browser.mjs --dry-run
```

This does not automate Chrome yet. It prepares the final browser-facing checklist payload and marks the handoff point where live browser automation will plug in.

The live wiring now exists at code level through:

- `scripts/lib/chrome-phone-order-live-adapter.mjs`
- `scripts/lib/phone-order-browser-live-runner.mjs`
- `scripts/lib/phone-order-node-repl-live.mjs`

These are intended to be invoked from a Chrome-capable runtime such as the existing Node REPL browser session, not from a plain standalone Node process.

Recommended live entry from a Chrome-capable runtime:

- claim the working Sapo tab
- run `runClaimedSapoExecution(...)`
- limit early trials with `maxSteps`

Local smoke test for the live executor path without touching Chrome:

```powershell
node scripts/test-phone-order-browser-live-smoke.mjs
```

Quick status view:

```powershell
node scripts/show-phone-order-execution-status.mjs
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

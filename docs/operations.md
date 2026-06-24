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

5. Execute the generated bundle in Sapo using the validated browser flow.

6. Record the final outcome:

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

- `data/phone-order-worker-output.json`
- `data/phone-order-worker-log.json`

These are generated runtime files and are intentionally not committed.

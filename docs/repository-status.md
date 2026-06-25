# Repository Status

## Current status

This repository contains both planning artifacts and working implementation artifacts for the phone-order agent.

## What is already implemented

- Mobile-first dashboard at `apps/dashboard/`
- PWA shell and icons
- Shared queue storage and cross-device pending-status sync through the inbox bridge
- Product catalog search using exported Sapo product data
- Province, district, ward address selection using exported GHN master data
- Customer suggestion by phone number using local customer index data
- Local processing scripts that validate queue requests and build execution-ready payloads
- Script-first worker entry points for claiming ready requests and recording execution results
- Real shared inbox bridge in `integrations/google-apps-script/`
- Real Sapo Omni session-API order creation in `scripts/create-sapo-omni-order-from-request.mjs`
- GitHub Pages deployment workflow for the committed `site/` output

## What is already validated in practice

- Real mobile submission from the public dashboard into the shared inbox
- Real Sapo order creation through the Omni session API lane
- Real GHN shipping-record creation through Sapo
- Default business rule: do not choose pickup shift unless explicitly requested in the admin note

## Current live automation checkpoint

- The public dashboard is live at `https://tqsmarttools.github.io/agen-tao-don-hang/`.
- The mobile app now reads public product/address data and writes real requests into the shared inbox.
- Public devices refresh pending items again when the app returns to the foreground.
- The Sapo Omni session-API lane is now the preferred execution path for ready requests.
- The browser executor remains in the repo as a fallback and diagnostic lane, not the default production lane.

## Important local-only files

The following generated data is intentionally local and not committed:

- `data/customer-index.json`
- `data/ai-request-status.json`
- `data/phone-order-inbox.json`
- `data/ai-requests.json`
- `data/phone-order-processing-plan.json`
- `data/sapo-order-dry-run.json`
- `data/phone-order-config.json`

## Suggested reading order for future threads

1. `README.md`
2. `docs/mvp-scope.md`
3. `docs/data-sources.md`
4. `docs/real-world-findings.md`
5. `docs/operations.md`
6. `apps/dashboard/app.js`
7. `scripts/process-phone-order-requests.mjs`
8. `scripts/run-phone-order-worker.mjs`
9. `scripts/record-phone-order-result.mjs`

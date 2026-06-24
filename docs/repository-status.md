# Repository Status

## Current status

This repository contains both planning artifacts and working implementation artifacts for the phone-order agent.

## What is already implemented

- Mobile-first dashboard at `apps/dashboard/`
- PWA shell and icons
- Local queue storage in the browser
- Product catalog search using exported Sapo product data
- Province, district, ward address selection using exported GHN master data
- Customer suggestion by phone number using local customer index data
- Local processing scripts that validate queue requests and build dry-run Sapo order payloads
- Script-first worker entry points for claiming ready requests and recording execution results
- GitHub Pages deployment workflow for the committed `site/` output

## What is already validated in practice

- Real Sapo order creation through Chrome
- Real GHN shipping-record creation through Sapo
- Default business rule: do not choose pickup shift unless explicitly requested in the admin note

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

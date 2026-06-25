# agen-tao-don-hang

Mobile-first Sapo phone-order workflow and AI-assisted order creation agent for Thien Quang Smarttools.

## Current state

This repository is now beyond MVP planning and already supports a real operating flow.

It now includes:

- a working mobile-first dashboard that can run from GitHub Pages on iPhone and Android
- a shared inbox bridge so phone submissions sync across devices
- exported product, address, and customer-search data for the mobile UI
- a validated Sapo Omni session-API lane that creates real Sapo + GHN orders
- a browser automation fallback lane for live Sapo troubleshooting and recovery

## Main goal

Let an internal admin receive a direct phone call, capture the order quickly on a phone, and hand the request to an AI workflow that can validate the request and create the order in Sapo.

## Operating principles

- Admin works on mobile, not desktop.
- Dashboard never stores Sapo write credentials.
- Product selection must be fast: search by SKU or product name.
- Address entry must be guided: province, district, ward, then address detail.
- AI should validate in dry-run mode before real order creation.
- Pickup shift stays blank by default and is only selected when the admin note explicitly requests it.

## Repository map

- `apps/dashboard/` - mobile dashboard UI and local queue experience
- `scripts/` - local export, validation, inbox, and dry-run build scripts
- `scripts/` - local export, validation, worker, and execution-plan scripts
- `docs/` - scope, data contracts, and real-world operating notes
- `site/` - committed public site output used by GitHub Pages
- `integrations/google-apps-script/` - inbox bridge for queue handoff

## Recommended reading order

1. [Repository status](docs/repository-status.md)
2. [MVP scope](docs/mvp-scope.md)
3. [Data sources](docs/data-sources.md)
4. [Real-world findings](docs/real-world-findings.md)
5. [Operations](docs/operations.md)

## Important implementation notes

- The dashboard sends structured queue payloads instead of writing to Sapo directly.
- The preferred operational path is script-first: shared inbox -> local queue -> Sapo Omni session API.
- Browser automation remains available as a fallback lane when the session API lane needs troubleshooting or UI validation.
- The public mobile app never contains Sapo write credentials. It only talks to the inbox bridge.
- Real Sapo order creation plus GHN shipment creation has already been confirmed with this business flow.

## Mobile app access

The repository already includes a GitHub Pages workflow at `.github/workflows/deploy-pages.yml`.

The expected public dashboard URL is:

- `https://tqsmarttools.github.io/agen-tao-don-hang/`

Notes:

- GitHub Pages serves the committed `site/` artifact from branch `main`.
- Source changes are developed in the main workspace, then synced to the Pages worktree before publishing.
- The Pages root redirects to `./apps/dashboard/index.html`, so mobile users do not need to remember the longer dashboard path.

For home-screen install:

- Android Chrome: open the Pages URL, then use `Add to Home screen` / `Install app`
- iPhone Safari: open the Pages URL, then use `Share` -> `Add to Home Screen`

# agen-tao-don-hang

Mobile-first Sapo phone-order workflow and AI-assisted order creation agent for Thien Quang Smarttools.

## Current phase

This repository is in MVP definition phase.

The first goal is to let an admin open a phone-friendly dashboard, enter a direct phone order quickly, and send a structured request to an AI workflow that creates the order in Sapo.

## Core direction

- Admin works on mobile, not desktop.
- Dashboard never stores Sapo write credentials.
- Product selection must be fast: search by SKU or product name.
- Address entry must be guided: province, district, ward, then address detail.
- AI must validate data in dry-run mode before creating a real Sapo order.

## Initial docs

- [MVP scope](docs/mvp-scope.md)

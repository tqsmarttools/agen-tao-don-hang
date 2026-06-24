# Real-World Findings

## Tested state

As of 2026-06-24, the team has already validated one full browser-assisted Sapo + GHN order-creation flow in the live Sapo admin UI.

This matters because the repository is no longer only an MVP idea. The dashboard, local dry-run pipeline, and Chrome-assisted Sapo flow now have at least one confirmed end-to-end path.

## Confirmed successful flow

The following flow was completed successfully in Sapo:

1. Open `Tao don hang`.
2. Search customer by phone number.
3. If no customer exists, create a new customer in the modal.
4. Set shipping address in the same customer-creation flow.
5. Add products by SKU search.
6. Switch fulfillment mode to `Day qua hang van chuyen`.
7. Choose a GHN shipping service.
8. Align COD and declared package value with the final order total.
9. Confirm `Xac nhan tao don va giao hang`.
10. Reload once to confirm the partner status update.

Observed successful result:

- Sapo order was created successfully.
- Shipping record was created successfully.
- GHN status moved to `Cho lay hang` after reload.

## Rules that should remain stable

- Default behavior: do not select a pickup shift.
- Only select a pickup shift when the admin note explicitly asks for it.
- The admin-entered order total is the source of truth for what the customer must pay.
- The admin UI does not need to show stock or public-facing price logic.
- Customer phone number should be entered first so old customer suggestions can appear quickly.

## GHN-specific operating rule

For the intended phone-order workflow:

- default shipping payer: shop
- default pickup shift: leave blank
- default exception path: admin note

If the admin writes an instruction such as `ca lay hang`, `ca lay`, or another explicit pickup-shift note, the AI/browser automation should treat that as a manual shipping instruction and then choose the shift intentionally.

## Sapo UI lessons

### Customer flow

- Customer creation is a separate modal from the main order screen.
- Phone lookup should happen before creating a new customer.
- Address fields must be filled correctly in province, district, ward, and detail order.

### Product flow

- SKU search is reliable enough for the intended dashboard workflow.
- For shorthand requests, matching from short SKU fragments is still useful, but the final payload should keep stable variant IDs and full SKU values.

### Shipping flow

- `Day qua hang van chuyen` exposes carrier-specific shipping controls.
- GHN service selection can be completed inside the order page.
- Carrier status may appear as an in-flight sync first, then settle after reload.

### Submit flow

- The page can show duplicate `Tao don va duyet (F1)` buttons.
- Browser automation should target the correct visible action in context instead of assuming a unique button instance.
- A confirmation modal appears before final order creation.

## Browser/automation notes

- The Codex Chrome extension must be attached to the Chrome profile that actually contains the working Sapo session.
- In this workspace, the validated profile has been `Profile 5`.
- If Chrome restarts into another profile, browser attachment can fail even when Chrome itself is open.

## Example shorthand interpretation

Example shorthand:

- `V25, t30`
- `Thanh Son, Minh Tien, Ngoc Lac, Thanh Hoa`
- `A. Muoi`
- `0388504960`
- `150k bao ship`

Current interpretation rules:

- each shorthand SKU means quantity `1` unless another quantity is written
- `V25` can map to `BCR-I-V25`
- `T30` should prefer `BCR-I-T30`, with `BCR-T30` as fallback if needed
- address should be normalized to commune, district, province, then detail
- total `150k bao ship` means customer-facing final total already includes shipping

## Repository implications

Future threads should treat this repository as:

- a mobile dashboard project
- a local dry-run validation pipeline
- a browser-runbook for real Sapo order creation

Do not re-open the pickup-shift default behavior unless the business rule changes.

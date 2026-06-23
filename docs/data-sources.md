# Data sources

## Step 2 goal

Prepare the first local data exports that the mobile dashboard will depend on.

## Product catalog

Source:

- Sapo Admin API

Output:

- `data/product-catalog.json`

Export script:

- `scripts/export-product-catalog.ps1`

Current catalog shape:

- `schema`
- `exported_at`
- `product_count`
- `variant_count`
- `items[]`

Each item includes:

- `variant_id`
- `product_id`
- `sku`
- `barcode`
- `product_name`
- `variant_name`
- `display_name`
- `keywords[]`
- `active`

## Address catalog

Source:

- GHN master-data endpoints

Output:

- `data/address-catalog.json`

Export script:

- `scripts/export-address-catalog.mjs`

Expected hierarchy:

- provinces
- districts keyed by province
- wards keyed by district

## Customer index

Source:

- GHN delivery history
- Sapo order or customer history where accessible

Output:

- `data/customer-index.json`

Export script:

- `scripts/export-customer-index.mjs`

Expected lookup key:

- normalized phone number

Expected fields:

- `phone`
- `customer_name`
- `order_count`
- `last_order_at`
- `addresses[]`

## Notes

- Product catalog is the first export because it is already accessible through the current Sapo API connection.
- Address catalog and customer index should follow after source availability is confirmed and normalized.

## Inbox and status flow

Dashboard queue can now be sent to a Google Apps Script inbox.

Local files:

- `data/phone-order-config.example.json`
- `data/ai-request-status.json`

Local scripts:

- `scripts/fetch-phone-order-inbox.mjs`
- `scripts/import-phone-order-requests.mjs`
- `scripts/update-phone-order-status.mjs`

Apps Script template:

- `integrations/google-apps-script/ai-inbox/`

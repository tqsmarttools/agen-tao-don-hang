# MVP scope

## Goal

Build the first working version of a mobile-first dashboard for direct phone orders.

An admin should be able to receive a customer call, enter the order on a phone, and send a structured request to an AI workflow that creates the order in Sapo.

## Primary user

- Internal admin at Thien Quang Smarttools

## Main use case

1. Customer calls the shop directly.
2. Admin opens the dashboard on a phone.
3. Admin enters customer phone number first.
4. System tries to suggest an existing customer profile by phone number.
5. Admin confirms or edits customer name and address.
6. Admin searches and selects one or more products.
7. Admin enters quantity for each selected product.
8. Admin enters total order value including shipping.
9. Admin adds optional notes, including any exceptional shipping instruction.
10. Admin sends the request to the AI queue.
11. AI validates the request in dry-run mode.
12. If valid, AI creates the order in Sapo.

## In scope for MVP

- Mobile-friendly dashboard UI
- Customer phone number input
- Existing customer suggestion by phone number
- Existing address suggestion when available
- Address selection by province, district, and ward
- Address detail input for hamlet, alley, house number, or street
- Product search by SKU and product name
- Multi-product selection
- Quantity input per selected product
- Total order value input
- Optional order note
- Default shipping flow leaves pickup shift unselected
- Pickup shift is only selected when the admin note explicitly requests it
- Structured queue payload for AI processing
- Dry-run validation before real Sapo order creation
- Status tracking for queue items

## Out of scope for MVP

- Real-time stock display
- Product price display in the admin UI
- Discount engine in the mobile UI
- Customer self-service flow
- Public checkout flow
- Automated shipping fee calculation
- Full order editing after creation
- Payment gateway integration
- Automatic pickup-shift selection without an explicit admin note

## Required data sources

### Product catalog

The dashboard needs a product dataset with:

- `variant_id`
- `sku`
- `product_name`
- searchable keywords

### Address catalog

The dashboard needs address data for:

- province
- district
- ward
- matching codes if needed for downstream integrations

### Customer index

The dashboard needs a customer lookup index keyed by normalized phone number.

Preferred fields:

- `phone`
- `customer_name`
- `last_order_at`
- `order_count`
- recent addresses

## Queue payload

The dashboard should send a structured payload similar to:

```json
{
  "schema": "tq-sapo-phone-order-request/v1",
  "requested_at": "2026-06-23T10:00:00Z",
  "customer": {
    "phone": "09xxxxxxxx",
    "name": "Customer name"
  },
  "address": {
    "province": "Tinh",
    "district": "Huyen",
    "ward": "Xa",
    "address_detail": "So nha, thon, ap, duong"
  },
  "items": [
    {
      "variant_id": 123,
      "sku": "BCR-V30",
      "name": "Bay cat ron vuong 30",
      "quantity": 2
    }
  ],
  "order_total_including_shipping": 350000,
  "note": "Optional admin note. Use this only for exceptional instructions such as a requested pickup shift.",
  "admin_directives": {
    "shipping": {
      "requires_manual_pickup_shift": false,
      "requested_pickup_shift_note": ""
    }
  }
}
```

## MVP workflow states

- `pending_ai`: admin submitted the request
- `need_more_info`: AI cannot proceed without more data
- `ready`: request passed validation
- `created`: Sapo order created successfully
- `failed`: creation failed and needs review

## Validation rules for MVP

- Phone number is required
- At least one product is required
- Every selected product must have a quantity greater than zero
- Total order value is required
- Province, district, and ward are required
- Address detail is required
- Queue payload must contain stable product identifiers, not just free text names

## UX requirements

- Fast on mobile
- Large tap targets
- Minimal typing
- Search-first product selection
- One clear submit action
- Strong visibility of selected items and quantities
- Easy reuse of old customer address data

## Security rules

- No Sapo write token in the dashboard
- No direct browser-to-Sapo write flow from mobile
- Sensitive customer data must stay in protected storage or encrypted dashboard data
- Real Sapo creation must happen only in the AI or server-side workflow
- Every real create action must be logged

## Acceptance criteria

- Admin can enter a phone order on a phone without using a desktop
- Admin can select more than one product in a single order
- Admin can search products by a short SKU fragment such as `V30`
- Admin can reuse an old customer address when a phone match exists
- The dashboard sends one structured request object to the AI queue
- The AI workflow can distinguish valid requests from incomplete requests
- The workflow can report whether an order is pending, needs more info, created, or failed

## Step 1 output

Step 1 is complete when this MVP scope is stable enough that Step 2 can begin:

- prepare product catalog data
- prepare address catalog data
- decide how to build the customer phone index

# Endpoints

All non-auth endpoints require `Authorization: Bearer <accessToken>`.
Roles: `ADMIN` > `MANAGER` > `CASHIER`. "Manager+" means ADMIN or MANAGER.

## Auth

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | public | Staff login (any role). Returns `{ accessToken, refreshToken }` |
| POST | `/api/auth/refresh` | public | Rotate session with `{ refreshToken }` |
| POST | `/api/auth/logout` | auth | Revokes refresh token, emits `session:revoked` |
| GET | `/api/auth/me` | auth | Current staff profile |
| POST | `/api/auth/override` | auth | Manager PIN approval. `{ pin }` → `{ overrideToken, manager }` (token valid ~5 min) |
| POST | `/api/auth/admin/login` | public | Legacy alias — only ADMIN role may log in |
| POST | `/api/auth/admin/refresh` | public | Legacy alias |
| POST | `/api/auth/admin/logout` | auth | Legacy alias |
| GET | `/api/auth/admin/me` | auth | Legacy alias |

### Manager override (step-up auth)

Sensitive actions stay open to cashiers but require a manager's approval:

1. ADMIN sets a manager PIN once: `POST /api/users/:managerId/pin` with `{ pin }` (4-8 digits).
2. When a cashier triggers a sensitive action, the terminal calls `POST /api/auth/override`
   with `{ pin }` and receives a short-lived `overrideToken`.
3. The cashier retries the action with header `X-Override-Token: <overrideToken>`.
   The authorized manager's id is recorded on the action (`authorizedBy`).

Currently override-gated:

- `POST /api/orders/:id/void` — managers pass directly; cashiers need the header.
- Checkout discounts above `DISCOUNT_OVERRIDE_CENTS` (disabled when unset/0).

## Users (ADMIN only)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/users` | ADMIN | Query: `page, pageSize, q, role, isActive` |
| POST | `/api/users` | ADMIN | `{ email, password, name, role }` — duplicate email → 409 |
| PATCH | `/api/users/:id` | ADMIN | `{ name?, role?, isActive? }`. Deactivating clears the refresh token. Self-demotion and removing the last active admin are blocked |
| POST | `/api/users/:id/reset-password` | ADMIN | Sets a new password and revokes active sessions |
| POST | `/api/users/:id/pin` | ADMIN | `{ pin }` (4-8 digits) for manager override; MANAGER/ADMIN only |

## Health

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | `{ status, database, cache, queue, generatedAt }` |
| GET | `/api/hello` | public | Query: `name?`. Returns `{ message, timestamp }` |

## Products

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/products` | auth | Query: `page, pageSize, q, categoryId, activeOnly, sort` |
| GET | `/api/products/:id` | auth | |
| GET | `/api/products/:id/movements` | auth | Stock movement ledger |
| POST | `/api/products` | manager+ | Unique `sku`/`barcode` enforced |
| PUT | `/api/products/:id` | manager+ | |
| POST | `/api/products/:id/adjust-stock` | manager+ | `{ delta, reason: PURCHASE\|ADJUST\|REFUND, note? }` |
| DELETE | `/api/products/:id` | manager+ | Soft delete (`isActive: false`) |

## Categories

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/categories` | auth | Paginated with product counts |
| GET | `/api/categories/:id` | auth | |
| POST | `/api/categories` | manager+ | Unique name |
| PUT | `/api/categories/:id` | manager+ | |
| DELETE | `/api/categories/:id` | manager+ | Blocked while products are attached |

## Customers

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/customers` | auth | Query: `page, pageSize, q` (name/phone/email) |
| GET | `/api/customers/:id` | auth | Includes last 10 orders |
| POST | `/api/customers` | manager+ | Unique phone |
| PUT | `/api/customers/:id` | manager+ | |
| DELETE | `/api/customers/:id` | manager+ | Orders keep history (`customerId` nullified) |
| POST | `/api/customers/:id/loyalty` | manager+ | `{ delta }` (int, non-zero) |

## Shifts & Cash Drawer

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/shifts/open` | auth | Open shift. Body: `{ openingFloat: [{ denomination, count }], note? }`. Returns the raw shift (`201`) |
| POST | `/api/shifts/close` | auth | Close caller's open shift. Body: `{ closingFloat: [{ denomination, count }], note? }`. Returns the raw shift (`200`), `404` when none open |
| GET | `/api/shifts/current` | auth | Get current user's open shift — raw shift or `null` (`200`) |
| GET | `/api/shifts` | auth | Query: `page, pageSize, userId, status, from, to`. Cashiers see only their own shifts |
| GET | `/api/shifts/:id` | auth | Shift detail with cash counts |
| GET | `/api/shifts/reports/z` | manager+ | Z-reports. Query: `page, pageSize, storeId, from, to` |
| GET | `/api/shifts/reports/z/:id` | manager+ | Z-report detail |

Open/close float format (denominations in cents):
```json
{ "openingFloat": [{ "denomination": 10000, "count": 5 }, { "denomination": 5000, "count": 10 }] }
```

## Orders (checkout)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/orders` | auth | Checkout. Send `Idempotency-Key` header (8-128 chars) to protect against doubles |
| GET | `/api/orders` | auth | Query: `page, pageSize, status, cashierId, from, to`. Cashiers are scoped to their own orders |
| GET | `/api/orders/:id` | auth | Includes items, payments, cashier, customer |
| POST | `/api/orders/:id/void` | override | Manager+ directly; cashiers need `X-Override-Token`. Restores stock, marks order VOID |
| POST | `/api/orders/:id/refund` | override | Manager+ directly; cashiers need `X-Override-Token`. Partial line-level refunds, restores stock, creates refund payment |
| GET | `/api/orders/:id/receipt` | auth | Query: `format=pdf|escpos` (default: pdf). Returns receipt file download |

Checkout request body:

```json
{
  "items": [{ "productId": "<uuid>", "quantity": 2 }],
  "payments": [{ "method": "CASH", "amountCents": 2500 }],
  "customerId": "<optional uuid>",
  "discountCents": 0,
  "note": "optional"
}
```

Response `201`:

```json
{
  "order": { "id": "...", "orderNumber": "ORD-20260101-AB12CD", "totalCents": 2160, "...": "..." },
  "changeCents": 340
}
```

Stock is decremented inside the same transaction that creates the order; if any item lacks stock, the whole checkout fails with `422 INSUFFICIENT_STOCK` and nothing is persisted.

Refund request body:

```json
{
  "lines": [{ "orderItemId": "<uuid>", "quantity": 1 }],
  "paymentMethod": "CASH",
  "reference": "optional external refund ID",
  "note": "optional reason"
}
```

Response `200`:

```json
{
  "order": { "id": "...", "orderNumber": "ORD-20260101-AB12CD", "status": "PAID", "totalCents": 2160, "...": "..." },
  "refundAmountCents": 1080,
  "refundedLines": [{ "orderItemId": "<uuid>", "quantity": 1, "amountCents": 1080 }]
}
```

Refunds are processed in a transaction: stock is restored, `StockMovement` records with `REFUND` reason are created, and a negative `Payment` record is added. The order status becomes `REFUNDED` when the cumulative refunded amount equals or exceeds the order total; otherwise it remains `PAID` (partial refund). Only `PAID` orders can be refunded (not `VOID` or already `REFUNDED`). Refund quantity per line cannot exceed the originally sold quantity minus any previously refunded quantity.

Receipt request:
```
GET /api/orders/:id/receipt?format=pdf
```

Response `200`: Binary file download (PDF or ESC/POS text stream)
- `Content-Type: application/pdf` (for pdf) or `application/octet-stream` (for escpos)
- `Content-Disposition: attachment; filename="receipt-ORD-20260101-AB12CD.pdf"`

The receipt includes store info, order details, line items with prices, totals, payment breakdown, and refund details (when applicable).

## Reports (manager+)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/reports/sales/daily` | manager+ | Query: `date=YYYY-MM-DD` |
| GET | `/api/reports/sales/summary` | manager+ | Query: `from`, `to` (ISO timestamps) |

## Realtime (Socket.IO)

- Handshake requires a valid access token (`SOCKET_AUTH_REQUIRED=true`):
  `io(url, { auth: { token: accessToken } })`
- On connect the client auto-joins `user:{id}`
- `join:store` → joins `store:{id}` (or `store:default` when omitted)
- Emitted by the API: `order:created`, `order:voided`, `stock:low` (via worker → Redis pub/sub), `report:daily:completed`, `session:revoked`
- Template events remain: `socket:welcome`, `ping`/`pong`, `join:room`, `leave:room`, `broadcast:room`

# Confirm Dispatch Edge Function

## Overview
This Edge Function confirms a draft dispatch order by:
1. Checking if the dispatch is already confirmed (idempotent)
2. Fetching all dispatch items
3. Calculating raw material consumption via BOM
4. Validating sufficient stock
5. Creating stock transaction records (negative quantities)
6. Generating a unique challan number
7. Updating dispatch status to 'confirmed'
8. Sending Telegram alerts for low stock items

## Deployment

```bash
# Deploy the function
supabase functions deploy confirm-dispatch

# Set required environment variables (if not already set)
supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token_here
```

## API Request

**Endpoint:** `POST /functions/v1/confirm-dispatch`

**Headers:**
- `Authorization: Bearer <supabase_anon_key>`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "dispatch_order_id": "uuid-here"
}
```

## Response Examples

### Success (First Time)
```json
{
  "success": true,
  "challan_number": "CHAL-20260527-0001",
  "consumed": [
    {
      "material": "Steel Rods",
      "qty": "25.50",
      "unit": "kg"
    },
    {
      "material": "Paint",
      "qty": "2.00",
      "unit": "liters"
    }
  ]
}
```

### Success (Already Confirmed - Idempotent)
```json
{
  "success": true,
  "message": "Already confirmed",
  "challan_number": "CHAL-20260527-0001",
  "consumed": []
}
```

### Error (Insufficient Stock)
```json
{
  "success": false,
  "error": "Insufficient stock",
  "material": "Steel Rods",
  "shortfall": "5.50",
  "unit": "kg"
}
```

### Error (Not Found)
```json
{
  "success": false,
  "error": "Dispatch order not found"
}
```

## Database Transaction

The function uses a Postgres stored procedure `confirm_dispatch_transaction` to ensure atomicity:
- All stock transactions are inserted
- Challan sequence is incremented
- Dispatch order status is updated
- All in one atomic transaction - if any step fails, all are rolled back

## Telegram Alerts

After successful confirmation, the function checks each consumed material's stock level. If any material falls below its `min_stock_level`, a Telegram alert is sent to the tenant's configured chat ID:

```
🚨 Low Stock Alert — Company Name

After dispatch CHAL-20260527-0001:

• Steel Rods: 15.00 kg (min: 20.00 kg)
• Paint: 3.50 liters (min: 5.00 liters)

📅 27/05/2026, 4:30:00 pm
```

## Prerequisites

1. **Database Tables:**
   - `p2_dispatch_orders`
   - `p2_dispatch_items`
   - `p2_products`
   - `p2_product_bom`
   - `p2_raw_materials`
   - `p2_stock_transactions`
   - `p2_tenant_settings` (with `challan_sequence` column)

2. **Database Function:**
   - `confirm_dispatch_transaction(p_dispatch_order_id, p_tenant_id, p_consumption_json)`

3. **Environment Variables:**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN` (optional, for alerts)

## Testing

```bash
# Test with curl (replace values)
curl -X POST https://your-project.supabase.co/functions/v1/confirm-dispatch \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dispatch_order_id": "uuid-here"}'
```

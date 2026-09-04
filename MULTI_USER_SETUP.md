# Multi-User Support Setup Guide

## Overview
This guide explains how to set up multi-user support for Nexflow P2. Owners can invite staff members to their tenant with role-based permissions.

## Step 1: Database Schema Setup

Run the following SQL in your Supabase SQL Editor:

```sql
-- Create p2_user_roles table
CREATE TABLE p2_user_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES p2_tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
    invited_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tenant_id)
);

-- Enable RLS
ALTER TABLE p2_user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see roles in their tenant
CREATE POLICY "Users can view their tenant roles"
    ON p2_user_roles FOR SELECT
    USING (
        user_id = auth.uid() 
        OR tenant_id IN (
            SELECT tenant_id FROM p2_user_roles WHERE user_id = auth.uid()
        )
    );

-- Policy: Only owners can insert staff roles
CREATE POLICY "Owners can invite staff"
    ON p2_user_roles FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM p2_user_roles
            WHERE user_id = auth.uid()
            AND tenant_id = p2_user_roles.tenant_id
            AND role = 'owner'
        )
    );

-- Policy: Only owners can delete staff
CREATE POLICY "Owners can remove staff"
    ON p2_user_roles FOR DELETE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM p2_user_roles
            WHERE user_id = auth.uid() AND role = 'owner'
        )
    );

-- Create indexes for faster lookups
CREATE INDEX idx_user_roles_user_id ON p2_user_roles(user_id);
CREATE INDEX idx_user_roles_tenant_id ON p2_user_roles(tenant_id);

-- Migrate existing owners to p2_user_roles
-- This assumes tenant_id is stored in auth.users.raw_user_meta_data
INSERT INTO p2_user_roles (user_id, tenant_id, role)
SELECT 
    id as user_id,
    (raw_user_meta_data->>'tenant_id')::uuid as tenant_id,
    'owner' as role
FROM auth.users
WHERE raw_user_meta_data->>'tenant_id' IS NOT NULL
ON CONFLICT (user_id, tenant_id) DO NOTHING;
```

## Step 2: Deploy Edge Functions

Deploy the following Edge Functions to Supabase:

### 2.1 Deploy invite-staff function
```bash
cd supabase/functions
supabase functions deploy invite-staff
```

### 2.2 Deploy get-user-email function
```bash
supabase functions deploy get-user-email
```

## Step 3: New User → Tenant Assignment (automatic, no setup needed)

There used to be a `handle-new-user` Edge Function here, wired up via a Supabase Auth webhook
(`user.created` → an unauthenticated HTTP endpoint that inserted `(user_id, tenant_id, role)` with
the service role key, trusting whatever the request body claimed). It was deleted — a POST with a
forged `tenant_id`/`role` in the body granted the caller `owner` access to any tenant, with no
signature check, no ownership check, and no role whitelist. It was also redundant: this exact job
is already done correctly by the `public.handle_new_user()` **database trigger**
(`on_auth_user_created`, see `supabase/migrations/20260803_pending_invites_and_role_fixes.sql`),
which fires automatically on `auth.users` insert and reads `tenant_id`/`role` from the new user's
metadata server-side, inside Postgres — nothing to deploy, configure, or point a webhook at.

Do not recreate the Edge Function or the Auth webhook. If a staff member isn't landing in the
right tenant after accepting an invite, the trigger is what to check (see Troubleshooting below),
not a webhook.

## Step 4: Set Environment Variables

In your Supabase project, set the following environment variables for Edge Functions:

1. Go to Supabase Dashboard → Edge Functions → Settings
2. Add:
   - `SITE_URL`: Your production site URL (e.g., `https://nexflow-p2.vercel.app`)

## Step 5: Update RLS Policies for Other Tables

Update RLS policies for all `p2_*` tables to use `p2_user_roles` instead of checking `user_metadata.tenant_id`:

```sql
-- Example: Update p2_raw_materials RLS policies
DROP POLICY IF EXISTS "Users can view their own raw materials" ON p2_raw_materials;

CREATE POLICY "Users can view their tenant raw materials"
    ON p2_raw_materials FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM p2_user_roles WHERE user_id = auth.uid()
        )
    );

-- Repeat similar updates for:
-- p2_suppliers, p2_stock_transactions, p2_products, p2_product_bom, 
-- p2_dispatch_orders, p2_dispatch_items, p2_tenant_settings
```

## Step 6: Test the Setup

1. **As Owner:**
   - Login to your account
   - Go to Settings → Staff tab
   - Enter a staff email and select role
   - Click "Send Invite"

2. **As Staff:**
   - Check email for invite
   - Click the invite link
   - Set password
   - Login and verify access:
     - ✅ Can view dashboard
     - ✅ Can do GRN
     - ❌ Cannot access Settings tab
     - ❌ Cannot see delete buttons

## Role Permissions

### Owner
- Full access to all features
- Can invite and remove staff
- Can access Settings
- Can delete records

### Staff
- Can view dashboard
- Can perform GRN (receive materials)
- Can view dispatch
- Cannot access Settings
- Cannot delete records

## Troubleshooting

### Staff not added to tenant after accepting invite
- Check that the `public.handle_new_user()` database trigger exists and is attached to
  `auth.users` (`SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';`)
- Check Supabase Postgres logs for trigger errors
- Verify that `tenant_id` is being passed in user metadata

### "Unauthorized" error when inviting staff
- Verify that the inviting user has `role='owner'` in `p2_user_roles`
- Check that Edge Functions have correct environment variables

### Staff sees "owner-only" elements
- Ensure `auth.js` is loaded before any page logic
- Check browser localStorage for `user_role` value
- Verify `applyRoleVisibility()` is called after DOM loads

## Security Notes

1. **Never expose service role key** in frontend code
2. **Always validate user roles** server-side (Edge Functions)
3. **Use RLS policies** to enforce data isolation
4. **Staff invites should only be sent by owners** (enforced via Edge Function)

## Files Modified

- `settings.html` - Added Staff Management tab
- `js/auth.js` - Added role fetching and storage
- `js/navbar.js` - Added user info display
- `supabase/functions/invite-staff/index.ts` - Edge Function to invite staff
- `supabase/functions/get-user-email/index.ts` - Edge Function to fetch user emails

## Next Steps

1. Update all other HTML pages to include navbar with user info
2. Add role checks to all delete/edit operations
3. Test thoroughly with multiple users
4. Consider adding audit logging for staff actions

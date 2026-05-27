-- Migration: Add telegram_chat_id to p2_tenant_settings
-- Date: 2026-05-26
-- Purpose: Store Telegram chat ID for low stock alerts

-- Add telegram_chat_id column to p2_tenant_settings
ALTER TABLE p2_tenant_settings
ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- Add comment for documentation
COMMENT ON COLUMN p2_tenant_settings.telegram_chat_id IS 'Telegram chat ID for receiving low stock alerts';

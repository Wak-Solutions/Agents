-- Add customer_email column to meetings table
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS customer_email TEXT;

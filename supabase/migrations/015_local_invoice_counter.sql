-- Separate bill numbers for local / no-GST sales (LOC-0001) vs GST sales (SSA-0001)

ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS local_invoice_prefix TEXT NOT NULL DEFAULT 'LOC',
  ADD COLUMN IF NOT EXISTS next_local_invoice_number INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN shop_settings.local_invoice_prefix IS
  'Prefix for fully local (no-GST) sales bills — separate from GST invoice_prefix.';
COMMENT ON COLUMN shop_settings.next_local_invoice_number IS
  'Next sequence number for local sales bills.';

CREATE OR REPLACE FUNCTION next_local_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  prefix TEXT;
  num INT;
  result TEXT;
BEGIN
  SELECT COALESCE(local_invoice_prefix, 'LOC'), COALESCE(next_local_invoice_number, 1)
    INTO prefix, num
  FROM shop_settings WHERE id = 'default' FOR UPDATE;
  result := prefix || '-' || LPAD(num::TEXT, 4, '0');
  UPDATE shop_settings
    SET next_local_invoice_number = num + 1, updated_at = NOW()
  WHERE id = 'default';
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION next_local_invoice_number() TO authenticated;

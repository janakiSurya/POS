-- Extra purchase line fields from supplier invoices
ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS disc2_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS raw_data JSONB;

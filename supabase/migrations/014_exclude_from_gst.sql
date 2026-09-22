-- Local / non-GST purchases and products (books only, exclude from GST reports)

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS exclude_from_gst BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN purchase_invoices.exclude_from_gst IS
  'True for local/unregistered buys: shown in shop records but excluded from GST purchase reports.';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS exclude_from_gst BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.exclude_from_gst IS
  'True for local/loose stock: exclude related sales from GST sales reports when reporting.';

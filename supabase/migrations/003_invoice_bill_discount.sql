-- Bill-level discount on invoices (mutually exclusive with per-line discounts in app logic)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bill_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

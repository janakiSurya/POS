-- Production POS initial schema
-- Run in Supabase SQL editor or via CLI

-- Shop settings (single row)
CREATE TABLE IF NOT EXISTS shop_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'Sri Sri Satya Sai Automobile Agency',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  invoice_prefix TEXT NOT NULL DEFAULT 'SSA',
  next_invoice_number INT NOT NULL DEFAULT 1,
  thank_you_line TEXT DEFAULT 'Thank you — visit again',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shop_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- Profiles linked to auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')) DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50),
  vehicle_compatibility TEXT[] DEFAULT '{}',
  purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_quantity INT NOT NULL DEFAULT 0,
  min_stock_alert INT NOT NULL DEFAULT 5,
  rack_location VARCHAR(20),
  brand VARCHAR(50),
  uom VARCHAR(10) DEFAULT 'PCS',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(15) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  gstin TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Register sessions (one OPEN per business_date IST)
CREATE TABLE IF NOT EXISTS register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC(10,2) NOT NULL,
  opening_upi NUMERIC(10,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(10,2),
  closing_upi NUMERIC(10,2),
  expected_cash NUMERIC(10,2),
  expected_upi NUMERIC(10,2),
  cash_variance NUMERIC(10,2),
  upi_variance NUMERIC(10,2),
  status VARCHAR(20) NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  closed_by UUID REFERENCES profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_register_one_open_per_day
  ON register_sessions (business_date)
  WHERE status = 'OPEN';

-- Cash expenses
CREATE TABLE IF NOT EXISTS cash_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sales invoices
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  session_id UUID NOT NULL REFERENCES register_sessions(id),
  customer_id UUID REFERENCES customers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_amount NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CREDIT')),
  staff_id UUID NOT NULL REFERENCES profiles(id),
  synced BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  line_total NUMERIC(10,2) NOT NULL
);

-- Purchase invoices
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'PENDING_APPROVAL')) DEFAULT 'DRAFT',
  total_amount NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  part_number TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL,
  cost_update_decision TEXT CHECK (cost_update_decision IN ('APPLIED', 'KEPT_OLD', 'PENDING', 'SAME')) DEFAULT 'SAME',
  line_no INT NOT NULL DEFAULT 1
);

-- Atomic stock reduction
CREATE OR REPLACE FUNCTION reduce_stock(p_product_id UUID, p_qty INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated INT;
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity - p_qty,
      updated_at = NOW()
  WHERE id = p_product_id AND stock_quantity >= p_qty;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- Increase stock on purchase
CREATE OR REPLACE FUNCTION increase_stock(p_product_id UUID, p_qty INT, p_new_cost NUMERIC, p_apply_cost BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + p_qty,
      purchase_price = CASE WHEN p_apply_cost THEN p_new_cost ELSE purchase_price END,
      updated_at = NOW()
  WHERE id = p_product_id;
END;
$$;

-- Next invoice number
CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  prefix TEXT;
  num INT;
  result TEXT;
BEGIN
  SELECT invoice_prefix, next_invoice_number INTO prefix, num
  FROM shop_settings WHERE id = 'default' FOR UPDATE;
  result := prefix || '-' || LPAD(num::TEXT, 4, '0');
  UPDATE shop_settings SET next_invoice_number = num + 1, updated_at = NOW() WHERE id = 'default';
  RETURN result;
END;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

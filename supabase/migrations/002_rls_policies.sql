-- Row Level Security policies

ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_lines ENABLE ROW LEVEL SECURITY;

-- Helper: current user role
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'owner' FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Profiles: users read own; owner reads all
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_owner());

CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- Shop settings: all authenticated read; owner update
CREATE POLICY shop_read ON shop_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY shop_update ON shop_settings FOR UPDATE TO authenticated USING (is_owner());

-- Products: staff sees without purchase_price via view; full table for owner
CREATE POLICY products_owner_all ON products FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY products_staff_select ON products FOR SELECT TO authenticated
  USING (NOT is_owner());

CREATE POLICY products_staff_update_stock ON products FOR UPDATE TO authenticated
  USING (NOT is_owner())
  WITH CHECK (NOT is_owner());

-- Staff insert for new parts during purchase flow handled by owner policies
-- For staff POS: they only need read + stock update via RPC

-- Customers
CREATE POLICY customers_all ON customers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Suppliers & purchases: owner only
CREATE POLICY suppliers_owner ON suppliers FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY purchase_invoices_owner ON purchase_invoices FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY purchase_lines_owner ON purchase_lines FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

-- Register sessions: all authenticated
CREATE POLICY register_all ON register_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Cash expenses
CREATE POLICY expenses_all ON cash_expenses FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Invoices
CREATE POLICY invoices_all ON invoices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY invoice_items_all ON invoice_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Staff product read: hide purchase_price in app layer for staff
-- RLS allows read; frontend filters cost fields for staff role

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE register_sessions;

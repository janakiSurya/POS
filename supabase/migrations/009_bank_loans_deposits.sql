-- Bank account, loans, cash/UPI deposits, supplier payments

CREATE TABLE IF NOT EXISTS lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id UUID NOT NULL REFERENCES lenders(id) ON DELETE RESTRICT,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('RECEIVED', 'REPAID')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL,
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposited_on DATE NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_deposit_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_deposit_id UUID NOT NULL REFERENCES cash_deposits(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (cash_deposit_id, business_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_deposit_days_business_date
  ON cash_deposit_days (business_date);

CREATE TABLE IF NOT EXISTS upi_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  note TEXT
);

CREATE TABLE IF NOT EXISTS bank_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL,
  entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN (
    'LOAN_IN', 'LOAN_OUT', 'UPI_DEPOSIT', 'CASH_DEPOSIT', 'SUPPLIER_PAYMENT'
  )),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
  note TEXT,
  lender_id UUID REFERENCES lenders(id),
  loan_entry_id UUID REFERENCES loan_entries(id),
  supplier_id UUID REFERENCES suppliers(id),
  purchase_invoice_id UUID REFERENCES purchase_invoices(id),
  cash_deposit_id UUID REFERENCES cash_deposits(id),
  upi_deposit_id UUID REFERENCES upi_deposits(id),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_ledger_entry_date ON bank_ledger (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_loan_entries_lender ON loan_entries (lender_id, entry_date);

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_payment_status_check'
  ) THEN
    ALTER TABLE purchase_invoices
      ADD CONSTRAINT purchase_invoices_payment_status_check
      CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID'));
  END IF;
END $$;

-- RLS: owner-only money tables
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_deposit_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE upi_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY lenders_owner ON lenders FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY loan_entries_owner ON loan_entries FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY cash_deposits_owner ON cash_deposits FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY cash_deposit_days_owner ON cash_deposit_days FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY upi_deposits_owner ON upi_deposits FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY bank_ledger_owner ON bank_ledger FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

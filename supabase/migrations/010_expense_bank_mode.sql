-- Expenses paid via bank: daily cash_expenses + monthly fixed_cost_logs
-- also write bank_ledger EXPENSE (OUT).

-- cash_expenses.payment_mode: allow BANK
ALTER TABLE cash_expenses DROP CONSTRAINT IF EXISTS cash_expenses_payment_mode_check;
ALTER TABLE cash_expenses
  ADD CONSTRAINT cash_expenses_payment_mode_check
  CHECK (payment_mode IN ('CASH', 'UPI', 'BANK'));

COMMENT ON COLUMN cash_expenses.payment_mode IS
  'CASH/UPI reduce till expected; BANK deducts bank_ledger only.';

-- fixed_cost_logs: how monthly expense was paid
ALTER TABLE fixed_cost_logs
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(10);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_cost_logs_payment_mode_check'
  ) THEN
    ALTER TABLE fixed_cost_logs
      ADD CONSTRAINT fixed_cost_logs_payment_mode_check
      CHECK (payment_mode IS NULL OR payment_mode IN ('CASH', 'UPI', 'BANK'));
  END IF;
END $$;

-- bank_ledger: EXPENSE type + optional links
ALTER TABLE bank_ledger DROP CONSTRAINT IF EXISTS bank_ledger_entry_type_check;
ALTER TABLE bank_ledger
  ADD CONSTRAINT bank_ledger_entry_type_check
  CHECK (entry_type IN (
    'LOAN_IN', 'LOAN_OUT', 'UPI_DEPOSIT', 'CASH_DEPOSIT',
    'SUPPLIER_PAYMENT', 'EXPENSE'
  ));

ALTER TABLE bank_ledger
  ADD COLUMN IF NOT EXISTS cash_expense_id UUID REFERENCES cash_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fixed_cost_log_id UUID REFERENCES fixed_cost_logs(id) ON DELETE CASCADE;

-- Staff may record bank expenses; owners retain full ledger access
CREATE POLICY bank_ledger_expense_insert ON bank_ledger
  FOR INSERT TO authenticated
  WITH CHECK (entry_type = 'EXPENSE');

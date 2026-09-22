-- Cash in hand (loan wallet) as expense payment mode — distinct from sales Cash.

ALTER TABLE cash_expenses DROP CONSTRAINT IF EXISTS cash_expenses_payment_mode_check;
ALTER TABLE cash_expenses
  ADD CONSTRAINT cash_expenses_payment_mode_check
  CHECK (payment_mode IN ('CASH', 'HAND', 'UPI', 'BANK'));

COMMENT ON COLUMN cash_expenses.payment_mode IS
  'CASH = sales till; HAND = cash in hand (loan); UPI; BANK';

ALTER TABLE fixed_cost_logs DROP CONSTRAINT IF EXISTS fixed_cost_logs_payment_mode_check;
ALTER TABLE fixed_cost_logs
  ADD CONSTRAINT fixed_cost_logs_payment_mode_check
  CHECK (payment_mode IS NULL OR payment_mode IN ('CASH', 'HAND', 'UPI', 'BANK'));

COMMENT ON COLUMN fixed_cost_logs.payment_mode IS
  'CASH = sales cash record; HAND = cash in hand (loan); UPI; BANK';

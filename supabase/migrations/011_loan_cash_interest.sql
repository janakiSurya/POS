-- Loan cash/bank payment mode + monthly interest on lenders

ALTER TABLE lenders
  ADD COLUMN IF NOT EXISTS interest_rate_monthly NUMERIC(8,4);

COMMENT ON COLUMN lenders.interest_rate_monthly IS
  'Simple interest percent per month; NULL or 0 = no interest.';

ALTER TABLE loan_entries
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(10) NOT NULL DEFAULT 'BANK',
  ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loan_entries_payment_mode_check'
  ) THEN
    ALTER TABLE loan_entries
      ADD CONSTRAINT loan_entries_payment_mode_check
      CHECK (payment_mode IN ('CASH', 'BANK'));
  END IF;
END $$;

COMMENT ON COLUMN loan_entries.payment_mode IS
  'CASH adjusts undeposited till cash; BANK writes bank_ledger.';
COMMENT ON COLUMN loan_entries.interest_amount IS
  'On REPAID: interest portion of amount; principal = amount - interest_amount.';

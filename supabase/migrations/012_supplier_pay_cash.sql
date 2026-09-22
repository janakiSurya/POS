-- Supplier payments can be from cash or bank; track mode on bank_ledger.

ALTER TABLE bank_ledger
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(10) NOT NULL DEFAULT 'BANK';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_ledger_payment_mode_check'
  ) THEN
    ALTER TABLE bank_ledger
      ADD CONSTRAINT bank_ledger_payment_mode_check
      CHECK (payment_mode IN ('CASH', 'BANK'));
  END IF;
END $$;

COMMENT ON COLUMN bank_ledger.payment_mode IS
  'BANK affects bank balance; CASH adjusts undeposited cash (e.g. supplier pay).';

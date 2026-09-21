-- Session simplification + expense payment mode
-- Open/end without counted balances; expenses can be CASH or UPI.

ALTER TABLE cash_expenses
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(10) NOT NULL DEFAULT 'CASH'
  CHECK (payment_mode IN ('CASH', 'UPI'));

COMMENT ON COLUMN cash_expenses.payment_mode IS 'How the expense was paid: CASH or UPI (reduces expected drawer balance).';

-- Opening balances unused going forward; keep columns for history, default 0.
ALTER TABLE register_sessions
  ALTER COLUMN opening_cash SET DEFAULT 0,
  ALTER COLUMN opening_upi SET DEFAULT 0;

ALTER TABLE register_sessions
  ADD COLUMN IF NOT EXISTS close_reason VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN register_sessions.close_reason IS 'MANUAL | AUTO_EOD';

-- Auto-close any OPEN session whose business_date is before today (IST).
CREATE OR REPLACE FUNCTION public.auto_close_stale_register_sessions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_ist date := (timezone('Asia/Kolkata', now()))::date;
  r record;
  v_cash_sales numeric;
  v_upi_sales numeric;
  v_cash_exp numeric;
  v_upi_exp numeric;
  v_expected_cash numeric;
  v_expected_upi numeric;
  n int := 0;
BEGIN
  FOR r IN
    SELECT * FROM register_sessions
    WHERE status = 'OPEN' AND business_date < today_ist
  LOOP
    SELECT
      COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN payment_method = 'UPI' THEN total_amount ELSE 0 END), 0)
    INTO v_cash_sales, v_upi_sales
    FROM invoices WHERE session_id = r.id;

    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(payment_mode, 'CASH') = 'CASH' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN payment_mode = 'UPI' THEN amount ELSE 0 END), 0)
    INTO v_cash_exp, v_upi_exp
    FROM cash_expenses WHERE session_id = r.id;

    v_expected_cash := round(v_cash_sales - v_cash_exp, 2);
    v_expected_upi := round(v_upi_sales - v_upi_exp, 2);

    UPDATE register_sessions SET
      status = 'CLOSED',
      closed_at = (r.business_date + interval '1 day') AT TIME ZONE 'Asia/Kolkata',
      expected_cash = v_expected_cash,
      expected_upi = v_expected_upi,
      closing_cash = v_expected_cash,
      closing_upi = v_expected_upi,
      cash_variance = 0,
      upi_variance = 0,
      close_reason = 'AUTO_EOD'
    WHERE id = r.id;

    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_stale_register_sessions() TO authenticated, anon, service_role;
